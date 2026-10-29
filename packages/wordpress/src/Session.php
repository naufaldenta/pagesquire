<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

final class Session
{
    public static function issue(array $settings): array
    {
        $session = self::read($settings);
        if ($session === null) {
            $id = bin2hex(random_bytes(24));
            $expires = time() + 3600;
            $uid = get_current_user_id();
            $payload = $id.'.'.$expires.'.'.$uid.'.'.$settings['revision'];
            $cookie = $payload.'.'.hash_hmac('sha256', $payload, wp_salt('auth').'pagesquire:'.get_current_blog_id());
            $path = wp_parse_url(home_url('/'), PHP_URL_PATH) ?: '/';
            setcookie('pagesquire_session', $cookie, ['expires' => $expires, 'path' => $path, 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Strict']);
            $session = self::data($id, $expires, $settings);
        }

        return $session;
    }

    public static function read(array $settings): ?array
    {
        $cookie = $_COOKIE['pagesquire_session'] ?? '';
        if (! is_string($cookie) || ! preg_match('/^([a-f0-9]{48})\.([0-9]{10})\.([0-9]+)\.([0-9]+)\.([a-f0-9]{64})$/', $cookie, $match)) {
            return null;
        }
        $payload = $match[1].'.'.$match[2].'.'.$match[3].'.'.$match[4];
        if ((int) $match[2] <= time() || (int) $match[2] > time() + 3600 || (int) $match[3] !== get_current_user_id() || (int) $match[4] !== $settings['revision'] || ! hash_equals(hash_hmac('sha256', $payload, wp_salt('auth').'pagesquire:'.get_current_blog_id()), $match[5])) {
            return null;
        }

        return self::data($match[1], (int) $match[2], $settings);
    }

    private static function data(string $id, int $expires, array $settings): array
    {
        $user = wp_get_current_user();
        $key = 'chat:'.hash('sha256', $id.'|'.get_current_user_id().'|'.wp_get_session_token());

        return ['key' => $key, 'expiresAt' => $expires, 'principal' => hash('sha256', wp_json_encode([get_current_user_id(), $user->roles, $user->allcaps, $settings['revision']])), 'csrfToken' => hash_hmac('sha256', $key.'|'.$expires, wp_salt('nonce')), 'capabilityIds' => [...$settings['mapping']['capabilityIds'], ...(Partners::enabled() ? ['link.handoff'] : [])]];
    }
}
