<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PageSquireWPVendor\PageSquire\Server\ProviderConfiguration;

final class Settings
{
    public static function origin(): string
    {
        $url = wp_parse_url(home_url('/'));

        return $url['scheme'].'://'.$url['host'].(isset($url['port']) ? ':'.$url['port'] : '');
    }

    /** @return array<string, mixed> */
    public static function get(): array
    {
        return array_replace([
            'enabled' => false, 'consent' => false, 'access' => 'administrators',
            'assistantName' => 'PageSquire', 'language' => 'auto', 'endpoint' => '', 'model' => '',
            'provider' => 'custom', 'responseMode' => 'preset', 'tokenParameter' => 'preset', 'systemRole' => 'system', 'thinking' => 'default',
            'pageIds' => [], 'dailyAttempts' => 100, 'revision' => 1,
            'mapping' => Mapping::defaults(self::origin()),
        ], get_option('pagesquire_settings', []));
    }

    /** @return array<string, mixed> */
    public static function publicSettings(): array
    {
        return self::get() + ['providerConfigured' => self::key() !== '', 'keySource' => defined('PAGESQUIRE_API_KEY') ? 'configuration' : 'encrypted option'];
    }

    public static function key(): string
    {
        if (defined('PAGESQUIRE_API_KEY')) {
            return is_string(PAGESQUIRE_API_KEY) ? PAGESQUIRE_API_KEY : '';
        }
        if (! function_exists('sodium_crypto_secretbox_open')) {
            return '';
        }
        $encrypted = get_option('pagesquire_provider_key', '');
        if (! is_string($encrypted) || $encrypted === '') {
            return '';
        }
        try {
            $raw = base64_decode($encrypted, true);
            if ($raw === false || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
                return '';
            }
            $key = hash('sha256', wp_salt('auth').'pagesquire-provider-key', true);
            $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $key);

            return is_string($plain) ? $plain : '';
        } catch (\Throwable) {
            return '';
        }
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    public static function save(array $input): array
    {
        $allowed = ['enabled', 'consent', 'access', 'assistantName', 'language', 'provider', 'endpoint', 'model', 'responseMode', 'tokenParameter', 'systemRole', 'thinking', 'pageIds', 'dailyAttempts', 'apiKey', 'removeKey'];
        if (array_diff(array_keys($input), $allowed) !== []) {
            throw new AssistantException('INVALID_SETTINGS', 'Unknown settings cannot be saved.');
        }
        $previous = self::get();
        $next = array_replace($previous, array_diff_key($input, ['apiKey' => true, 'removeKey' => true]));
        $presets = array_column(ProviderConfiguration::presets(), null, 'id');
        if (! is_string($next['provider']) || ! isset($presets[$next['provider']]) || ! in_array($next['responseMode'], ['preset', 'json_object', 'prompt'], true) || ! in_array($next['tokenParameter'], ['preset', 'max_tokens', 'max_completion_tokens'], true) || ! in_array($next['systemRole'], ['system', 'developer'], true) || ! in_array($next['thinking'], ['default', 'disabled'], true)) {
            throw new AssistantException('INVALID_PROVIDER', 'Select a supported provider and compatibility settings.');
        }
        if ($next['endpoint'] === '' && $presets[$next['provider']]['endpoint'] !== null) {
            $next['endpoint'] = $presets[$next['provider']]['endpoint'];
        }
        if (! is_bool($next['enabled']) || ! is_bool($next['consent']) || ! in_array($next['access'], ['administrators', 'authenticated', 'public'], true) || ! in_array($next['language'], ['auto', 'en', 'id', 'es', 'fr', 'de', 'pt', 'ja', 'zh'], true) || ! is_string($next['assistantName']) || mb_strlen($next['assistantName']) < 1 || mb_strlen($next['assistantName']) > 60 || ! is_string($next['model']) || strlen($next['model']) > 200 || ! is_int($next['dailyAttempts']) || $next['dailyAttempts'] < 1 || $next['dailyAttempts'] > 1000 || ! is_array($next['pageIds']) || ! array_is_list($next['pageIds']) || count($next['pageIds']) > 20) {
            throw new AssistantException('INVALID_SETTINGS', 'Review the identity, access, language, page scope and provider budget.');
        }
        $next['assistantName'] = sanitize_text_field($next['assistantName']);
        $next['model'] = sanitize_text_field($next['model']);
        if ($next['assistantName'] === '') {
            throw new AssistantException('INVALID_SETTINGS', 'Enter a non-empty assistant name.');
        }
        if (! is_string($next['endpoint']) || strlen($next['endpoint']) > 2048) {
            throw new AssistantException('INVALID_PROVIDER', 'Enter a server-owned HTTPS provider endpoint.');
        }
        $url = wp_parse_url($next['endpoint']);
        if ($next['endpoint'] !== '' && (! is_array($url) || ($url['scheme'] ?? '') !== 'https' || empty($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['fragment']))) {
            throw new AssistantException('INVALID_PROVIDER', 'Enter a server-owned HTTPS provider endpoint without credentials or fragments.');
        }
        if ($next['endpoint'] !== '') {
            ProviderConfiguration::resolve([...self::providerOptions($next), 'endpoint' => $next['endpoint'], 'apiKey' => 'configuration-check-only', 'model' => $next['model'] !== '' ? $next['model'] : 'configuration-check-only']);
        }
        foreach ($next['pageIds'] as $id) {
            if (! is_int($id) || $id < 1 || ! Context::permitted(get_post($id))) {
                throw new AssistantException('PRIVATE_PAGE', 'Only published, unprotected public pages or posts may be selected.');
            }
        }
        if (count(array_unique($next['pageIds'])) !== count($next['pageIds'])) {
            throw new AssistantException('INVALID_SETTINGS', 'Choose each public page only once.');
        }
        $key = $input['apiKey'] ?? '';
        if (! is_string($key) || strlen($key) > 4096 || preg_match('/[\r\n]/', $key) || isset($input['removeKey']) && ! is_bool($input['removeKey'])) {
            throw new AssistantException('INVALID_KEY', 'The provider key is invalid.');
        }
        if ($key !== '' && (! is_ssl() || ! function_exists('sodium_crypto_secretbox'))) {
            throw new AssistantException('KEY_STORAGE_UNAVAILABLE', 'Use HTTPS and sodium for dashboard key storage, or define PAGESQUIRE_API_KEY in server configuration.');
        }
        $changed = $next !== $previous || $key !== '' || ($input['removeKey'] ?? false);
        if ($changed) {
            $next['revision']++;
        }
        if ($next['enabled'] && (! $next['consent'] || ($key === '' && self::key() === '') || $next['endpoint'] === '' || $next['model'] === '' || Context::gaps($next) !== [])) {
            throw new AssistantException('NOT_READY', 'Finish the public-page checks, configure the provider and approve external data processing before enabling.');
        }
        if ($key !== '') {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $encrypted = base64_encode($nonce.sodium_crypto_secretbox($key, $nonce, hash('sha256', wp_salt('auth').'pagesquire-provider-key', true)));
            update_option('pagesquire_provider_key', $encrypted, false);
        } elseif ($input['removeKey'] ?? false) {
            delete_option('pagesquire_provider_key');
            $next['enabled'] = false;
        }
        update_option('pagesquire_settings', $next, false);

        return self::publicSettings();
    }

    public static function canUse(array $settings): bool
    {
        return match ($settings['access']) {
            'public' => true,
            'authenticated' => is_user_logged_in() && current_user_can('read'),
            default => current_user_can('manage_options'),
        };
    }

    /** @param array<string, mixed> $settings @return array<string, string> */
    public static function providerOptions(array $settings): array
    {
        return array_filter(array_intersect_key($settings, array_flip(['provider', 'responseMode', 'tokenParameter', 'systemRole', 'thinking'])), static fn (mixed $value): bool => $value !== 'preset');
    }
}
