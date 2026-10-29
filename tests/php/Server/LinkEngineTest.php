<?php

declare(strict_types=1);

namespace PageSquire\Tests\Server;

use PageSquire\Server\ActionSigner;
use PageSquire\Server\AssistantException;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\Link\Link;
use PageSquire\Server\Link\LinkEndpoint;
use PageSquire\Server\Link\LinkManager;
use PageSquire\Server\Link\LinkTransport;
use PageSquire\Server\Link\MemoryLinkStore;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;
use PHPUnit\Framework\TestCase;

/** PageSquire Link handoffs through the PHP engine (Phase 6B-2), mirroring tests/unit/link-engine.test.mjs. */
final class LinkEngineTest extends TestCase
{
    private const BOOK_TABLE = [
        'id' => 'book_table', 'name' => 'Book a table', 'description' => 'Reserve a table for a date, time and party size.', 'tags' => ['restaurant'],
        'fields' => ['date' => ['type' => 'string', 'format' => 'date'], 'time' => ['type' => 'string', 'format' => 'time'], 'people' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 20], 'note' => ['type' => 'string', 'maxLength' => 100]],
        'startPath' => '/reservations',
    ];

    private const SNAPSHOT = ['protocolVersion' => '0.1', 'id' => 'snapshot-1', 'url' => 'http://hotel.test/', 'title' => 'Hotel', 'text' => 'Hotel Nusa', 'targets' => [], 'truncated' => ['text' => false, 'targets' => false]];

    /** @var array<string, array{signer: ActionSigner, manager: LinkManager}> */
    private array $sites = [];

    /** @var list<string> */
    public array $sent = [];

    public function test_a_handoff_is_offered_checked_approved_then_continued_on_the_partner(): void
    {
        [$hotel, $resto, $id] = $this->pair();
        $quiet = $this->provider([$this->said('Our rooms are lovely.')]);
        (new ConversationEngine($quiet, new ProtocolValidator, $this->manifest(), links: $hotel))->handle($this->ask('Hello'), null, ['link.handoff']);
        $this->assertSame([], $quiet->capabilities[0]);

        $hotel->approve($id, ['offer' => ['book_table' => ['date', 'people', 'note']], 'accept' => []]);
        $resto->approve($id, ['offer' => [], 'accept' => ['book_table']]);
        $provider = $this->provider([
            $this->handoff(['skill' => 'resto.test/book_table', 'goal' => 'A table for four tonight', 'fields' => ['date' => '2026-10-29', 'people' => 4, 'time' => '19:00', 'note' => 'Call me at https://evil.example'], 'partner' => ['origin' => 'https://evil.example', 'name' => 'Evil']]),
            $this->said('Restoran Laut is open in a new tab.'),
        ]);
        $engine = new ConversationEngine($provider, new ProtocolValidator, $this->manifest(), links: $hotel);
        $first = $engine->handle($this->ask('Book a table for 4 on 2026-10-29 please'), null, ['link.handoff']);
        $this->assertSame(['link.handoff'], $provider->capabilities[0]);
        $data = json_decode(end($provider->received[0])['content'], true);
        $this->assertSame('resto.test/book_table', $data['partnerSkills'][0]['skill']);
        $this->assertSame(['date', 'people', 'note'], array_keys($data['partnerSkills'][0]['fields']));
        $this->assertStringContainsString('PageSquire Link', $provider->received[0][0]['content']);
        $call = $first['reply']['response']['toolCalls'][0];
        $this->assertEquals(['skill' => 'resto.test/book_table', 'goal' => 'A table for four tonight', 'fields' => (object) ['date' => '2026-10-29', 'people' => 4], 'partner' => ['origin' => 'http://resto.test', 'name' => 'Restoran Laut']], (array) $call['parameters']);
        $this->assertNotContains('handoff', $this->sent);

        $consent = ['protocolVersion' => '0.1', 'requestId' => 'consent', 'conversationId' => $first['state']['id'], 'handoff' => ['callId' => $call['callId']], 'snapshot' => self::SNAPSHOT, 'capabilityIds' => ['link.handoff']];
        $approved = $engine->handle($consent, $first['state'], ['link.handoff']);
        $url = $approved['reply']['response']['handoff']['url'];
        $this->assertMatchesRegularExpression('~^http://resto\.test/reservations#psq-link=[\w-]{22}$~', $url);
        $this->assertSame([], $approved['reply']['response']['toolCalls']);
        $this->assertSame($approved['reply'], $engine->handle($consent, $approved['state'], ['link.handoff'])['reply']);
        try {
            $engine->handle(['requestId' => 'consent-again'] + $consent, $approved['state'], ['link.handoff']);
            $this->fail('The handoff was sent twice.');
        } catch (AssistantException $exception) {
            $this->assertSame('HANDOFF_USED', $exception->errorCode);
        }
        $this->assertSame(['handoff'], array_values(array_filter($this->sent, static fn (string $type): bool => $type === 'handoff')));

        $done = $engine->handle(['protocolVersion' => '0.1', 'requestId' => 'result', 'conversationId' => $first['state']['id'], 'snapshot' => self::SNAPSHOT, 'capabilityIds' => ['link.handoff'], 'result' => [
            'protocolVersion' => '0.1', 'callId' => $call['callId'], 'capabilityId' => 'link.handoff', 'status' => 'success', 'code' => 'VERIFIED', 'message' => 'Opened Restoran Laut.', 'evidence' => (object) [],
        ]], $approved['state'], ['link.handoff']);
        $this->assertSame('Restoran Laut is open in a new tab.', $done['reply']['response']['text']);

        $restoProvider = $this->provider([$this->said('Shall I book 4 people on 29 October?')]);
        $arrival = new ConversationEngine($restoProvider, new ProtocolValidator, ['schemaVersion' => '0.1', 'capabilities' => []], links: $resto);
        $code = explode('#psq-link=', $url)[1];
        $arrived = $arrival->handle(['protocolVersion' => '0.1', 'requestId' => 'arrive', 'linkCode' => $code, 'snapshot' => self::SNAPSHOT, 'capabilityIds' => []], null, []);
        $this->assertSame('Shall I book 4 people on 29 October?', $arrived['reply']['response']['text']);
        $messages = $restoProvider->received[0];
        $this->assertSame('Continued from Hotel Nusa (hotel.test): A table for four tonight', $messages[count($messages) - 2]['content']);
        $this->assertSame(['partner' => ['origin' => 'http://hotel.test', 'name' => 'Hotel Nusa'], 'skill' => 'book_table', 'fields' => ['date' => '2026-10-29', 'people' => 4]], json_decode(end($messages)['content'], true)['untrustedHandoff']);
        try {
            $arrival->handle(['protocolVersion' => '0.1', 'requestId' => 'arrive-again', 'linkCode' => $code, 'snapshot' => self::SNAPSHOT, 'capabilityIds' => []], null, []);
            $this->fail('A code was redeemed twice.');
        } catch (AssistantException $exception) {
            $this->assertSame(['HANDOFF_EXPIRED', 410], [$exception->errorCode, $exception->httpStatus]);
        }
    }

    public function test_proposals_outside_the_offers_or_with_unrequested_data_are_refused(): void
    {
        [$hotel, $resto, $id] = $this->pair();
        $hotel->approve($id, ['offer' => ['book_table' => ['date']], 'accept' => []]);
        $resto->approve($id, ['offer' => [], 'accept' => ['book_table']]);
        foreach ([
            [['skill' => 'resto.test/delivery', 'goal' => 'Delivery'], 'can\'t hand this over'],
            [['skill' => 'other.test/book_table', 'goal' => 'Table'], 'can\'t hand this over'],
            [['skill' => 'resto.test/book_table', 'goal' => 'Email the menu to me@evil.example'], 'won\'t type contact details'],
            [['skill' => 'resto.test/book_table', 'goal' => '   '], 'can\'t hand this over'],
        ] as [$parameters, $text]) {
            $engine = new ConversationEngine($this->provider([$this->handoff($parameters)]), new ProtocolValidator, $this->manifest(), links: $hotel);
            $reply = $engine->handle($this->ask('Book me a table'), null, ['link.handoff'])['reply']['response'];
            $this->assertSame([], $reply['toolCalls']);
            $this->assertStringContainsString($text, $reply['text']);
        }
        $hotel->revoke($id);
        $provider = $this->provider([$this->said('I can only help with the hotel.')]);
        (new ConversationEngine($provider, new ProtocolValidator, $this->manifest(), links: $hotel))->handle($this->ask('Book me a table'), null, ['link.handoff']);
        $this->assertSame([], $provider->capabilities[0]);
        $this->assertNotContains('handoff', $this->sent);
    }

    /** @return array{LinkManager, LinkManager, string} */
    private function pair(): array
    {
        $hotel = $this->site('http://hotel.test', 'Hotel Nusa', []);
        $resto = $this->site('http://resto.test', 'Restoran Laut', [self::BOOK_TABLE]);

        return [$hotel, $resto, $hotel->acceptInvitation($resto->createInvitation()['code'])['id']];
    }

    /** @param list<array<string, mixed>> $skills */
    private function site(string $origin, string $name, array $skills): LinkManager
    {
        $signer = new ActionSigner(ActionSigner::generate()['signingKey'], $origin);
        $test = $this;
        $transport = new class($test) implements LinkTransport
        {
            public function __construct(private readonly LinkEngineTest $test) {}

            public function request(string $method, string $url, ?string $body): string
            {
                return $this->test->route($method, $url, $body);
            }
        };
        $manager = new LinkManager($signer, new MemoryLinkStore, ['endpoint' => '/pagesquire/link', 'name' => $name, 'skills' => $skills], $transport);
        $this->sites[$origin] = ['signer' => $signer, 'manager' => $manager];

        return $manager;
    }

    /** The fake network: each site serves its declaration and link endpoint. */
    public function route(string $method, string $url, ?string $body): string
    {
        $site = $this->sites[ActionSigner::origin($url)];
        if (str_ends_with($url, '/.well-known/pagesquire.json')) {
            return json_encode($site['signer']->declaration('/chat', false, $site['manager']->declaration()), JSON_UNESCAPED_SLASHES);
        }
        $this->sent[] = json_decode(json_decode((string) $body, true)['claims'], true)['type'];

        return json_encode((new LinkEndpoint($site['manager']))->handle($method, 'application/json', (string) $body)['body'], JSON_UNESCAPED_SLASHES);
    }

    /** @return array{schemaVersion: string, capabilities: list<array<string, mixed>>} */
    private function manifest(): array
    {
        return ['schemaVersion' => '0.1', 'capabilities' => [Link::handoffCapability()]];
    }

    /** @return array<string, mixed> */
    private function ask(string $message): array
    {
        return ['protocolVersion' => '0.1', 'requestId' => bin2hex(random_bytes(4)), 'message' => $message, 'snapshot' => self::SNAPSHOT, 'capabilityIds' => ['link.handoff']];
    }

    /** @return array<string, mixed> */
    private function said(string $text): array
    {
        return ['text' => $text, 'emotion' => 'happy', 'finished' => true, 'toolCalls' => []];
    }

    /** @param array<string, mixed> $parameters @return array<string, mixed> */
    private function handoff(array $parameters): array
    {
        return ['text' => 'Restoran Laut can book that.', 'emotion' => 'happy', 'finished' => false, 'toolCalls' => [['capabilityId' => 'link.handoff', 'parameters' => $parameters]]];
    }

    /** @param list<array<string, mixed>> $replies */
    private function provider(array $replies): Provider
    {
        return new class($replies) implements Provider
        {
            /** @var list<mixed> */
            public array $received = [];

            /** @var list<list<string>> */
            public array $capabilities = [];

            /** @param list<array<string, mixed>> $replies */
            public function __construct(private array $replies) {}

            public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
            {
                $this->received[] = $messages;
                $this->capabilities[] = array_column($capabilities, 'id');

                return array_shift($this->replies);
            }
        };
    }
}
