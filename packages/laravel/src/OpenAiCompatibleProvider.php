<?php

namespace PageSquire\Laravel;

use Illuminate\Http\Client\Factory;
use JsonException;
use PageSquire\Server\AssistantException;
use PageSquire\Server\Http\CompletionCodec;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use PageSquire\Server\ProviderConfiguration;
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
        private readonly array $options = [],
    ) {}

    /**
     * @param  list<array<string, mixed>>  $messages
     * @param  list<array<string, mixed>>  $capabilities
     * @return array<string, mixed>
     */
    public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
    {
        $this->assertConfiguration();
        $config = ProviderConfiguration::resolve([...$this->options, 'endpoint' => $this->endpoint ?? '', 'apiKey' => $this->key ?? '', 'model' => $this->model ?? '']);

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
                ->post($config['endpoint'], CompletionCodec::request($config, $messages, $maxOutputTokens));

            if (! $response->successful() || strlen($response->body()) > 262144) {
                throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
            }

            return CompletionCodec::decode($response->body(), $this->validator);
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
        if ($this->timeoutSeconds < 1 || $this->timeoutSeconds > 60
            || $this->connectTimeoutSeconds < 1 || $this->connectTimeoutSeconds > $this->timeoutSeconds) {
            throw new AssistantException('PROVIDER_NOT_CONFIGURED', 'The assistant provider is not configured.', 503);
        }
    }
}
