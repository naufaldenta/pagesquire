<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

use PageSquire\Server\AssistantException;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use stdClass;
use Throwable;

final class OpenAiCompatibleProvider implements Provider
{
    public function __construct(
        private readonly ProtocolValidator $validator,
        private readonly string $endpoint,
        private readonly string $apiKey,
        private readonly string $model,
        private readonly HttpClient $http = new CurlHttpClient,
        private readonly int $timeoutSeconds = 20,
    ) {
        $url = parse_url($endpoint);
        if (! is_array($url) || ($url['scheme'] ?? '') !== 'https' || empty($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['fragment']) || trim($apiKey) === '' || preg_match('/[\r\n]/', $apiKey) || trim($model) === '' || strlen($model) > 200 || $timeoutSeconds < 1 || $timeoutSeconds > 60) {
            throw new AssistantException('INVALID_PROVIDER_CONFIG', 'Configure a server-owned HTTPS provider.', 500);
        }
    }

    public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
    {
        try {
            $body = $this->http->post($this->endpoint, ['Content-Type: application/json', 'Accept: application/json', 'Accept-Encoding: identity', 'Authorization: Bearer '.$this->apiKey], json_encode(['model' => $this->model, 'messages' => $messages, 'max_tokens' => $maxOutputTokens, 'response_format' => ['type' => 'json_object']], JSON_THROW_ON_ERROR), $this->timeoutSeconds, 262144);
            if (strlen($body) > 262144) {
                throw new AssistantException('INVALID_PROVIDER_RESPONSE', 'The provider returned an invalid response.', 502);
            }
            $data = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
            $content = $data['choices'][0]['message']['content'] ?? null;
            if (! is_string($content) || strlen($content) > 65536) {
                throw new AssistantException('INVALID_PROVIDER_RESPONSE', 'The provider returned an invalid response.', 502);
            }
            $raw = json_decode($content, false, 32, JSON_THROW_ON_ERROR);
            if (! $raw instanceof stdClass) {
                throw new AssistantException('INVALID_PROVIDER_RESPONSE', 'The provider returned an invalid response.', 502);
            }
            if (! in_array($raw->emotion ?? null, ['idle', 'happy', 'sad', 'thinking', 'confused', 'hover'], true)) {
                $raw->emotion = 'idle';
            }
            $this->validator->validate('providerResponse', $raw);

            $draft = (array) $raw;
            $draft['toolCalls'] = array_map(static fn (stdClass $call): array => (array) $call, $raw->toolCalls);

            return $draft;
        } catch (Throwable) {
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        }
    }
}
