<?php

declare(strict_types=1);

namespace PageSquire\Tests\Server;

use PageSquire\Server\ActionSigner;
use PageSquire\Server\AssistantException;
use PageSquire\Server\Link\Link;
use PageSquire\Server\Link\LinkEndpoint;
use PageSquire\Server\Link\LinkManager;
use PageSquire\Server\Link\LinkTransport;
use PageSquire\Server\Link\MemoryLinkStore;
use PHPUnit\Framework\TestCase;

final class LinkTest extends TestCase
{
    private const BOOK_TABLE = [
        'id' => 'book_table', 'name' => 'Book a table', 'description' => 'Reserve a table.', 'tags' => ['restaurant'],
        'fields' => ['date' => ['type' => 'string', 'format' => 'date'], 'people' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 20]],
        'startPath' => '/reservations',
    ];

    private const FIND_ROOM = [
        'id' => 'find_room', 'name' => 'Find a room', 'description' => 'Show rooms.', 'tags' => ['hotel'],
        'fields' => [], 'startPath' => '/rooms',
    ];

    private const TABLE_FOR_FOUR = ['skill' => 'book_table', 'goal' => 'A table for four tonight', 'fields' => ['date' => '2026-10-29', 'people' => 4], 'locale' => 'id'];

    /** @var array<string, array{signer: ActionSigner, manager: LinkManager}> */
    private array $sites = [];

    /** @var list<string> */
    private array $down = [];

    public function test_signatures_and_proofs_match_the_node_vector(): void
    {
        $vector = $this->vector();
        $signer = new ActionSigner($vector['signingKey'], 'http://hotel.test');
        $this->assertSame($vector['signature'], $signer->signText(Link::CONTEXT, $vector['claims']));
        $this->assertTrue(ActionSigner::verifyText($vector['publicKey'], Link::CONTEXT, $vector['claims'], $vector['signature']));
        $this->assertFalse(ActionSigner::verifyText($vector['publicKey'], ActionSigner::CONTEXT, $vector['claims'], $vector['signature']));
        $claims = Link::verify(['claims' => $vector['claims'], 'value' => $vector['signature']], $vector['publicKey'], ['to' => 'http://resto.test', 'from' => 'http://hotel.test', 'type' => 'approve'], 1830000010);
        $this->assertSame(['book_table'], $claims['body']['accept']);
        $invitation = $vector['invitation'];
        $this->assertSame($invitation['keyHash'], Link::keyHash($invitation['secret']));
        $this->assertSame($invitation['proof'], Link::invitationProof($invitation['keyHash'], $invitation['from'], $invitation['nonce']));
        foreach ([[ActionSigner::generate()['publicKey'], 1830000010, 'LINK_SIGNATURE'], [$vector['publicKey'], 1830000300 + 121, 'LINK_EXPIRED']] as [$key, $at, $code]) {
            try {
                Link::verify(['claims' => $vector['claims'], 'value' => $vector['signature']], $key, ['to' => 'http://resto.test'], $at);
                $this->fail('Accepted a bad envelope.');
            } catch (AssistantException $exception) {
                $this->assertSame($code, $exception->errorCode);
            }
        }
    }

    public function test_declarations_skills_and_invitations_are_validated(): void
    {
        $signer = new ActionSigner($this->vector()['signingKey'], 'http://resto.test');
        $declaration = json_decode(json_encode($signer->declaration('/pagesquire/chat', false, ['endpoint' => '/pagesquire/link', 'name' => 'Restoran Laut', 'skills' => Link::encodeSkills([self::BOOK_TABLE, self::FIND_ROOM])])), true);
        $this->assertSame(['trustedInput', 'link'], $declaration['features']);
        $this->assertSame([], $declaration['link']['skills'][1]['fields']);
        $partner = Link::readDeclaration($declaration, 'http://resto.test');
        $this->assertSame('http://resto.test/pagesquire/link', $partner['endpoint']);
        $this->assertSame(['book_table', 'find_room'], array_column($partner['skills'], 'id'));
        foreach ([[...self::BOOK_TABLE, 'id' => 'Book'], [...self::BOOK_TABLE, 'startPath' => 'https://x/'], [...self::BOOK_TABLE, 'fields' => ['a' => ['type' => 'object']]], [...self::BOOK_TABLE, 'extra' => 1]] as $bad) {
            $this->assertNull(Link::readSkills([$bad]));
        }
        $this->assertNull(Link::readSkills([self::BOOK_TABLE, self::BOOK_TABLE]));
        foreach (['https://shop.example' => true, 'http://localhost:8000' => true, 'http://shop.test' => true, 'http://shop.example' => false, 'https://shop.example/' => false] as $origin => $allowed) {
            $this->assertSame($allowed, Link::originAllowed($origin), $origin);
        }
        $code = 'psq1.'.Link::base64url('https://hotel.example').'.inv_'.str_repeat('a', 22).'.'.str_repeat('b', 43);
        $this->assertSame(['origin' => 'https://hotel.example', 'id' => 'inv_'.str_repeat('a', 22), 'secret' => str_repeat('b', 43)], Link::readInvitation($code));
        $this->assertNull(Link::readInvitation(substr($code, 0, -1)));
    }

    public function test_two_php_sites_pair_approve_and_revoke(): void
    {
        $hotel = $this->site('http://hotel.test', 'Hotel Nusa', [self::FIND_ROOM]);
        $resto = $this->site('http://resto.test', 'Restoran Laut', [self::BOOK_TABLE]);
        $code = $resto->createInvitation()['code'];
        $accepted = $hotel->acceptInvitation($code);
        $this->assertSame('pending', $accepted['status']);
        $this->assertSame('Restoran Laut', $accepted['partner']['name']);
        $id = $accepted['id'];
        $this->assertSame('inviter', $resto->get($id)['role']);

        $first = $hotel->approve($id, ['offer' => ['book_table' => ['date', 'people']], 'accept' => []]);
        $this->assertTrue($first['notified']);
        $this->assertSame('pending', $first['record']['status']);
        $second = $resto->approve($id, ['offer' => [], 'accept' => ['book_table']]);
        $this->assertSame('active', $second['record']['status']);
        $this->assertSame('active', $hotel->get($id)['status']);
        $this->assertSame(['book_table'], $hotel->get($id)['theirs']['accept']);

        $this->assertTrue($resto->revoke($id)['notified']);
        $this->assertSame('revoked', $hotel->get($id)['status']);
        $this->assertSame('partner', $hotel->get($id)['revokedBy']);
        try {
            $hotel->approve($id, ['offer' => [], 'accept' => []]);
            $this->fail('Approved a revoked link.');
        } catch (AssistantException $exception) {
            $this->assertSame('LINK_REVOKED', $exception->errorCode);
        }
    }

    public function test_invitations_are_single_use_need_the_secret_and_expire(): void
    {
        $now = 1_830_000_000_000;
        $clock = static function () use (&$now): int {
            return $now;
        };
        $hotel = $this->site('http://hotel.test', 'Hotel', [self::FIND_ROOM], $clock);
        $resto = $this->site('http://resto.test', 'Resto', [self::BOOK_TABLE], $clock);
        $third = $this->site('http://third.test', 'Third', [], $clock);
        $code = $resto->createInvitation()['code'];
        $hotel->acceptInvitation($code);
        $this->assertPartnerRefuses(fn () => $third->acceptInvitation($code));
        $wrong = substr($resto->createInvitation()['code'], 0, -1).'Z';
        $this->assertPartnerRefuses(fn () => $third->acceptInvitation($wrong));
        $short = $resto->createInvitation(1)['code'];
        $now += 2 * 3_600_000;
        $this->assertPartnerRefuses(fn () => $third->acceptInvitation($short));
        $this->assertSame([], $third->list());
    }

    public function test_the_endpoint_refuses_replays_forgeries_and_bad_requests(): void
    {
        $hotel = $this->site('http://hotel.test', 'Hotel', [self::FIND_ROOM]);
        $resto = $this->site('http://resto.test', 'Resto', [self::BOOK_TABLE]);
        $id = $hotel->acceptInvitation($resto->createInvitation()['code'])['id'];
        $endpoint = new LinkEndpoint($resto);
        $envelope = json_encode(Link::sign(['type' => 'approve', 'from' => 'http://hotel.test', 'to' => 'http://resto.test', 'link' => $id, 'body' => ['accept' => []]], $this->sites['http://hotel.test']['signer']));
        $this->assertSame(200, $endpoint->handle('POST', 'application/json', $envelope)['status']);
        $replay = $endpoint->handle('POST', 'application/json', $envelope);
        $this->assertSame([409, 'LINK_REPLAYED'], [$replay['status'], $replay['body']['error']['code']]);
        $forged = json_encode(Link::sign(['type' => 'revoke', 'from' => 'http://hotel.test', 'to' => 'http://resto.test', 'link' => $id, 'body' => []], new ActionSigner(ActionSigner::generate()['signingKey'], 'http://hotel.test')));
        $this->assertSame(401, $endpoint->handle('POST', 'application/json', $forged)['status']);
        $this->assertSame('pending', $resto->get($id)['status']);
        $this->assertSame(405, $endpoint->handle('GET', 'application/json', '')['status']);
        $this->assertSame(415, $endpoint->handle('POST', 'text/plain', '{}')['status']);
        $this->assertSame(400, $endpoint->handle('POST', 'application/json', '{')['status']);
    }

    public function test_scopes_name_partner_skills_and_fields_and_own_skills_only(): void
    {
        $hotel = $this->site('http://hotel.test', 'Hotel', [self::FIND_ROOM]);
        $resto = $this->site('http://resto.test', 'Resto', [self::BOOK_TABLE]);
        $id = $hotel->acceptInvitation($resto->createInvitation()['code'])['id'];
        foreach ([['offer' => ['unknown' => []], 'accept' => []], ['offer' => ['book_table' => ['name']], 'accept' => []], ['offer' => [], 'accept' => ['book_table']]] as $scope) {
            try {
                $hotel->approve($id, $scope);
                $this->fail('Accepted a bad scope.');
            } catch (AssistantException $exception) {
                $this->assertSame('INVALID_SCOPE', $exception->errorCode);
            }
        }
    }

    public function test_an_offline_partner_still_revokes_locally(): void
    {
        $hotel = $this->site('http://hotel.test', 'Hotel', [self::FIND_ROOM]);
        $resto = $this->site('http://resto.test', 'Resto', [self::BOOK_TABLE]);
        $id = $hotel->acceptInvitation($resto->createInvitation()['code'])['id'];
        $this->down[] = 'http://resto.test';
        $result = $hotel->revoke($id);
        $this->assertFalse($result['notified']);
        $this->assertSame('revoked', $result['record']['status']);
    }

    public function test_field_values_follow_the_shared_vector(): void
    {
        foreach ($this->vector()['values'] as $case) {
            $this->assertSame($case['valid'], Link::valueAllowed($case['schema'], $case['value']), json_encode($case));
        }
        // JSON may encode a whole number as 4.0 in PHP; it is still an integer.
        $this->assertTrue(Link::valueAllowed(['type' => 'integer'], 4.0));
    }

    public function test_a_handoff_carries_the_goal_and_approved_fields_redeemed_once(): void
    {
        [$hotel, $resto, $id] = $this->handing();
        $result = $hotel->handoff($id, self::TABLE_FOR_FOUR);
        $this->assertMatchesRegularExpression('~^http://resto\.test/reservations#psq-link=[\w-]{22}$~', $result['url']);
        $code = explode('#psq-link=', $result['url'])[1];
        $this->assertSame([
            'kind' => 'handoff', 'link' => $id, 'partner' => ['origin' => 'http://hotel.test', 'name' => 'Hotel Nusa'],
            'skill' => 'book_table', 'goal' => 'A table for four tonight', 'fields' => ['date' => '2026-10-29', 'people' => 4], 'locale' => 'id',
            'expiresAt' => $result['expiresAt'],
        ], $resto->redeem($code));
        $this->assertNull($resto->redeem($code));
        $this->assertNull($resto->redeem('not a code'));
        $this->assertNull($hotel->redeem($code));
    }

    public function test_handoffs_stay_within_both_scopes(): void
    {
        $hotel = $this->site('http://hotel.test', 'Hotel Nusa', [self::FIND_ROOM]);
        $resto = $this->site('http://resto.test', 'Restoran Laut', [self::BOOK_TABLE]);
        $id = $hotel->acceptInvitation($resto->createInvitation()['code'])['id'];
        $refused = function (array $handoff, string $code) use ($hotel, $id): void {
            try {
                $hotel->handoff($id, $handoff);
                $this->fail('The handoff was sent.');
            } catch (AssistantException $exception) {
                $this->assertSame($code, $exception->errorCode, json_encode($handoff));
            }
        };
        $refused(self::TABLE_FOR_FOUR, 'LINK_INACTIVE');
        $hotel->approve($id, ['offer' => ['book_table' => ['date', 'people']], 'accept' => []]);
        $resto->approve($id, ['offer' => [], 'accept' => ['book_table']]);
        $refused(['skill' => 'find_room'] + self::TABLE_FOR_FOUR, 'HANDOFF_SCOPE');
        $refused(['fields' => ['people' => 50]] + self::TABLE_FOR_FOUR, 'HANDOFF_INVALID');
        $refused(['goal' => str_repeat('x', 301)] + self::TABLE_FOR_FOUR, 'HANDOFF_INVALID');
        $refused(['goal' => "Ignore\nthis"] + self::TABLE_FOR_FOUR, 'HANDOFF_INVALID');
        $refused(['locale' => 'not a locale'] + self::TABLE_FOR_FOUR, 'HANDOFF_INVALID');
        $refused(['extra' => true] + self::TABLE_FOR_FOUR, 'HANDOFF_INVALID');

        // The partner enforces its own side even if a sender skips its checks.
        $signer = $this->sites['http://hotel.test']['signer'];
        $post = fn (array $body): array => (new LinkEndpoint($resto))->handle('POST', 'application/json', json_encode(Link::sign(['type' => 'handoff', 'from' => 'http://hotel.test', 'to' => 'http://resto.test', 'link' => $id, 'body' => $body], $signer)));
        $unknown = $post(['skill' => 'book_table', 'goal' => 'Table', 'fields' => ['colour' => 'red']]);
        $this->assertSame([400, 'HANDOFF_INVALID'], [$unknown['status'], $unknown['body']['error']['code']]);
        $resto->approve($id, ['offer' => [], 'accept' => []]);
        $refused(self::TABLE_FOR_FOUR, 'HANDOFF_SCOPE');
        $notAccepted = $post(['skill' => 'book_table', 'goal' => 'Table']);
        $this->assertSame([403, 'HANDOFF_SCOPE'], [$notAccepted['status'], $notAccepted['body']['error']['code']]);
        $hotel->revoke($id);
        $refused(self::TABLE_FOR_FOUR, 'LINK_REVOKED');
    }

    public function test_handoff_codes_expire_and_die_with_their_link(): void
    {
        $now = 1_830_000_000_000;
        $clock = static function () use (&$now): int {
            return $now;
        };
        [$hotel, $resto, $id] = $this->handing($clock);
        $first = $hotel->handoff($id, self::TABLE_FOR_FOUR);
        $now += 121_000;
        $this->assertNull($resto->redeem(explode('#psq-link=', $first['url'])[1]));
        $second = $hotel->handoff($id, self::TABLE_FOR_FOUR);
        $resto->revoke($id);
        $this->assertNull($resto->redeem(explode('#psq-link=', $second['url'])[1]));
    }

    public function test_the_partner_sends_the_visitor_back_once_to_the_page_they_left(): void
    {
        [$hotel, $resto, $id] = $this->handing();
        $sent = $hotel->handoff($id, ['returnUrl' => 'http://hotel.test/rooms?night=2'] + self::TABLE_FOR_FOUR);
        $arrival = $resto->redeem(explode('#psq-link=', $sent['url'])[1]);
        $this->assertMatchesRegularExpression('/^ret_[\w-]{22}$/', $arrival['returnId']);
        $back = $resto->sendBack($id, ['returnId' => $arrival['returnId'], 'outcome' => 'Table for 4 booked for 29 October, 19:00.', 'locale' => 'en']);
        $this->assertMatchesRegularExpression('~^http://hotel\.test/rooms\?night=2#psq-link=[\w-]{22}$~', $back['url']);
        $this->assertSame([
            'kind' => 'return', 'link' => $id, 'partner' => ['origin' => 'http://resto.test', 'name' => 'Restoran Laut'],
            'skill' => 'book_table', 'goal' => 'Table for 4 booked for 29 October, 19:00.', 'fields' => [], 'locale' => 'en', 'expiresAt' => $back['expiresAt'],
        ], $hotel->redeem(explode('#psq-link=', $back['url'])[1]));
        try {
            $resto->sendBack($id, ['returnId' => $arrival['returnId'], 'outcome' => 'Again']);
            $this->fail('A second return was accepted.');
        } catch (AssistantException $exception) {
            $this->assertSame('PARTNER_REJECTED', $exception->errorCode);
        }
        // Handoffs count per skill as well; a return counts in the totals only.
        $counts = static fn (array $stats): array => array_diff_key($stats, ['lastAt' => true]) + ['timed' => is_int($stats['lastAt'] ?? null)];
        $this->assertSame(['sent' => 1, 'received' => 1, 'skills' => ['book_table' => ['sent' => 1, 'received' => 0]], 'timed' => true], $counts($hotel->get($id)['stats']));
        $this->assertSame(['sent' => 1, 'received' => 1, 'skills' => ['book_table' => ['sent' => 0, 'received' => 1]], 'timed' => true], $counts($resto->get($id)['stats']));

        // A return URL on another origin is ignored: no return is possible.
        $elsewhere = $hotel->handoff($id, ['returnUrl' => 'https://evil.example/phish'] + self::TABLE_FOR_FOUR);
        $this->assertArrayNotHasKey('returnId', $resto->redeem(explode('#psq-link=', $elsewhere['url'])[1]));
        $again = $resto->redeem(explode('#psq-link=', $hotel->handoff($id, ['returnUrl' => 'http://hotel.test/'] + self::TABLE_FOR_FOUR)['url'])[1]);
        foreach (['', str_repeat('x', 301), "Line\nbreak"] as $outcome) {
            try {
                $resto->sendBack($id, ['returnId' => $again['returnId'], 'outcome' => $outcome]);
                $this->fail('An invalid outcome was sent.');
            } catch (AssistantException $exception) {
                $this->assertSame('RETURN_INVALID', $exception->errorCode);
            }
        }
    }

    /** @return array{LinkManager, LinkManager, string} A paired hotel and restaurant where the hotel may hand visitors into booking. */
    private function handing(?callable $now = null): array
    {
        $hotel = $this->site('http://hotel.test', 'Hotel Nusa', [self::FIND_ROOM], $now);
        $resto = $this->site('http://resto.test', 'Restoran Laut', [self::BOOK_TABLE], $now);
        $id = $hotel->acceptInvitation($resto->createInvitation()['code'])['id'];
        $hotel->approve($id, ['offer' => ['book_table' => ['date', 'people']], 'accept' => []]);
        $resto->approve($id, ['offer' => [], 'accept' => ['book_table']]);

        return [$hotel, $resto, $id];
    }

    private function assertPartnerRefuses(callable $operation): void
    {
        try {
            $operation();
            $this->fail('The partner accepted.');
        } catch (AssistantException $exception) {
            $this->assertSame('PARTNER_REJECTED', $exception->errorCode);
        }
    }

    /** @param list<array<string, mixed>> $skills */
    private function site(string $origin, string $name, array $skills, ?callable $now = null): LinkManager
    {
        $signer = new ActionSigner(ActionSigner::generate()['signingKey'], $origin);
        $manager = new LinkManager($signer, new MemoryLinkStore, ['endpoint' => '/pagesquire/link', 'name' => $name, 'skills' => $skills], $this->transport(), $now);
        $this->sites[$origin] = ['signer' => $signer, 'manager' => $manager];

        return $manager;
    }

    private function transport(): LinkTransport
    {
        $test = $this;

        return new class($test) implements LinkTransport
        {
            public function __construct(private readonly LinkTest $test) {}

            public function request(string $method, string $url, ?string $body): string
            {
                return $this->test->route($method, $url, $body);
            }
        };
    }

    /** The fake network: each site serves its declaration and link endpoint. */
    public function route(string $method, string $url, ?string $body): string
    {
        $origin = ActionSigner::origin($url);
        $site = $this->sites[$origin] ?? null;
        if ($site === null || in_array($origin, $this->down, true)) {
            throw new AssistantException('PARTNER_UNREACHABLE', 'The partner site could not be reached.', 502);
        }
        if (str_ends_with($url, '/.well-known/pagesquire.json')) {
            return json_encode($site['signer']->declaration('/pagesquire/chat', false, $site['manager']->declaration()), JSON_UNESCAPED_SLASHES);
        }

        return json_encode((new LinkEndpoint($site['manager']))->handle($method, 'application/json', (string) $body)['body'], JSON_UNESCAPED_SLASHES);
    }

    /** @return array<string, mixed> */
    private function vector(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../../fixtures/link.json'), true, flags: JSON_THROW_ON_ERROR);
    }
}
