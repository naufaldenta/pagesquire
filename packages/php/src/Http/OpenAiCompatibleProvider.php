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
    ) {
        $this->config = ProviderConfiguration::resolve([...$options, 'endpoint' => $endpoint, 'apiKey' => $apiKey, 'model' => $model]);
        if ($timeoutSeconds < 1 || $timeoutSeconds > 60) {
            throw new AssistantException('INVALID_PROVIDER_CONFIG', 'Configure a server-owned HTTPS provider.', 500);
        }
    }

    /** @param array<string, mixed> $env */
    public static function fromEnvironment(ProtocolValidator $validator, array $env, HttpClient $http = new CurlHttpClient, int $timeoutSeconds = 20): self
    {
        $config = ProviderConfiguration::fromEnvironment($env);

        return new self($validator, $config['endpoint'], $config['apiKey'], $config['model'], $http, $timeoutSeconds, $config);
    }

    public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
    {
        try {
            $body = $this->http->post($this->config['endpoint'], ['Content-Type: application/json', 'Accept: application/json', 'Accept-Encoding: identity', 'Authorization: Bearer '.$this->apiKey], json_encode(CompletionCodec::request($this->config, $messages, $maxOutputTokens), JSON_THROW_ON_ERROR), $this->timeoutSeconds, 262144);

            return CompletionCodec::decode($body, $this->validator);
        } catch (Throwable) {
            throw new AssistantException('PROVIDER_UNAVAILABLE', 'The assistant provider is unavailable.', 502);
        }
    }
}
