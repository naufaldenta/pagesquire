<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

use PageSquire\Server\AssistantException;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use PageSquire\Server\ProviderConfiguration;
use Throwable;

final class OpenAiCompatibleProvider implements Provider
{
    /** @var array<string, mixed> */
    private readonly array $config;

    public function __construct(
        private readonly ProtocolValidator $validator,
        private readonly string $endpoint,
        private readonly string $apiKey,
        private readonly string $model,
        private readonly HttpClient $http = new CurlHttpClient,
        private readonly int $timeoutSeconds = 20,
        array $options = [],
        /**
         * Trusted hook receiving {outcome, status?, latencyMs, usage?} metadata.
         * It never sees prompts, completions, headers or keys; its errors are ignored.
         *
         * @var (callable(array<string, mixed>): void)|null
         */
        private readonly mixed $onDiagnostic = null,
    ) {
        $this->config = ProviderConfiguration::resolve([...$options, 'endpoint' => $endpoint, 'apiKey' => $apiKey, 'model' => $model]);
        if ($timeoutSeconds < 1 || $timeoutSeconds > 60) {
            throw new AssistantException('INVALID_PROVIDER_CONFIG', 'Configure a server-owned HTTPS provider.', 500);
        }
    }

    /** @param array<string, mixed> $env */
    /** @param (callable(array<string, mixed>): void)|null $onDiagnostic */
    public static function fromEnvironment(ProtocolValidator $validator, array $env, HttpClient $http = new CurlHttpClient, int $timeoutSeconds = 20, ?callable $onDiagnostic = null): self
    {
        $config = ProviderConfiguration::fromEnvironment($env);

        return new self($validator, $config['endpoint'], $config['apiKey'], $config['model'], $http, $timeoutSeconds, $config, $onDiagnostic);
    }

    public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
    {
        $started = hrtime(true);
        $report = function (string $outcome, array $extra = []) use ($started): void {
            try {
                if ($this->onDiagnostic !== null) {
                    ($this->onDiagnostic)(['outcome' => $outcome, ...$extra, 'latencyMs' => intdiv(hrtime(true) - $started, 1_000_000)]);
                }
            } catch (Throwable) {
                // Diagnostics never change a provider outcome.
            }
        };
        try {
            $body = $this->http->post($this->config['endpoint'], ['Content-Type: application/json', 'Accept: application/json', 'Accept-Encoding: identity', 'Authorization: Bearer '.$this->apiKey], json_encode(CompletionCodec::request($this->config, $messages, $maxOutputTokens, $capabilities), JSON_THROW_ON_ERROR), $this->timeoutSeconds, 262144);
        } catch (Throwable $error) {
            $report($error instanceof ProviderHttpException ? $error->outcome : 'network_error', $error instanceof ProviderHttpException && $error->status !== null ? ['status' => $error->status] : []);
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        }
        $usage = CompletionCodec::usage($body);
        try {
            $draft = CompletionCodec::decode($body, $this->validator, $this->config, $capabilities);
        } catch (Throwable) {
            $report('invalid_response', $usage === null ? [] : ['usage' => $usage]);
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        }
        $report('ok', $usage === null ? [] : ['usage' => $usage]);

        return $draft;
    }
}
