<?php

declare(strict_types=1);

namespace PageSquire\Tests\Server;

use PageSquire\Server\ConversationEngine;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use PHPUnit\Framework\TestCase;

final class ScreenshotTest extends TestCase
{
    public function test_a_screenshot_reaches_the_next_provider_call_once_and_only_when_enabled(): void
    {
        foreach ([true, false] as $screenshots) {
            $provider = new class implements Provider
            {
                public array $received = [];

                private array $replies = [
                    ['text' => 'Looking', 'emotion' => 'thinking', 'finished' => false, 'toolCalls' => [['capabilityId' => 'ui.screenshot', 'parameters' => ['tab' => 'tab1']]]],
                    ['text' => 'It is blue.', 'emotion' => 'happy', 'finished' => true, 'toolCalls' => []],
                ];

                public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
                {
                    $this->received[] = $messages;

                    return array_shift($this->replies);
                }
            };
            $capability = ['id' => 'ui.screenshot', 'description' => 'Screenshot.', 'execution' => 'browser', 'handler' => 'ui.screenshot', 'inputSchema' => ['type' => 'object', 'properties' => ['tab' => ['type' => 'string', 'pattern' => '^tab[1-9]$']], 'required' => ['tab'], 'additionalProperties' => false], 'risk' => 'read_only', 'verification' => ['handler' => 'ui.screenshot.verify']];
            $engine = new ConversationEngine($provider, new ProtocolValidator, ['schemaVersion' => '0.1', 'capabilities' => [$capability]], screenshots: $screenshots);
            $snapshot = ['protocolVersion' => '0.1', 'id' => 'snapshot-1', 'url' => 'https://example.test/', 'title' => 'Shop', 'text' => 'Shop', 'targets' => [], 'truncated' => ['text' => false, 'targets' => false]];
            $first = $engine->handle(['protocolVersion' => '0.1', 'requestId' => 'r1', 'message' => 'What colour is the button?', 'snapshot' => $snapshot, 'capabilityIds' => ['ui.screenshot']], null, ['ui.screenshot']);
            $call = $first['reply']['response']['toolCalls'][0];
            $second = $engine->handle(['protocolVersion' => '0.1', 'requestId' => 'r2', 'conversationId' => $first['state']['id'], 'snapshot' => $snapshot, 'capabilityIds' => ['ui.screenshot'], 'result' => [
                'protocolVersion' => '0.1', 'callId' => $call['callId'], 'capabilityId' => 'ui.screenshot', 'status' => 'success', 'code' => 'VERIFIED', 'message' => 'ok',
                'evidence' => (object) ['tab' => 'tab1', 'width' => 2, 'height' => 1],
                'screenshot' => ['mediaType' => 'image/jpeg', 'data' => 'AAAA', 'width' => 2, 'height' => 1],
            ]], $first['state'], ['ui.screenshot']);
            $this->assertSame('It is blue.', $second['reply']['response']['text']);
            $last = end($provider->received[1]);
            if ($screenshots) {
                $this->assertSame(['type' => 'image_url', 'image_url' => ['url' => 'data:image/jpeg;base64,AAAA']], $last['content'][1]);
            } else {
                $this->assertIsString($last['content']);
            }
            // Stored history keeps the outcome, never the image.
            $this->assertStringNotContainsString('AAAA', json_encode($second['state'], JSON_THROW_ON_ERROR));
        }
    }
}
