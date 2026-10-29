<?php

declare(strict_types=1);

namespace PageSquire\Tests\Server;

use PageSquire\Server\ActionSigner;
use PageSquire\Server\AssistantException;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\Link\A2A;
use PageSquire\Server\Link\Link;
use PageSquire\Server\Link\LinkManager;
use PageSquire\Server\Link\LinkStore;
use PageSquire\Server\Link\MemoryLinkStore;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use PHPUnit\Framework\TestCase;

/** PageSquire Link's optional A2A interface (Phase 6E), mirroring tests/unit/a2a.test.mjs. */
final class A2ATest extends TestCase
{
    /** @var array<string, mixed> */
    private array $vector;

    private string $signingKey;

    protected function setUp(): void
    {
        $this->vector = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/a2a.json'), true);
        $this->signingKey = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/signing.json'), true)['signingKey'];
    }

    public function test_canonical_json_and_the_agent_card_signature_match_the_shared_vector(): void
    {
        $raw = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/a2a.json'));
        foreach ($raw->canonical as $case) {
            $this->assertSame($case->output, A2A::canonicalize($case->input));
        }
        $manager = $this->site();
        $this->assertSame($this->vector['jwk'], A2A::jwk(new ActionSigner($this->signingKey, 'https://resto.test')));
        $card = $manager->agentCard();
        $this->assertSame($this->vector['card']['signatures'], $card['signatures']);
        $this->assertSame(A2A::canonicalize($raw->card), A2A::canonicalize(json_decode((string) json_encode($card))));
        $this->assertSame(['keys' => [$this->vector['jwk']]], $manager->agentKeys());
    }

    public function test_the_agent_card_verifies_with_the_published_key_set(): void
    {
        $manager = $this->site(['endpoint' => '/pagesquire/a2a', 'skills' => ['book_table']]);
        $card = json_decode((string) json_encode($manager->agentCard()));
        $keys = json_decode((string) json_encode($manager->agentKeys()));
        $this->assertSame(['book_table'], array_column((array) json_decode((string) json_encode($card->skills), true), 'id'));
        $this->assertTrue(A2A::verifyCard($card, $keys));
        $tampered = clone $card;
        $tampered->name = 'Restoran Palsu';
        $this->assertFalse(A2A::verifyCard($tampered, $keys));
        $other = json_decode((string) json_encode(['keys' => [A2A::jwk(new ActionSigner(ActionSigner::generate()['signingKey'], 'https://resto.test'))]]));
        $this->assertFalse(A2A::verifyCard($card, $other));
        // Node signed the vector's card; PHP verifies it.
        $raw = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/a2a.json'));
        $this->assertTrue(A2A::verifyCard($raw->card, (object) ['keys' => [$raw->jwk]]));
        try {
            $this->site(false)->agentCard();
            $this->fail('A card was built without the A2A interface.');
        } catch (AssistantException $exception) {
            $this->assertSame('A2A_DISABLED', $exception->errorCode);
        }
    }

