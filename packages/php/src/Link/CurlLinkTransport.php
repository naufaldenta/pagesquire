<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

use PageSquire\Server\AssistantException;

/** cURL transport: no redirects, bounded time and size, HTTP only for local and .test partners. */
final class CurlLinkTransport implements LinkTransport
{
    public function request(string $method, string $url, ?string $body): string
    {
        if (! extension_loaded('curl')) {
            throw new AssistantException('MISSING_CURL', 'PageSquire Link requires ext-curl.', 503);
        }
        $origin = \PageSquire\Server\ActionSigner::origin($url);
        if ($origin === null || ! Link::originAllowed($origin) || ! in_array($method, ['GET', 'POST'], true)) {
            throw new AssistantException('PARTNER_INVALID', 'The partner origin is not allowed.', 400);
        }
        $handle = curl_init($url);
        $response = '';
        curl_setopt_array($handle, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $body !== null ? ['Content-Type: application/json'] : []),
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_WRITEFUNCTION => static function (\CurlHandle $handle, string $chunk) use (&$response): int {
                if (strlen($response) + strlen($chunk) > Link::MAX_BODY_BYTES) {
                    return 0;
                }
                $response .= $chunk;

                return strlen($chunk);
            },
        ]);
        if ($body !== null) {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
        }
        try {
            if (curl_exec($handle) === false) {
                throw new AssistantException('PARTNER_UNREACHABLE', 'The partner site could not be reached.', 502);
            }

            return $response;
        } finally {
            curl_close($handle);
        }
    }
}
