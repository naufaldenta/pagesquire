<?php

declare(strict_types=1);

namespace PageSquire\Tests\Server;

use PageSquire\Server\AssistantException;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\Http\ChatEndpoint;
use PageSquire\Server\Http\CurlHttpClient;
use PageSquire\Server\Http\FileConversationStore;
use PageSquire\Server\Http\HttpClient;
use PageSquire\Server\Http\OpenAiCompatibleProvider;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class NativeHttpTest extends TestCase
{
    private string $directory;

    private array $fixture;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir().'/pagesquire-native-test-'.bin2hex(random_bytes(8));
        mkdir($this->directory, 0700);
        $this->fixture = json_decode(file_get_contents(__DIR__.'/../../fixtures/conformance.json'), true, 64, JSON_THROW_ON_ERROR);
    }

    protected function tearDown(): void
    {
        $this->assertSame(realpath(sys_get_temp_dir()), dirname(realpath($this->directory)));
        foreach (glob($this->directory.'/*') ?: [] as $file) {
            unlink($file);
        }
        rmdir($this->directory);
    }

    private function session(): array
    {
        return ['key' => 'trusted-session', 'principal' => 'member-1:revision-1', 'csrfToken' => str_repeat('a', 48), 'capabilityIds' => ['testing.set']];
    }

    private function headers(): array
    {
        return ['Origin' => 'https://example.test', 'Content-Type' => 'application/json', 'X-CSRF-TOKEN' => $this->session()['csrfToken']];
    }

    private function endpoint(bool $failure = false, int $limit = 20): ChatEndpoint
    {
        $provider = new class($failure, $this->fixture['drafts']['action']) implements Provider
        {
            public function __construct(private bool $failure, private array $draft) {}

            public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
            {
                if ($this->failure) {
                    throw new RuntimeException('private-secret');
                }

                return $this->draft;
            }
        };
        $validator = new ProtocolValidator;

        return new ChatEndpoint(new ConversationEngine($provider, $validator, $this->fixture['manifest']), $validator, new FileConversationStore($this->directory), 'https://example.test', $limit);
    }

    public function test_native_endpoint_requires_authority_origin_csrf_and_json(): void
    {
        $endpoint = $this->endpoint();
        $body = json_encode($this->fixture['request'], JSON_THROW_ON_ERROR);
        $this->assertSame(403, $endpoint->handle('POST', $this->headers(), $body, null)['status']);
        foreach ([['Origin', 'https://attacker.test', 403], ['X-CSRF-TOKEN', '', 419], ['Content-Type', 'text/plain', 415], ['Content-Encoding', 'gzip', 415]] as [$header, $value, $status]) {
            $headers = $this->headers();
            $headers[$header] = $value;
            $this->assertSame($status, $endpoint->handle('POST', $headers, $body, $this->session())['status']);
        }
        $this->assertSame(405, $endpoint->handle('GET', [], '', null)['status']);
        $this->assertSame(413, $endpoint->handle('POST', $this->headers(), str_repeat('x', 196609), $this->session())['status']);
        $this->assertSame(422, $endpoint->handle('POST', $this->headers(), '{bad', $this->session())['status']);
    }

    public function test_native_state_survives_adapter_restart_and_exact_retry(): void
    {
        $body = json_encode($this->fixture['request'], JSON_THROW_ON_ERROR);
        $first = $this->endpoint()->handle('POST', $this->headers(), $body, $this->session());
        $this->assertSame(200, $first['status']);
        $this->assertSame(json_encode($first), json_encode($this->endpoint()->handle('POST', $this->headers(), $body, $this->session())));
        (new FileConversationStore($this->directory))->transaction('trusted-session', function (?array $stored): void {
            $this->assertSame(1, $stored['state']['attempts']);
            $this->assertSame(2, $stored['rate']['count']);
        });
        $session = $this->session();
        $session['capabilityIds'] = [];
        $this->assertSame(403, $this->endpoint()->handle('POST', $this->headers(), $body, $session)['status']);
        $session = $this->session();
        $session['principal'] = 'another-user';
        $request = $this->fixture['request'];
        $request['conversationId'] = $first['body']['conversationId'];
        $request['requestId'] = 'next-request';
        $this->assertSame(409, $this->endpoint()->handle('POST', $this->headers(), json_encode($request), $session)['status']);
    }

    public function test_failed_attempt_is_durable_and_replay_does_not_call_provider(): void
    {
        $body = json_encode($this->fixture['request']);
        $first = $this->endpoint(true)->handle('POST', $this->headers(), $body, $this->session());
        $this->assertSame(502, $first['status']);
        $this->assertStringNotContainsString('private-secret', json_encode($first));
        $this->assertSame(409, $this->endpoint()->handle('POST', $this->headers(), $body, $this->session())['status']);
        (new FileConversationStore($this->directory))->transaction('trusted-session', function (?array $stored): void {
            $this->assertSame(1, $stored['state']['attempts']);
        });
    }

    public function test_rate_limit_survives_principal_change_and_lock_fails_closed(): void
    {
        $body = json_encode($this->fixture['request']);
        $this->assertSame(200, $this->endpoint(limit: 1)->handle('POST', $this->headers(), $body, $this->session())['status']);
        $session = $this->session();
        $session['principal'] = 'other-user';
        $this->assertSame(429, $this->endpoint(limit: 1)->handle('POST', $this->headers(), $body, $session)['status']);
        $store = new FileConversationStore($this->directory);
        $store->transaction('lock', function () use ($store): void {
            try {
                $store->transaction('lock', fn (): bool => true);
                $this->fail('Expected an exclusive transaction.');
            } catch (AssistantException $error) {
                $this->assertSame('BUSY', $error->errorCode);
            }
        });
    }

    public function test_raw_array_evidence_is_rejected_before_php_normalization(): void
    {
        $request = $this->fixture['request'];
        unset($request['message']);
        $request['conversationId'] = 'conversation';
        $request['result'] = ['protocolVersion' => '0.1', 'callId' => 'call', 'capabilityId' => 'testing.set', 'status' => 'success', 'code' => 'OK', 'message' => '', 'evidence' => []];
        $this->assertSame(422, $this->endpoint()->handle('POST', $this->headers(), json_encode($request), $this->session())['status']);
    }

    public function test_file_checkpoints_preserve_empty_and_nested_parameter_objects(): void
    {
        $store = new FileConversationStore($this->directory);
        $value = ['state' => ['pending' => ['parameters' => (object) ['nested' => (object) []]], 'lastReply' => ['response' => ['toolCalls' => [['parameters' => (object) []]]]]]];
        $store->transaction('objects', function (?array $stored, callable $save) use ($value): void {
            $save($value);
        });
        $store->transaction('objects', function (?array $stored) use ($value): void {
            $this->assertSame(json_encode($value), json_encode($stored));
            $this->assertInstanceOf(\stdClass::class, $stored['state']['pending']['parameters']->nested);
            $this->assertInstanceOf(\stdClass::class, $stored['state']['lastReply']['response']['toolCalls'][0]['parameters']);
        });
    }

    public function test_native_provider_uses_server_configuration_and_rejects_invalid_raw_output(): void
    {
        $http = new class implements HttpClient
        {
            public string $content = '{"text":"Hello","emotion":"invented","finished":true,"toolCalls":[]}';

            public array $received = [];

            public function post(string $url, array $headers, string $body, int $timeoutSeconds, int $maxBytes): string
            {
                $this->received[] = compact('url', 'headers', 'body', 'timeoutSeconds', 'maxBytes');

                return json_encode(['choices' => [['message' => ['content' => $this->content]]]], JSON_THROW_ON_ERROR);
            }
        };
        $provider = new OpenAiCompatibleProvider(new ProtocolValidator, 'https://provider.test/chat/completions', 'server-key', 'fixture', $http);
        $this->assertSame('idle', $provider->complete([], [], 100)['emotion']);
        $this->assertCount(1, $http->received);
        $this->assertSame(262144, $http->received[0]['maxBytes']);
        $this->assertSame(20, $http->received[0]['timeoutSeconds']);
        $this->assertContains('Authorization: Bearer server-key', $http->received[0]['headers']);
        $this->assertSame(100, json_decode($http->received[0]['body'], true)['max_tokens']);
        foreach (['not JSON secret', '{"text":"","emotion":"idle","finished":false,"toolCalls":[{"capabilityId":"testing.set","parameters":[]}]}', str_repeat('x', 65537)] as $invalid) {
            $http->content = $invalid;
            try {
                $provider->complete([], [], 100);
                $this->fail('Invalid provider output must fail.');
            } catch (AssistantException $error) {
                $this->assertSame('PROVIDER_UNAVAILABLE', $error->errorCode);
                $this->assertStringNotContainsString('secret', $error->getMessage());
            }
        }
        $this->assertCount(4, $http->received);
    }

    public function test_native_transport_refuses_non_https_before_network_access(): void
    {
        $this->expectException(AssistantException::class);
        (new CurlHttpClient)->post('http://127.0.0.1/private', [], '{}', 1, 100);
    }
}