    public function test_an_agent_sends_a_request_and_gets_a_single_use_link(): void
    {
        $manager = $this->site();
        $answer = $this->rpc($manager, 'SendMessage', $this->tableForFour() + ['configuration' => ['acceptedOutputModes' => ['text/plain']]]);
        $reply = $answer['result']['message'];
        $this->assertSame(['ROLE_AGENT', 'ctx-1'], [$reply['role'], $reply['contextId']]);
        $url = $reply['parts'][1]['data']['url'];
        $this->assertMatchesRegularExpression('~^https://resto\.test/reservations#psq-agent=[\w-]{22}$~', $url);
        $this->assertStringContainsString($url, $reply['parts'][0]['text']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/', $reply['parts'][1]['data']['expiresAt']);
        $ticket = $manager->redeem(explode('#psq-agent=', $url)[1]);
        $this->assertSame(['kind' => 'agent', 'link' => 'a2a', 'skill' => 'book_table', 'goal' => 'A table for 4 on 29 October', 'fields' => ['date' => '2026-10-29', 'people' => 4]], array_diff_key($ticket, ['expiresAt' => true]));
        $this->assertNull($manager->redeem(explode('#psq-agent=', $url)[1]));
        $agents = $manager->overview()['agents'];
        $this->assertSame([1, ['book_table', 'order_catering']], [$agents['received'], $agents['skills']]);

        $one = $this->site(['endpoint' => '/pagesquire/a2a', 'skills' => ['order_catering']]);
        $text = $this->rpc($one, 'SendMessage', ['message' => ['messageId' => 'm-2', 'role' => 'ROLE_USER', 'parts' => [['text' => ' Catering for 40 people on Friday. ']]]]);
        $code = explode('#psq-agent=', $text['result']['message']['parts'][1]['data']['url'])[1];
        $this->assertSame('Catering for 40 people on Friday.', $one->redeem($code)['goal']);
    }

    public function test_the_endpoint_refuses_what_it_does_not_serve(): void
    {
        $manager = $this->site();
        $error = fn (string $method, array $params, string $version = '1.0'): array => $this->rpc($manager, $method, $params, $version)['error'];
        $this->assertSame(-32009, $error('SendMessage', $this->tableForFour(), '')['code']);
        $this->assertSame(-32001, $error('GetTask', ['id' => 'task-1'])['code']);
        $this->assertSame(-32004, $error('SendStreamingMessage', $this->tableForFour())['code']);
        $this->assertSame(-32007, $error('GetExtendedAgentCard', [])['code']);
        $this->assertSame(-32601, $error('Nonsense', [])['code']);
        $message = static fn (array $parts): array => ['message' => ['messageId' => 'm-3', 'role' => 'ROLE_USER', 'parts' => $parts]];
        $scope = $error('SendMessage', $message([['data' => ['skill' => 'cook_dinner', 'goal' => 'Dinner']]]));
        $this->assertSame([-32602, 'HANDOFF_SCOPE'], [$scope['code'], $scope['data'][0]['reason']]);
        $this->assertSame('HANDOFF_INVALID', $error('SendMessage', $message([['data' => ['skill' => 'book_table', 'goal' => 'A table', 'fields' => ['people' => 99]]]]))['data'][0]['reason']);
        $this->assertSame('A2A_INVALID', $error('SendMessage', $message([['data' => ['skill' => 'book_table', 'goal' => 'Book at https://evil.example']]]))['data'][0]['reason']);
        $this->assertSame(-32005, $error('SendMessage', $message([['url' => 'https://evil.example/menu.pdf']]))['code']);
        $this->assertSame(-32001, $error('SendMessage', ['message' => ['taskId' => 'task-1'] + $this->tableForFour()['message']])['code']);
        $this->assertSame(-32602, $error('SendMessage', ['message' => ['role' => 'ROLE_AGENT'] + $this->tableForFour()['message']])['code']);
        $this->assertSame(-32700, A2A::answer($manager, '{', '1.0')['error']['code']);
        $this->assertSame(-32600, A2A::answer($manager, '{"jsonrpc":"1.0","method":"SendMessage"}', '1.0')['error']['code']);
    }

    public function test_the_visitor_arrives_from_an_agents_link_and_the_assistant_continues(): void
    {
        $store = new MemoryLinkStore;
        $manager = $this->site(null, $store);
        $code = explode('#psq-agent=', $this->rpc($manager, 'SendMessage', $this->tableForFour())['result']['message']['parts'][1]['data']['url'])[1];
        $provider = new class implements Provider
        {
            /** @var list<list<array{role: string, content: mixed}>> */
            public array $received = [];

            /** @var list<list<string>> */
            public array $capabilities = [];

            public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
            {
                $this->received[] = $messages;
                $this->capabilities[] = array_column($capabilities, 'id');

                return ['text' => 'Shall I book 4 people on 29 October?', 'emotion' => 'happy', 'finished' => true, 'toolCalls' => []];
            }
        };
        $all = ['link.handoff', 'link.return'];
        $engine = new ConversationEngine($provider, new ProtocolValidator, ['schemaVersion' => '0.1', 'capabilities' => [Link::handoffCapability(), Link::returnCapability()]], locale: 'id', links: $manager);
        $engine->handle(['protocolVersion' => '0.1', 'requestId' => 'arrive', 'linkCode' => $code, 'snapshot' => ['protocolVersion' => '0.1', 'id' => 'snapshot-1', 'url' => 'https://resto.test/reservations', 'title' => 'Restoran Laut', 'text' => 'Reservasi', 'targets' => [], 'truncated' => ['text' => false, 'targets' => false]], 'capabilityIds' => $all], null, $all);
        $messages = $provider->received[0];
        $this->assertSame('Permintaan dari agen AI: A table for 4 on 29 October', $messages[count($messages) - 2]['content']);
        $this->assertSame(['from' => 'an AI agent (A2A)', 'skill' => 'book_table', 'fields' => ['date' => '2026-10-29', 'people' => 4]], json_decode($messages[count($messages) - 1]['content'], true)['untrustedHandoff']);
        $this->assertSame([], $provider->capabilities[0]);

        // Turning the interface off voids open links.
        $again = explode('#psq-agent=', $this->rpc($manager, 'SendMessage', $this->tableForFour())['result']['message']['parts'][1]['data']['url'])[1];
        $this->assertNull($this->site(false, $store)->redeem($again));
    }

    public function test_agents_may_hold_at_most_half_of_the_open_codes(): void
    {
        $store = new MemoryLinkStore;
        $store->transaction(static function (array &$data): void {
            for ($index = 0; $index < 500; $index++) {
                $data['tickets']['agent-'.$index] = ['kind' => 'agent', 'link' => 'a2a', 'skill' => 'book_table', 'goal' => 'A table', 'fields' => [], 'expiresAt' => (int) (microtime(true) * 1000) + 600_000];
            }
        });
        $busy = $this->rpc($this->site(null, $store), 'SendMessage', $this->tableForFour())['error'];
        $this->assertSame([-32603, 'LINK_BUSY'], [$busy['code'], $busy['data'][0]['reason']]);
    }

    /** @param array{endpoint: string, skills: list<string>}|false|null $a2a  null: the vector's settings; false: A2A off. */
    private function site(array|false|null $a2a = null, ?LinkStore $store = null): LinkManager
    {
        return new LinkManager(new ActionSigner($this->signingKey, $this->vector['origin']), $store ?? new MemoryLinkStore, ['endpoint' => '/pagesquire/link', 'name' => $this->vector['name'], 'skills' => $this->vector['skills']], a2a: $a2a === false ? null : ($a2a ?? $this->vector['a2a']));
    }

    /** @return array<string, mixed> */
    private function rpc(LinkManager $manager, string $method, array $params, string $version = '1.0'): array
    {
        return A2A::answer($manager, (string) json_encode(['jsonrpc' => '2.0', 'id' => 7, 'method' => $method, 'params' => $params]), $version);
    }

    /** @return array<string, mixed> */
    private function tableForFour(): array
    {
        return ['message' => ['messageId' => 'm-1', 'contextId' => 'ctx-1', 'role' => 'ROLE_USER', 'parts' => [
            ['text' => 'Book a table for four.'],
            ['data' => ['skill' => 'book_table', 'goal' => 'A table for 4 on 29 October', 'fields' => ['date' => '2026-10-29', 'people' => 4]], 'mediaType' => 'application/json'],
        ]]];
    }
}
