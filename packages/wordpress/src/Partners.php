<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\ActionSigner;
use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PageSquireWPVendor\PageSquire\Server\Link\A2AEndpoint;
use PageSquireWPVendor\PageSquire\Server\Link\Link;
use PageSquireWPVendor\PageSquire\Server\Link\LinkEndpoint;
use PageSquireWPVendor\PageSquire\Server\Link\LinkManager;

/** PageSquire Link for WordPress: the site key, its declaration, the partner endpoint and owner operations. */
final class Partners
{
    private const SETTINGS = 'pagesquire_link';

    private const KEY = 'pagesquire_site_key';

    /** @return array{enabled: bool, name: string, skills: list<array<string, mixed>>, a2a: array{enabled: bool, skills: list<string>}} */
    public static function settings(): array
    {
        $saved = get_option(self::SETTINGS, []);

        return array_replace(['enabled' => false, 'name' => mb_substr(get_bloginfo('name') ?: 'WordPress site', 0, 80), 'skills' => [], 'a2a' => ['enabled' => false, 'skills' => []]], is_array($saved) ? $saved : []);
    }

    /** The optional A2A interface (Phase 6E): on only while Link is on and the owner opened it. */
    public static function a2aEnabled(): bool
    {
        return self::enabled() && self::settings()['a2a']['enabled'] === true;
    }

    /** Link needs WordPress at the domain root, where the declaration is served, and HTTPS (HTTP only for local test hosts). */
    public static function available(): bool
    {
        return in_array((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), ['', '/'], true) && Link::originAllowed(Settings::origin());
    }

    public static function enabled(): bool
    {
        return self::settings()['enabled'] === true && self::available();
    }

