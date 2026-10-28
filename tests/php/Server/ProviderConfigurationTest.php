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

    public function test_tools_mode_sends_native_functions_and_decodes_only_the_first_known_call(): void
    {
        $capabilities = [['id' => 'accessibility.set_heading_color', 'description' => 'Change heading color only.', 'execution' => 'browser', 'handler' => 'headings', 'verification' => ['handler' => 'verifyHeadings'], 'risk' => 'reversible', 'inputSchema' => ['type' => 'object', 'properties' => ['color' => ['type' => 'string']], 'required' => ['color'], 'additionalProperties' => false]]];
        $config = ProviderConfiguration::resolve(['provider' => 'openai', 'apiKey' => 'key', 'model' => 'chosen', 'responseMode' => 'tools']);
        $body = json_decode(json_encode(CompletionCodec::request($config, [['role' => 'system', 'content' => 'Trusted.'], ['role' => 'user', 'content' => 'Red headings.']], 500, $capabilities)), true);
        $this->assertArrayNotHasKey('response_format', $body);
        $this->assertSame('accessibility_set_heading_color', $body['tools'][0]['function']['name']);
        $this->assertSame($capabilities[0]['inputSchema'], $body['tools'][0]['function']['parameters']);
        $this->assertStringContainsString('Tool mode: to act, call exactly one', $body['messages'][0]['content']);
        $this->assertArrayNotHasKey('tools', CompletionCodec::request($config, [], 500, []));
        $call = static fn (string $name, string $arguments, array $extra = []): string => json_encode(['choices' => [['finish_reason' => 'tool_calls', 'message' => ['content' => null, 'tool_calls' => [['type' => 'function', 'function' => ['name' => $name, 'arguments' => $arguments]], ['type' => 'function', 'function' => ['name' => 'accessibility_set_heading_color', 'arguments' => '{"color":"#00ff00"}']]], ...$extra]]]]);
        $validator = new ProtocolValidator;
        $draft = CompletionCodec::decode($call('accessibility_set_heading_color', '{"color":"#ff0000"}'), $validator, $config, $capabilities);
        $this->assertFalse($draft['finished']);
        $this->assertCount(1, $draft['toolCalls']);
        $this->assertSame('accessibility.set_heading_color', $draft['toolCalls'][0]['capabilityId']);
        $this->assertSame('#ff0000', $draft['toolCalls'][0]['parameters']->color);
        foreach ([$call('unknown_capability', '{}'), $call('accessibility_set_heading_color', '[1]'), $call('accessibility_set_heading_color', '{broken'), $call('accessibility_set_heading_color', '{}', ['refusal' => 'No.'])] as $invalid) {
            try {
                CompletionCodec::decode($invalid, $validator, $config, $capabilities);
                $this->fail('Expected an invalid tool call.');
            } catch (AssistantException $error) {
                $this->assertSame('INVALID_PROVIDER_RESPONSE', $error->errorCode);
            }
        }
        $plain = CompletionCodec::decode(json_encode(['choices' => [['finish_reason' => 'stop', 'message' => ['content' => 'Headings are already red.']]]]), $validator, $config, $capabilities);
        $this->assertSame(['text' => 'Headings are already red.', 'emotion' => 'idle', 'finished' => true, 'toolCalls' => []], $plain);
        $this->expectException(AssistantException::class);
        CompletionCodec::decode(json_encode(['choices' => [['finish_reason' => 'stop', 'message' => ['content' => 'Plain text outside tools mode.']]]]), $validator);
    }

    public function test_provider_diagnostics_report_metadata_without_content_or_keys(): void
    {
        $events = [];
        $make = static function (\Closure $reply) use (&$events): OpenAiCompatibleProvider {
            $http = new class($reply) implements HttpClient
            {
                public function __construct(private \Closure $reply) {}

                public function post(string $url, array $headers, string $body, int $timeoutSeconds, int $maxBytes): string
                {
                    return ($this->reply)();
                }
            };

            return new OpenAiCompatibleProvider(new ProtocolValidator, 'https://provider.test/chat', 'secret-key-marker', 'chosen', $http, 20, [], static function (array $event) use (&$events): void {
                $events[] = $event;
                throw new \RuntimeException('A failing hook must not change the outcome');
            });
        };
        $reply = $make(static fn (): string => json_encode(['choices' => [['finish_reason' => 'stop', 'message' => ['content' => '{"text":"Hello","emotion":"happy","finished":true,"toolCalls":[]}']]], 'usage' => ['prompt_tokens' => 12, 'completion_tokens' => 3, 'total_tokens' => 15]]))->complete([['role' => 'user', 'content' => 'prompt-marker']], [], 100);
        $this->assertSame('Hello', $reply['text']);
        foreach ([static fn (): string => throw new \PageSquire\Server\Http\ProviderHttpException('http_error', 429), static fn (): string => throw new \PageSquire\Server\Http\ProviderHttpException('timeout'), static fn (): string => throw new \RuntimeException('network-marker'), static fn (): string => 'not json'] as $failure) {
            try {
                $make($failure)->complete([], [], 100);
                $this->fail('Expected a provider failure.');
            } catch (AssistantException $error) {
                $this->assertSame('PROVIDER_UNAVAILABLE', $error->errorCode);
            }
        }
        foreach ($events as $event) {
            $this->assertIsInt($event['latencyMs']);
            $this->assertGreaterThanOrEqual(0, $event['latencyMs']);
        }
        $this->assertSame([
            ['outcome' => 'ok', 'usage' => ['inputTokens' => 12, 'outputTokens' => 3, 'totalTokens' => 15]],
            ['outcome' => 'http_error', 'status' => 429],
            ['outcome' => 'timeout'],
            ['outcome' => 'network_error'],
            ['outcome' => 'invalid_response'],
        ], array_map(static fn (array $event): array => array_diff_key($event, ['latencyMs' => true]), $events));
        $this->assertStringNotContainsString('marker', json_encode($events));
    }
}
