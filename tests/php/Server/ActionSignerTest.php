<?php

declare(strict_types=1);

namespace PageSquire\Tests\Server;

use PageSquire\Server\ActionSigner;
use PageSquire\Server\AssistantException;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use PHPUnit\Framework\TestCase;

final class ActionSignerTest extends TestCase
{
    public function test_keys_and_signatures_match_the_shared_test_vector(): void
    {
        $vector = $this->vector();
        $signer = new ActionSigner($vector['signingKey'], 'http://shop.test');
        $this->assertSame($vector['publicKey'], $signer->publicKey());
        // Ed25519 is deterministic: the PHP and Node servers produce the same bytes.
        $this->assertSame($vector['signature'], $signer->signClaims($vector['claims']));
    }

    public function test_signed_calls_carry_claims_the_extension_checks(): void
    {
        $vector = $this->vector();
        $signer = new ActionSigner($vector['signingKey'], 'https://shop.example');
        $call = ['protocolVersion' => '0.1', 'callId' => str_repeat('c', 32), 'capabilityId' => 'ui.type', 'snapshotId' => 'snapshot-1', 'parameters' => ['target' => 'target-1', 'text' => 'Halo — café/1']];
        $signed = $signer->sign($call, 1830000000);
        $this->assertSame(
            '{"v":1,"origin":"https://shop.example","callId":"'.str_repeat('c', 32).'","capabilityId":"ui.type","snapshotId":"snapshot-1","parameters":{"target":"target-1","text":"Halo — café/1"},"iat":1830000000,"exp":1830000060}',
            $signed['signature']['claims'],
        );
        $this->assertTrue(sodium_crypto_sign_verify_detached(
            base64_decode($signed['signature']['value'], true),
            ActionSigner::CONTEXT.$signed['signature']['claims'],
            base64_decode(substr($signer->publicKey(), 8), true),
        ));
        (new ProtocolValidator)->validate('actionCall', json_decode(json_encode($signed)));
        $empty = $signer->sign([...$call, 'parameters' => []], 1830000000);
        $this->assertStringContainsString('"parameters":{}', $empty['signature']['claims']);
        $this->assertSame(['version' => 1, 'endpoint' => '/pagesquire/chat', 'publicKey' => $vector['publicKey'], 'features' => ['trustedInput']], $signer->declaration('/pagesquire/chat'));
    }

    public function test_generated_keys_and_origins_are_normalized_and_bounded(): void
    {
        $generated = ActionSigner::generate();
        $this->assertSame($generated['publicKey'], (new ActionSigner($generated['signingKey'], 'http://localhost:8000'))->publicKey());
        $this->assertSame('https://shop.example', ActionSigner::origin('https://Shop.Example:443/path?q=1'));
        $this->assertSame('http://localhost:8000', ActionSigner::origin('http://localhost:8000/'));
        $this->assertNull(ActionSigner::origin('ftp://shop.example'));
        foreach ([['short', 'https://shop.example'], [$generated['signingKey'].'x', 'https://shop.example'], [$generated['signingKey'], 'https://shop.example/path'], [$generated['signingKey'], 'nope']] as [$key, $origin]) {
            try {
                new ActionSigner($key, $origin);
                $this->fail('Accepted invalid signing options.');
            } catch (AssistantException $exception) {
                $this->assertSame('INVALID_OPTIONS', $exception->errorCode);
            }
        }
    }

    public function test_the_engine_signs_replies_but_keeps_the_plain_pending_call(): void
    {
        $vector = $this->vector();
        $capability = ['id' => 'ui.click', 'description' => 'Click.', 'execution' => 'browser', 'handler' => 'ui.click', 'inputSchema' => ['type' => 'object', 'properties' => ['target' => ['type' => 'string']], 'required' => ['target'], 'additionalProperties' => false], 'risk' => 'reversible', 'verification' => ['handler' => 'ui.click.verify']];
        $provider = new class implements Provider
        {
            public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
            {
                return ['text' => 'Clicking', 'emotion' => 'thinking', 'finished' => false, 'toolCalls' => [['capabilityId' => 'ui.click', 'parameters' => ['target' => 'target-1']]]];
            }
        };
        $engine = new ConversationEngine($provider, new ProtocolValidator, ['schemaVersion' => '0.1', 'capabilities' => [$capability]], signer: new ActionSigner($vector['signingKey'], 'http://shop.test'));
        $snapshot = ['protocolVersion' => '0.1', 'id' => 'snapshot-1', 'url' => 'http://shop.test/', 'title' => 'Shop', 'text' => 'Shop', 'targets' => [], 'truncated' => ['text' => false, 'targets' => false]];
        $next = $engine->handle(['protocolVersion' => '0.1', 'requestId' => 'r1', 'message' => 'Click it', 'snapshot' => $snapshot, 'capabilityIds' => ['ui.click']], null, ['ui.click']);
        $call = $next['reply']['response']['toolCalls'][0];
        $claims = json_decode($call['signature']['claims'], true);
        $this->assertSame(['http://shop.test', $call['callId'], 'ui.click', 'snapshot-1', ['target' => 'target-1']], [$claims['origin'], $claims['callId'], $claims['capabilityId'], $claims['snapshotId'], $claims['parameters']]);
        $this->assertArrayNotHasKey('signature', $next['state']['pending']);
    }

    /** @return array{signingKey: string, publicKey: string, claims: string, signature: string} */
    private function vector(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../../fixtures/signing.json'), true, flags: JSON_THROW_ON_ERROR);
    }
}
