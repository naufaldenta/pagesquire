<?php

declare(strict_types=1);

namespace PageSquire\Tests\Server;

use PageSquire\Server\AssistantException;
use PageSquire\Server\Http\CompletionCodec;
use PageSquire\Server\Http\HttpClient;
use PageSquire\Server\Http\OpenAiCompatibleProvider;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\ProviderConfiguration;
use PHPUnit\Framework\TestCase;

final class ProviderConfigurationTest extends TestCase
{
    public function test_every_preset_uses_the_owner_model_and_exact_dialect_without_retries(): void
    {
        $this->assertCount(16, ProviderConfiguration::presets());
        foreach (ProviderConfiguration::presets() as $preset) {
            $http = new class implements HttpClient
            {
                public array $requests = [];

                public function post(string $url, array $headers, string $body, int $timeoutSeconds, int $maxBytes): string
                {
                    $this->requests[] = compact('url', 'headers', 'body', 'timeoutSeconds', 'maxBytes');

                    return json_encode(['choices' => [['finish_reason' => 'stop', 'message' => ['content' => '{"text":"Hello","emotion":"happy","finished":true,"toolCalls":[]}']]]]);
                }
            };
            $provider = OpenAiCompatibleProvider::fromEnvironment(new ProtocolValidator, ['PAGESQUIRE_PROVIDER' => $preset['id'], 'PAGESQUIRE_PROVIDER_URL' => $preset['endpoint'] ?? 'https://gateway.test/v1/chat/completions', 'PAGESQUIRE_API_KEY' => 'synthetic-key', 'PAGESQUIRE_MODEL' => 'owner-selected-model'], $http);
            $this->assertSame('Hello', $provider->complete([], [], 500)['text']);
            $this->assertCount(1, $http->requests);
            $body = json_decode($http->requests[0]['body'], true);
            $this->assertSame('owner-selected-model', $body['model']);
            $this->assertSame(500, $body[$preset['tokenParameter']]);
            $this->assertFalse($body['stream']);
            $this->assertSame($preset['responseMode'] === 'json_object', isset($body['response_format']));
            $this->assertSame(262144, $http->requests[0]['maxBytes']);
        }
    }

    public function test_env_aliases_and_conflicts_fail_closed(): void
    {
        $legacy = ['PAGESQUIRE_PROVIDER_ENDPOINT' => 'https://legacy.test/chat/completions', 'PAGESQUIRE_PROVIDER_KEY' => 'private', 'PAGESQUIRE_PROVIDER_MODEL' => 'chosen'];
        $this->assertSame('custom', ProviderConfiguration::fromEnvironment($legacy)['provider']);
        foreach ([['PAGESQUIRE_API_KEY' => 'conflict'], ['PAGESQUIRE_PROVIDER' => 'unknown'], ['PAGESQUIRE_RESPONSE_MODE' => 'retry'], ['PAGESQUIRE_PROVIDER_ENDPOINT' => 'http://localhost/private'], ['PAGESQUIRE_PROVIDER_ENDPOINT' => 'https://provider.test/chat?key=private']] as $change) {
            try {
                ProviderConfiguration::fromEnvironment(array_replace($legacy, $change));
                $this->fail('Expected invalid configuration');
            } catch (AssistantException $error) {
                $this->assertSame('INVALID_PROVIDER_CONFIG', $error->errorCode);
                $this->assertStringNotContainsString('private', $error->getMessage());
            }
        }
    }

    public function test_dialect_overrides_consolidate_instructions_without_model_name_guessing(): void
    {
        $config = ProviderConfiguration::resolve(['provider' => 'qwen', 'endpoint' => 'https://workspace.test/chat/completions', 'apiKey' => 'key', 'model' => 'chosen', 'responseMode' => 'prompt', 'tokenParameter' => 'max_completion_tokens', 'systemRole' => 'developer', 'thinking' => 'disabled']);
        $body = CompletionCodec::request($config, [['role' => 'system', 'content' => 'First'], ['role' => 'user', 'content' => 'Untrusted'], ['role' => 'system', 'content' => 'Second']], 100);
        $this->assertSame([['role' => 'developer', 'content' => "First\n\nSecond"], ['role' => 'user', 'content' => 'Untrusted']], $body['messages']);
        $this->assertFalse($body['enable_thinking']);
        $this->assertSame(100, $body['max_completion_tokens']);
        $this->assertArrayNotHasKey('max_tokens', $body);
        $this->assertArrayNotHasKey('response_format', $body);
    }

    public function test_only_complete_json_or_whole_fences_pass_strict_decoding(): void
    {
        $json = '{"text":"Hello","emotion":"happy","finished":true,"toolCalls":[]}';
        $validator = new ProtocolValidator;
        foreach ([$json, "```json\n".$json."\n```", [['type' => 'text', 'text' => $json]]] as $content) {
            $this->assertSame('Hello', CompletionCodec::decode(json_encode(['choices' => [['message' => ['content' => $content]]]]), $validator)['text']);
        }
        foreach ([['finish_reason' => 'length', 'message' => ['content' => $json]], ['message' => ['refusal' => 'no', 'content' => $json]], ['message' => ['content' => 'Here is JSON: '.$json]], ['message' => ['content' => '[]']], ['message' => ['content' => str_repeat('x', 65537)]], ['message' => ['content' => $json, 'tool_calls' => [['id' => 'call']]]], ['message' => ['content' => str_replace('"text":', '"selector":"body","text":', $json)]]] as $choice) {
            try {
                CompletionCodec::decode(json_encode(['choices' => [$choice]]), $validator);
                $this->fail('Expected invalid output');
            } catch (AssistantException $error) {
                $this->assertSame('INVALID_PROVIDER_RESPONSE', $error->errorCode);
            }
        }
    }
}
