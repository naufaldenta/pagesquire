<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

use PageSquire\Server\AssistantException;

final class CurlHttpClient implements HttpClient
{
    public function post(string $url, array $headers, string $body, int $timeoutSeconds, int $maxBytes): string
    {
        if (! extension_loaded('curl')) {
            throw new AssistantException('MISSING_CURL', 'The native provider requires ext-curl.', 503);
        }
        $parts = parse_url($url);
        if (! is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment']) || $timeoutSeconds < 1 || $timeoutSeconds > 60 || $maxBytes < 1 || $maxBytes > 262144) {
            throw new AssistantException('INVALID_PROVIDER_CONFIG', 'Configure a server-owned HTTPS provider.', 500);
        }
        $handle = curl_init($url);
        $response = '';
        $headerBytes = 0;
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CONNECTTIMEOUT => min(5, $timeoutSeconds),
            CURLOPT_TIMEOUT => $timeoutSeconds,
            CURLOPT_HEADERFUNCTION => static function (\CurlHandle $handle, string $line) use (&$headerBytes, $maxBytes): int {
                $headerBytes += strlen($line);
                if ($headerBytes > 16384 || (preg_match('/^Content-Length:\s*(\S+)/i', $line, $match) && (! ctype_digit($match[1]) || (float) $match[1] > $maxBytes)) || (preg_match('/^Content-Encoding:\s*(\S+)/i', $line, $match) && strtolower($match[1]) !== 'identity')) {
                    return 0;
                }

                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => static function (\CurlHandle $handle, string $chunk) use (&$response, $maxBytes): int {
                if (strlen($response) + strlen($chunk) > $maxBytes) {
                    return 0;
                }
                $response .= $chunk;

                return strlen($chunk);
            },
        ]);
        try {
            $success = curl_exec($handle);
            $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            if ($success === false || $status < 200 || $status >= 300) {
                throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
            }

            return $response;
        } finally {
            curl_close($handle);
        }
    }
}
