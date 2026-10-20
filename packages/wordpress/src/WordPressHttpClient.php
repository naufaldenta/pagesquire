<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PageSquireWPVendor\PageSquire\Server\Http\HttpClient;

final class WordPressHttpClient implements HttpClient
{
    public function post(string $url, array $headers, string $body, int $timeoutSeconds, int $maxBytes): string
    {
        $mapped = [];
        foreach ($headers as $header) {
            [$name, $value] = explode(':', $header, 2);
            $mapped[$name] = trim($value);
        }
        $response = wp_safe_remote_post($url, ['headers' => $mapped, 'body' => $body, 'timeout' => $timeoutSeconds, 'redirection' => 0, 'sslverify' => true, 'reject_unsafe_urls' => true, 'decompress' => false, 'limit_response_size' => $maxBytes + 1]);
        if (is_wp_error($response)) {
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        }
        $content = wp_remote_retrieve_body($response);
        $length = wp_remote_retrieve_header($response, 'content-length');
        $encoding = strtolower(wp_remote_retrieve_header($response, 'content-encoding'));
        $status = wp_remote_retrieve_response_code($response);
        if ($status < 200 || $status >= 300 || strlen($content) > $maxBytes || $encoding !== '' && $encoding !== 'identity' || $length !== '' && (! ctype_digit((string) $length) || (float) $length > $maxBytes)) {
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        }

        return $content;
    }
}
