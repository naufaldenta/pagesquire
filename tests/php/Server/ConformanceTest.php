<?php

declare(strict_types=1);

namespace PageSquire\Tests\Server;

use PageSquire\Server\AssistantException;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\MemoryTrajectoryCache;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class ConformanceTest extends TestCase
{
    public static function scenarios(): iterable
    {
        $fixture = json_decode(file_get_contents(__DIR__.'/../../fixtures/conformance.json'), true, 64, JSON_THROW_ON_ERROR);
        foreach ($fixture['cases'] as $case) {
            yield $case['name'] => [$case, $fixture];
        }
    }

    #[DataProvider('scenarios')]
    public function test_shared_protocol_scenario(array $scenario, array $fixture): void
    {
        $provider = new class($scenario, $fixture) implements Provider
        {
            public int $calls = 0;

            private array $queue;

            public function __construct(array $scenario, private array $fixture)
            {
                $this->queue = [];
                foreach ($scenario['turns'] as $turn) {
                    array_push($this->queue, ...($turn['drafts'] ?? (isset($turn['draft']) ? [$turn['draft']] : [])));
                }
            }

            public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
            {
                $this->calls++;
                $name = array_shift($this->queue);
                if ($name === 'error') {
                    throw new RuntimeException('secret provider detail');
                }
                $draft = $this->fixture['drafts'][$name];

                return $draft;
            }
        };
        $engine = new ConversationEngine($provider, new ProtocolValidator, $fixture['manifest'], maxSteps: $scenario['maxSteps'] ?? 8, maxAttempts: $scenario['maxAttempts'] ?? 12, maxRecoveries: $scenario['maxRecoveries'] ?? 0, validateCompletion: $scenario['validateCompletion'] ?? false, plan: $scenario['plan'] ?? false, checkActions: $scenario['checkActions'] ?? false, trajectoryCache: ($scenario['cache'] ?? false) ? new MemoryTrajectoryCache : null);
        $state = null;
        $lastRequest = null;
        foreach ($scenario['turns'] as $index => $turn) {
            $request = $fixture['request'];
            if (in_array($turn['kind'], ['replay', 'conflict'], true)) {
                $request = $lastRequest;
                if ($turn['kind'] === 'conflict') {
                    $request['message'] = 'Changed';
                }
            } elseif ($turn['kind'] === 'fresh') {
                $request['requestId'] = 'request-'.($index + 1);
            } elseif ($turn['kind'] !== 'initial') {
                $request['requestId'] = 'request-'.($index + 1);
                $request['conversationId'] = $state['id'];
                if ($turn['kind'] === 'expired') {
                    $state['expiresAt'] = 1;
                }
                if ($turn['kind'] === 'result') {
                    unset($request['message']);
                    $request['result'] = ['protocolVersion' => '0.1', 'callId' => ($turn['mismatch'] ?? false) ? 'wrong' : $state['pending']['callId'], 'capabilityId' => $state['pending']['capabilityId'], 'status' => $turn['resultStatus'] ?? 'success', 'code' => 'FIXTURE', 'message' => 'Fixture result', 'evidence' => (object) []];
                    if ($turn['observation'] ?? false) {
                        $request['result']['observation'] = ['text' => str_repeat('x', 32000)] + $fixture['request']['snapshot'];
                    }
                }
            }
            $lastRequest = $request;
            try {
                $result = $engine->handle($request, $state, $turn['allowed'] ?? ['testing.set', 'account.delete'], function (array $value) use (&$state): void {
                    $state = $value;
                });
                $state = $result['state'];
                foreach ($state['messages'] as $message) {
                    $this->assertStringNotContainsString('"observation"', $message['content']);
                }
                $outcome =['code' => 'OK', 'status' => 200, 'emotion' => $result['reply']['response']['emotion'], 'finished' => $result['reply']['response']['finished'], 'plan' => $result['reply']['response']['plan'] ?? null];
            } catch (AssistantException $error) {
                $outcome = ['code' => $error->errorCode, 'status' => $error->httpStatus];
            }
            $outcome += ['calls' => $provider->calls, 'attempts' => $state['attempts'] ?? null, 'steps' => $state['steps'] ?? null];
            foreach ($turn['expected'] as $key => $expected) {
                $this->assertSame($expected, $outcome[$key], $scenario['name'].' turn '.($index + 1).' '.$key);
            }
        }
    }
}
