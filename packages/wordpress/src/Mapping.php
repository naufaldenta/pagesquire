<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;

final class Mapping
{
    public const ROOTS = ['main', '#content', '#primary', '.wp-site-blocks', '[data-pagesquire-content]'];

    public const CAPABILITIES = ['accessibility.set_heading_color', 'accessibility.set_link_highlight', 'accessibility.set_font_weight', 'browser.navigate'];

    /** @return array<string, mixed> */
    public static function defaults(string $origin): array
    {
        return ['schemaVersion' => '0.1', 'kind' => 'pagesquire.wordpress.mapping', 'siteOrigin' => $origin, 'contentRoot' => 'main', 'capabilityIds' => array_slice(self::CAPABILITIES, 0, 3)];
    }

    /** @return array<string, mixed> */
    public static function validate(mixed $raw, string $origin): array
    {
        if (! $raw instanceof \stdClass || array_diff(array_keys(get_object_vars($raw)), ['schemaVersion', 'kind', 'siteOrigin', 'contentRoot', 'capabilityIds']) !== [] || count(get_object_vars($raw)) !== 5 || ($raw->schemaVersion ?? '') !== '0.1' || ($raw->kind ?? '') !== 'pagesquire.wordpress.mapping' || ($raw->siteOrigin ?? '') !== $origin || ! in_array($raw->contentRoot ?? null, self::ROOTS, true) || ! is_array($raw->capabilityIds ?? null) || ! array_is_list($raw->capabilityIds) || count($raw->capabilityIds) < 1 || count($raw->capabilityIds) > 4) {
            throw new AssistantException('INVALID_MAPPING', 'Import a closed PageSquire mapping for this site and a supported content root.');
        }
        foreach ($raw->capabilityIds as $id) {
            if (! is_string($id) || ! in_array($id, self::CAPABILITIES, true)) {
                throw new AssistantException('INVALID_MAPPING', 'Only the built-in reversible adapters can be configured.');
            }
        }
        if (count(array_unique($raw->capabilityIds)) !== count($raw->capabilityIds)) {
            throw new AssistantException('INVALID_MAPPING', 'Capability IDs must be unique.');
        }

        return get_object_vars($raw);
    }

    /** @param array<string, mixed> $mapping @return array<string, mixed> */
    public static function manifest(array $mapping): array
    {
        $manifest = json_decode(file_get_contents(__DIR__.'/../assets/manifest.json'), true, 64, JSON_THROW_ON_ERROR);
        $manifest['capabilities'] = array_values(array_filter($manifest['capabilities'], static fn (array $capability): bool => in_array($capability['id'], $mapping['capabilityIds'], true)));

        return $manifest;
    }
}
