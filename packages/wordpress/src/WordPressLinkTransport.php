<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\ActionSigner;
use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PageSquireWPVendor\PageSquire\Server\Link\Link;
use PageSquireWPVendor\PageSquire\Server\Link\LinkTransport;

/** Reaches Link partners through the WordPress HTTP API: no redirects, bounded time and size. */
final class WordPressLinkTransport implements LinkTransport
{
    public function request(string $method, string $url, ?string $body): string
    {
        $origin = ActionSigner::origin($url);
        if ($origin === null || ! Link::originAllowed($origin) || ! in_array($method, ['GET', 'POST'], true)) {
            throw new AssistantException('PARTNER_INVALID', 'The partner origin is not allowed.', 400);
        }
        $response = wp_remote_request($url, [
            'method' => $method,
            'timeout' => 10,
            'redirection' => 0,
            'limit_response_size' => Link::MAX_BODY_BYTES,
            // Public partners go through WordPress's unsafe-URL checks; local test origins cannot pass them.
            'reject_unsafe_urls' => str_starts_with($origin, 'https://'),
            'sslverify' => true,
            'headers' => ['Accept' => 'application/json'] + ($body !== null ? ['Content-Type' => 'application/json'] : []),
            'body' => $body,
        ]);
        if (is_wp_error($response)) {
            throw new AssistantException('PARTNER_UNREACHABLE', 'The partner site could not be reached.', 502);
        }

        return (string) wp_remote_retrieve_body($response);
    }
}
