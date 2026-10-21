<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;

final class Context
{
    public static function permitted(mixed $post): bool
    {
        return $post instanceof \WP_Post && in_array($post->post_type, ['page', 'post'], true) && $post->post_status === 'publish' && $post->post_password === '' && is_post_publicly_viewable($post);
    }

    public static function fingerprint(array $settings): string
    {
        $theme = wp_get_theme();
        $pages = [];
        foreach ($settings['pageIds'] as $id) {
            $post = get_post($id);
            $pages[] = self::permitted($post) ? [$id, $post->post_modified_gmt, hash('sha256', $post->post_content), $post->post_title, self::url($id)] : [$id, 'unavailable'];
        }

        return hash('sha256', wp_json_encode([$settings['mapping'], $pages, get_stylesheet(), $theme->get('Version')]));
    }

    /** @return list<array<string, mixed>> */
    public static function pages(array $settings): array
    {
        $pages = [];
        $count = 0;
        foreach ($settings['pageIds'] as $id) {
            $post = get_post($id);
            if (! self::permitted($post)) {
                continue;
            }
            $pages[] = ['id' => $id, 'type' => $post->post_type, 'title' => mb_substr(sanitize_text_field($post->post_title), 0, 160), 'url' => self::url($id), 'blocks' => self::blocks(parse_blocks($post->post_content), $count)];
        }

        return $pages;
    }

    public static function url(int $id): string
    {
        $url = get_permalink($id);
        $parts = is_string($url) ? wp_parse_url($url) : false;
        if (! is_string($url) || strlen($url) > 2048 || ! str_starts_with($url, Settings::origin().'/') || ! is_array($parts) || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])) {
            throw new AssistantException('UNSAFE_PAGE', 'A selected page does not have a permitted same-origin URL.');
        }

        return $url;
    }

    public static function blocks(array $blocks, int &$count, int $depth = 0): array
    {
        $result = [];
        foreach ($blocks as $block) {
            if ($count >= 100 || $depth > 4) {
                break;
            }
            $name = $block['blockName'] ?? null;
            if (! is_string($name) || ! preg_match('~^[a-z0-9_-]+/[a-z0-9_-]+$~', $name) || strlen($name) > 100) {
                continue;
            }
            $count++;
            $result[] = ['name' => $name, 'children' => self::blocks($block['innerBlocks'] ?? [], $count, $depth + 1)];
        }

        return $result;
    }

    /** @return list<string> */
    public static function gaps(array $settings): array
    {
        $gaps = [];
        if (($settings['mapping']['siteOrigin'] ?? '') !== Settings::origin()) {
            $gaps[] = 'The site origin changed. Review and import a mapping for the current origin.';
        }
        if ($settings['pageIds'] === []) {
            return ['Select at least one public page.'];
        }
        $reports = get_option('pagesquire_observations', []);
        $fingerprint = self::fingerprint($settings);
        foreach ($settings['pageIds'] as $id) {
            if (! self::permitted(get_post($id))) {
                $gaps[] = 'A selected page is no longer publicly available.';

                continue;
            }
            $report = $reports[$id] ?? null;
            if (! is_array($report) || ($report['fingerprint'] ?? '') !== $fingerprint || ($report['rootCount'] ?? 0) !== 1) {
                $gaps[] = 'Page '.$id.' needs a current, unambiguous frontend inspection.';

                continue;
            }
            foreach ($settings['mapping']['capabilityIds'] as $capability) {
                if (! in_array($capability, $report['verifiedCapabilityIds'], true)) {
                    $gaps[] = 'Page '.$id.' has not verified '.$capability.'.';
                }
            }
        }

        return $gaps;
    }

    public static function bundle(array $settings): array
    {
        $theme = wp_get_theme();

        return [
            'schemaVersion' => '0.1', 'kind' => 'pagesquire.wordpress.context',
            'site' => ['origin' => Settings::origin(), 'wordpress' => get_bloginfo('version'), 'theme' => ['slug' => get_stylesheet(), 'version' => $theme->get('Version')], 'assistantName' => $settings['assistantName'], 'language' => $settings['language']],
            'pages' => self::pages($settings), 'mapping' => $settings['mapping'],
            'observations' => array_values(array_intersect_key(get_option('pagesquire_observations', []), array_flip($settings['pageIds']))),
            'gaps' => [...self::gaps($settings), 'Only the inspected visible frontend states are covered.', 'No custom theme/plugin server implementation is included.', 'Elementor, WooCommerce, private states and third-party accessibility adapters are not certified.'],
        ];
    }

    public static function report(mixed $raw, array $settings): array
    {
        $fields = ['schemaVersion', 'pageId', 'fingerprint', 'rootCount', 'headingCount', 'linkCount', 'controlCount', 'truncated', 'verifiedCapabilityIds'];
        if (! $raw instanceof \stdClass || count(get_object_vars($raw)) !== count($fields) || array_diff(array_keys(get_object_vars($raw)), $fields) !== [] || ($raw->schemaVersion ?? '') !== '0.1' || ! is_int($raw->pageId ?? null) || ! in_array($raw->pageId, $settings['pageIds'], true) || ($raw->fingerprint ?? '') !== self::fingerprint($settings) || ! is_bool($raw->truncated ?? null) || ! is_array($raw->verifiedCapabilityIds ?? null)) {
            throw new AssistantException('INVALID_REPORT', 'Inspect a selected page with the current mapping.');
        }
        foreach (['rootCount', 'headingCount', 'linkCount', 'controlCount'] as $field) {
            if (! is_int($raw->{$field}) || $raw->{$field} < 0 || $raw->{$field} > 1000) {
                throw new AssistantException('INVALID_REPORT', 'Inspection counts must be bounded.');
            }
        }
        if (! array_is_list($raw->verifiedCapabilityIds) || count($raw->verifiedCapabilityIds) > count(Mapping::CAPABILITIES)) {
            throw new AssistantException('INVALID_REPORT', 'Verification IDs must be unique and bounded.');
        }
        foreach ($raw->verifiedCapabilityIds as $id) {
            if (! is_string($id) || ! in_array($id, $settings['mapping']['capabilityIds'], true) || $raw->rootCount !== 1 || $raw->truncated) {
                throw new AssistantException('INVALID_REPORT', 'Uninspected or ambiguous controls cannot be approved.');
            }
        }

        if (count(array_unique($raw->verifiedCapabilityIds)) !== count($raw->verifiedCapabilityIds)) {
            throw new AssistantException('INVALID_REPORT', 'Verification IDs must be unique.');
        }

        return get_object_vars($raw);
    }
}
