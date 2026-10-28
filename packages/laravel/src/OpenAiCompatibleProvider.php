<?php

namespace PageSquire\Laravel;

use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use PageSquire\Laravel\Events\ProviderCalled;
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
        private readonly ?Dispatcher $events = null,
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

        $started = hrtime(true);
        $report = function (string $outcome, array $extra = []) use ($started): void {
            try {
                $this->events?->dispatch(new ProviderCalled(['outcome' => $outcome, ...$extra, 'latencyMs' => intdiv(hrtime(true) - $started, 1_000_000)]));
            } catch (Throwable) {
                // Diagnostics never change a provider outcome.
            }
        };

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
                ->post($config['endpoint'], CompletionCodec::request($config, $messages, $maxOutputTokens, $capabilities));
        } catch (ConnectionException $exception) {
            $report(str_contains(strtolower($exception->getMessage()), 'timed out') ? 'timeout' : 'network_error');
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        } catch (Throwable) {
            $report('network_error');
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        }

        if (! $response->successful() || strlen($response->body()) > 262144) {
            $report($response->successful() ? 'invalid_response' : 'http_error', ['status' => $response->status()]);
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        }
        $usage = CompletionCodec::usage($response->body());
        $extra = ['status' => $response->status(), ...($usage === null ? [] : ['usage' => $usage])];

        try {
            $draft = CompletionCodec::decode($response->body(), $this->validator, $config, $capabilities);
        } catch (Throwable $exception) {
            $report('invalid_response', $extra);
            throw $exception instanceof AssistantException ? $exception : new AssistantException('INVALID_PROVIDER_RESPONSE', 'The assistant provider returned an invalid response.', 502);
        }
        $report('ok', $extra);

        return $draft;
    }

    private function assertConfiguration(): void
    {
        if ($this->timeoutSeconds < 1 || $this->timeoutSeconds > 60
            || $this->connectTimeoutSeconds < 1 || $this->connectTimeoutSeconds > $this->timeoutSeconds) {
            throw new AssistantException('PROVIDER_NOT_CONFIGURED', 'The assistant provider is not configured.', 503);
        }
    }
}
