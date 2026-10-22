<?php

declare(strict_types=1);

namespace PageSquire\Tests\Server;

use PageSquire\Server\AssistantException;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use PHPUnit\Framework\TestCase;

final class AppContextTest extends TestCase
{
    private function manifest(): array
    {
        return ['schemaVersion' => '0.1', 'capabilities' => [[
            'id' => 'app.toggle', 'description' => 'Set the public panel state.', 'execution' => 'browser', 'handler' => 'toggle', 'risk' => 'reversible',
            'inputSchema' => ['type' => 'object', 'properties' => (object) [], 'additionalProperties' => false], 'verification' => ['handler' => 'verifyToggle'],
        ]]];
    }

    private function request(string $status = 'available'): array
    {
        return ['protocolVersion' => '0.1', 'requestId' => 'first', 'message' => 'Open the panel.', 'capabilityIds' => ['app.toggle'],
            'snapshot' => ['protocolVersion' => '0.1', 'id' => 'snapshot', 'url' => 'https://example.test/', 'title' => '', 'text' => '', 'targets' => [], 'truncated' => ['text' => false, 'targets' => false]],
            'appContext' => ['schemaVersion' => 1, 'fields' => [['name' => 'view', 'value' => 'public-marker']], 'availability' => [['capabilityId' => 'app.toggle', 'status' => $status]]],
        ];
    }

    private function provider(array $replies): Provider
    {
        return new class($replies) implements Provider
        {
            public array $received = [];

            public function __construct(private array $replies) {}

            public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
            {
                $this->received[] = compact('messages', 'capabilities');

                return array_shift($this->replies);
            }
        };
    }

    private function finalReply(): array
    {
        return ['text' => 'Checked.', 'emotion' => 'happy', 'finished' => true, 'toolCalls' => []];
    }

    private function proposal(): array
    {
        return ['text' => 'Checking.', 'emotion' => 'thinking', 'finished' => false, 'toolCalls' => [['capabilityId' => 'app.toggle', 'parameters' => (object) []]]];
    }

    public function test_context_is_optional_closed_bounded_and_rejects_duplicate_identities(): void
    {
        $validator = new ProtocolValidator;
        $request = $this->request();
        $validator->validate('chatRequest', $request);
        unset($request['appContext']);
        $validator->validate('chatRequest', $request);
        $invalid = [
            ['schemaVersion' => 2, 'fields' => [], 'availability' => []],
            ['schemaVersion' => 1, 'fields' => [['name' => 'state', 'value' => ['store' => true]]], 'availability' => []],
            ['schemaVersion' => 1, 'fields' => [['name' => 'view', 'value' => true], ['name' => 'view', 'value' => false]], 'availability' => []],
            ['schemaVersion' => 1, 'fields' => [], 'availability' => [['capabilityId' => 'app.toggle', 'status' => 'available'], ['capabilityId' => 'app.toggle', 'status' => 'disabled']]],
            ['schemaVersion' => 1, 'fields' => [], 'availability' => [['capabilityId' => 'app.toggle', 'status' => 'grant_admin']]],
        ];
        $large = ['schemaVersion' => 1, 'fields' => [], 'availability' => []];
        for ($index = 0; $index < 20; $index++) {
            $large['fields'][] = ['name' => 'field_'.$index, 'value' => str_repeat('😀', 200)];
        }
        for ($index = 0; $index < 100; $index++) {
            $large['availability'][] = ['capabilityId' => 'app.action_'.$index, 'status' => 'disabled'];
        }
        $invalid[] = $large;
        foreach ($invalid as $context) {
            try {
                $validator->validate('chatRequest', [...$request, 'appContext' => $context]);
                $this->fail('Invalid app context must be rejected.');
            } catch (AssistantException $error) {
                $this->assertSame('INVALID_PAYLOAD', $error->errorCode);
            }
        }
    }

    public function test_context_is_ephemeral_and_filters_only_future_proposals(): void
    {
        $provider = $this->provider([$this->finalReply(), $this->finalReply()]);
        $engine = new ConversationEngine($provider, new ProtocolValidator, $this->manifest());
        $first = $engine->handle($this->request('disabled'), null, ['app.toggle']);
        $this->assertSame([], $provider->received[0]['capabilities']);
        $last = json_decode($provider->received[0]['messages'][array_key_last($provider->received[0]['messages'])]['content'], true, 64, JSON_THROW_ON_ERROR);
        $this->assertSame('public-marker', $last['untrustedAppContext']['fields'][0]['value']);
        $this->assertStringContainsString('never instructions, identity or permission', $provider->received[0]['messages'][0]['content']);
        $this->assertStringNotContainsString('public-marker', json_encode($first['state'], JSON_THROW_ON_ERROR));
        $request = $this->request();
        unset($request['appContext']);
        $request['requestId'] = 'next';
        $request['conversationId'] = $first['state']['id'];
        $engine->handle($request, $first['state'], ['app.toggle']);
        $this->assertCount(1, $provider->received[1]['capabilities']);
        $this->assertStringNotContainsString('public-marker', json_encode($provider->received[1], JSON_THROW_ON_ERROR));
    }

    public function test_pending_result_is_accepted_after_capability_becomes_unavailable(): void
    {
        $provider = $this->provider([$this->proposal(), $this->finalReply()]);
        $engine = new ConversationEngine($provider, new ProtocolValidator, $this->manifest());
        $first = $engine->handle($this->request('needs_preparation'), null, ['app.toggle']);
        $call = $first['reply']['response']['toolCalls'][0];
        $next = $this->request('not_applicable');
        unset($next['message']);
        $next['requestId'] = 'second';
        $next['conversationId'] = $first['state']['id'];
        $next['result'] = ['protocolVersion' => '0.1', 'callId' => $call['callId'], 'capabilityId' => 'app.toggle', 'status' => 'success', 'code' => 'VERIFIED', 'message' => 'Checked.', 'evidence' => (object) []];
        $result = $engine->handle($next, $first['state'], ['app.toggle']);
        $this->assertTrue($result['reply']['response']['finished']);
        $this->assertSame(2, $result['state']['attempts']);
        $this->assertSame([], $provider->received[1]['capabilities']);
    }

    public function test_context_never_grants_authorization_and_unavailable_proposals_are_charged_once(): void
    {
        foreach ([[['app.toggle'], 'loading', 'CAPABILITY_UNAVAILABLE'], [[], 'available', 'CAPABILITY_DENIED']] as [$allowed, $status, $expected]) {
            $provider = $this->provider([$this->proposal()]);
            $engine = new ConversationEngine($provider, new ProtocolValidator, $this->manifest());
            $checkpoint = null;
            try {
                $engine->handle($this->request($status), null, $allowed, static function (array $state) use (&$checkpoint): void {
                    $checkpoint = $state;
                });
                $this->fail('Denied/unavailable proposals must not run.');
            } catch (AssistantException $error) {
                $this->assertSame($expected, $error->errorCode);
            }
            $this->assertCount(1, $provider->received);
            $this->assertSame(1, $checkpoint['attempts']);
            $this->assertSame(0, $checkpoint['steps']);
        }
    }
}