    /** @return array<string, mixed> */
    public static function state(): array
    {
        return [
            'settings' => self::settings(),
            'available' => self::available(),
            'links' => (new OptionLinkStore)->transaction(static fn (array &$data): array => array_values($data['links'])),
            // Only while Link is on, so viewing the dashboard never creates a site key.
            'overview' => self::enabled() ? self::manager()->overview() : null,
        ];
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    public static function save(array $input): array
    {
        if (array_diff(array_keys($input), ['enabled', 'name', 'skills', 'a2a']) !== []) {
            throw new AssistantException('INVALID_SETTINGS', 'Unknown Link settings cannot be saved.');
        }
        $next = array_replace(self::settings(), $input);
        $name = is_string($next['name']) ? sanitize_text_field($next['name']) : '';
        $skills = Link::readSkills($next['skills']);
        if (! is_bool($next['enabled']) || $name === '' || mb_strlen($name) > 80) {
            throw new AssistantException('INVALID_SETTINGS', 'Enter a site name of at most 80 characters.');
        }
        if ($skills === null) {
            throw new AssistantException('INVALID_SKILLS', 'Skills must be a JSON list of at most 20 skills with id, name, description, tags, fields and startPath.');
        }
        $a2a = $next['a2a'];
        if (! is_array($a2a) || array_keys($a2a) !== ['enabled', 'skills'] || ! is_bool($a2a['enabled']) || ! is_array($a2a['skills']) || ! array_is_list($a2a['skills'])
            || array_diff($a2a['skills'], array_column($skills, 'id')) !== []) {
            throw new AssistantException('INVALID_SETTINGS', 'Skills open to AI agents (A2A) must be skill IDs from the skills list.');
        }
        $a2a['skills'] = array_values(array_unique($a2a['skills']));
        if ($next['enabled'] && ! self::available()) {
            throw new AssistantException('LINK_UNAVAILABLE', 'PageSquire Link needs WordPress at the root of an HTTPS domain.');
        }
        if ($next['enabled']) {
            self::signingKey();
        }
        update_option(self::SETTINGS, ['enabled' => $next['enabled'], 'name' => $name, 'skills' => $skills, 'a2a' => $a2a], false);

        return self::state();
    }

    public static function manager(): LinkManager
    {
        $settings = self::settings();

        return new LinkManager(
            new ActionSigner(self::signingKey(), Settings::origin()),
            new OptionLinkStore,
            ['endpoint' => self::path(rest_url('pagesquire/v1/link')), 'name' => $settings['name'], 'skills' => $settings['skills']],
            new WordPressLinkTransport,
            a2a: $settings['enabled'] && $settings['a2a']['enabled'] ? ['endpoint' => self::path(rest_url('pagesquire/v1/a2a')), 'skills' => $settings['a2a']['skills']] : null,
        );
    }

    /**
     * Answers /.well-known/pagesquire.json before WordPress routes the request, and with the A2A
     * interface on, the signed Agent Card and the key set that verifies it.
     */
    public static function serveDeclaration(): void
    {
        $path = wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
        if (in_array($path, ['/.well-known/agent-card.json', '/.well-known/pagesquire-keys.json'], true) && self::a2aEnabled()) {
            $manager = self::manager();
            status_header(200);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: public, max-age=300');
            header('Access-Control-Allow-Origin: *');
            header('X-Content-Type-Options: nosniff');
            echo wp_json_encode($path === '/.well-known/agent-card.json' ? $manager->agentCard() : $manager->agentKeys(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ($path !== '/.well-known/pagesquire.json' || ! self::enabled()) {
            return;
        }
        $signer = new ActionSigner(self::signingKey(), Settings::origin());
        status_header(200);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: public, max-age=300');
        header('X-Content-Type-Options: nosniff');
        echo wp_json_encode($signer->declaration(self::path(rest_url('pagesquire/v1/chat')), false, self::manager()->declaration()), JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function permission(): bool|\WP_Error
    {
        return self::enabled() ? true : new \WP_Error('LINK_DISABLED', 'PageSquire Link is not enabled on this site.', ['status' => 404]);
    }

    /** Partner servers POST signed envelopes here; no cookies, nonce or Origin are involved. */
    public static function receive(\WP_REST_Request $request, string $ipHash): \WP_REST_Response
    {
        (new Quota(new OptionsStore))->link($ipHash);
        $response = (new LinkEndpoint(self::manager()))->handle($request->get_method(), (string) $request->get_header('content-type'), $request->get_body());

        return new \WP_REST_Response($response['body'], $response['status']);
    }

    public static function a2aPermission(): bool|\WP_Error
    {
        return self::a2aEnabled() ? true : new \WP_Error('A2A_DISABLED', 'This site takes no A2A requests.', ['status' => 404]);
    }

    /** Any A2A agent POSTs JSON-RPC here; rate-limited per address. */
    public static function answer(\WP_REST_Request $request, string $ipHash): \WP_REST_Response
    {
        (new Quota(new OptionsStore))->a2a($ipHash);
        $version = $request->get_header('a2a_version') ?? (is_string($_GET['A2A-Version'] ?? null) ? sanitize_text_field(wp_unslash($_GET['A2A-Version'])) : '');
        $response = (new A2AEndpoint(self::manager()))->handle($request->get_method(), (string) $request->get_header('content-type'), $request->get_body(), (string) $version);
        $reply = new \WP_REST_Response($response['body'], $response['status']);
        $reply->header('Cache-Control', 'no-store');

        return $reply;
    }

    /** The site key: PAGESQUIRE_SIGNING_KEY from wp-config.php, or one generated once and kept encrypted with the auth salt. */
    private static function signingKey(bool $create = true): string
    {
        if (defined('PAGESQUIRE_SIGNING_KEY') && is_string(PAGESQUIRE_SIGNING_KEY) && PAGESQUIRE_SIGNING_KEY !== '') {
            return PAGESQUIRE_SIGNING_KEY;
        }
        $box = hash('sha256', wp_salt('auth').'pagesquire-site-key', true);
        $stored = get_option(self::KEY, '');
        if (is_string($stored) && $stored !== '') {
            $raw = base64_decode($stored, true);
            $plain = $raw !== false && strlen($raw) > SODIUM_CRYPTO_SECRETBOX_NONCEBYTES
                ? sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $box)
                : false;
            if (! is_string($plain)) {
                throw new AssistantException('SITE_KEY_UNREADABLE', 'The site key cannot be read; the WordPress salts may have changed.', 503);
            }

            return $plain;
        }
        if (! $create) {
            throw new AssistantException('SITE_KEY_UNAVAILABLE', 'The site key could not be stored.', 503);
        }
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        // add_option never overwrites, so two first requests settle on one key.
        add_option(self::KEY, base64_encode($nonce.sodium_crypto_secretbox(ActionSigner::generate()['signingKey'], $nonce, $box)), '', false);

        return self::signingKey(false);
    }

    /** The same-origin path, with query, of a WordPress URL. */
    private static function path(string $url): string
    {
        $parts = wp_parse_url($url);

        return ($parts['path'] ?? '/').(isset($parts['query']) ? '?'.$parts['query'] : '');
    }
}
