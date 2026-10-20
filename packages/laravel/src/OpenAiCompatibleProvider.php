<?php

namespace PageSquire\Laravel;

use Illuminate\Http\Client\Factory;
use JsonException;
use PageSquire\Server\AssistantException;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use Psr\Http\Message\ResponseInterface;
use RuntimeException;
use Throwable;

final class OpenAiCompatibleProvider implements Provider
{
    public function __construct(
        private readonly Factory $http,
        private readonly ProtocolValidator $validator,
        private readonly ?string $endpoint,
        private readonly ?string $key,
        private readonly ?string $model,
        private readonly int $timeoutSeconds = 20,
        private readonly int $connectTimeoutSeconds = 5,
    ) {}

    /**
     * @param  list<array<string, mixed>>  $messages
     * @param  list<array<string, mixed>>  $capabilities
     * @return array<string, mixed>
     */
    public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
    {
        $this->assertConfiguration();

        try {
            $response = $this->http->withToken($this->key)
                ->withHeaders(['Accept-Encoding' => 'identity'])
                ->acceptJson()
                ->asJson()
                ->timeout($this->timeoutSeconds)
                ->connectTimeout($this->connectTimeoutSeconds)
                ->withoutRedirecting()
                ->withOptions([
                    'decode_content' => false,
                    'on_headers' => static function (ResponseInterface $response): void {
                        $length = $response->getHeaderLine('Content-Length');
                        $encoding = strtolower(trim($response->getHeaderLine('Content-Encoding')));

                        if (($encoding !== '' && $encoding !== 'identity') || ($length !== '' && (! ctype_digit($length) || (float) $length > 262144))) {
                            throw new RuntimeException('The provider response exceeds the permitted size.');
                        }
                    },
                    'progress' => static function (float $downloadTotal, float $downloaded, float $uploadTotal, float $uploaded): void {
                        if ($downloadTotal > 262144 || $downloaded > 262144) {
                            throw new RuntimeException('The provider response exceeds the permitted size.');
                        }
                    },
                ])
                ->post($this->endpoint, [
                    'model' => $this->model,
                    'messages' => $messages,
                    'response_format' => ['type' => 'json_object'],
                    'max_tokens' => $maxOutputTokens,
                ]);

            if (! $response->successful() || strlen($response->body()) > 262144) {
                throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
            }

            $envelope = json_decode($response->body(), true, 64, JSON_THROW_ON_ERROR);
            $content = $envelope['choices'][0]['message']['content'] ?? null;

            if (! is_string($content) || strlen($content) > 65536) {
                throw new AssistantException('INVALID_PROVIDER_RESPONSE', 'The assistant provider returned an invalid response.', 502);
            }

            $draft = json_decode($content, false, 32, JSON_THROW_ON_ERROR);

            if (! $draft instanceof \stdClass) {
                throw new AssistantException('INVALID_PROVIDER_RESPONSE', 'The assistant provider returned an invalid response.', 502);
            }

            if (! in_array($draft->emotion ?? null, ['idle', 'happy', 'sad', 'thinking', 'confused', 'hover'], true)) {
                $draft->emotion = 'idle';
            }

            try {
                $this->validator->validate('providerResponse', $draft);
            } catch (AssistantException) {
                throw new AssistantException('INVALID_PROVIDER_RESPONSE', 'The assistant provider returned an invalid response.', 502);
            }

            return json_decode(json_encode($draft, JSON_THROW_ON_ERROR), true, 32, JSON_THROW_ON_ERROR);
        } catch (AssistantException $exception) {
            throw $exception;
        } catch (JsonException) {
            throw new AssistantException('INVALID_PROVIDER_RESPONSE', 'The assistant provider returned an invalid response.', 502);
        } catch (Throwable) {
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        }
    }

    private function assertConfiguration(): void
    {
        $url = is_string($this->endpoint) ? parse_url($this->endpoint) : false;

        if (! is_array($url) || ($url['scheme'] ?? null) !== 'https' || empty($url['host'])
            || isset($url['user']) || isset($url['pass']) || isset($url['fragment'])
            || ! is_string($this->key) || $this->key === '' || preg_match('/[\r\n]/', $this->key)
            || ! is_string($this->model) || $this->model === '' || strlen($this->model) > 200
            || $this->timeoutSeconds < 1 || $this->timeoutSeconds > 60
            || $this->connectTimeoutSeconds < 1 || $this->connectTimeoutSeconds > $this->timeoutSeconds) {
            throw new AssistantException('PROVIDER_NOT_CONFIGURED', 'The assistant provider is not configured.', 503);
        }
    }
}
