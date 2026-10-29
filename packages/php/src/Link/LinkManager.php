<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

use PageSquire\Server\ActionSigner;
use PageSquire\Server\AssistantException;

/**
 * One site's links: owner operations (invite, accept, approve, revoke),
 * handoffs (handoff, redeem) and the partner endpoint (receive). Mirrors
 * LinkManager in packages/server.
 */
final class LinkManager
{
    private const INVITATION_HOURS = 24;

    /** @var list<array<string, mixed>> */
    private array $skills;

    /** @var array<string, int> */
    private array $refreshed = [];

    /** @var \Closure(): int milliseconds */
    private \Closure $now;

    /**
     * @param  array{endpoint: string, name: string, skills: list<array<string, mixed>>}  $profile  This site's link endpoint path, name and skills.
     * @param  (callable(): int)|null  $now  Clock in milliseconds, for tests.
     */
    public function __construct(
        private readonly ActionSigner $signer,
        private readonly LinkStore $store,
        private readonly array $profile,
        private readonly LinkTransport $transport = new CurlLinkTransport,
        ?callable $now = null,
    ) {
        $skills = Link::readSkills($profile['skills'] ?? null);
        if (! Link::originAllowed($signer->siteOrigin()) || $skills === null || ! is_string($profile['endpoint'] ?? null) || ! str_starts_with($profile['endpoint'], '/') || str_starts_with($profile['endpoint'], '//') || ! is_string($profile['name'] ?? null) || $profile['name'] === '' || mb_strlen($profile['name']) > 80) {
            throw new AssistantException('INVALID_OPTIONS', 'The link profile needs an allowed origin, an endpoint path, a name and valid skills.', 500);
        }
        $this->skills = $skills;
        $this->now = $now !== null ? \Closure::fromCallable($now) : static fn (): int => (int) floor(microtime(true) * 1000);
    }

    private function origin(): string
    {
        return $this->signer->siteOrigin();
    }

    private function seconds(): int
    {
        return intdiv(($this->now)(), 1000);
    }

    /**
     * The link section of this site's /.well-known/pagesquire.json.
     *
     * @return array{endpoint: string, name: string, skills: list<array<string, mixed>>}
     */
    public function declaration(): array
    {
        return ['endpoint' => $this->profile['endpoint'], 'name' => $this->profile['name'], 'skills' => Link::encodeSkills($this->skills)];
    }

    /** @return list<array<string, mixed>> */
    public function list(): array
    {
        return $this->store->transaction(static fn (array &$data): array => array_values($data['links']));
    }

    /** @return array<string, mixed>|null */
    public function get(string $id): ?array
    {
        return $this->store->transaction(static fn (array &$data): ?array => $data['links'][$id] ?? null);
    }

    /**
     * A single-use invitation for another owner; only a hash of its secret is kept.
     *
     * @return array{code: string, expiresAt: int}
     */
    public function createInvitation(int $hours = self::INVITATION_HOURS): array
    {
        if ($hours < 1 || $hours > 168) {
            throw new AssistantException('INVALID_OPTIONS', 'Invitations last 1 to 168 hours.', 500);
        }
        $id = 'inv_'.Link::random(16);
        $secret = Link::random(32);
        $expiresAt = ($this->now)() + $hours * 3_600_000;
        $this->store->transaction(function (array &$data) use ($id, $secret, $expiresAt): void {
            $this->prune($data);
            $data['invitations'][$id] = ['id' => $id, 'keyHash' => Link::keyHash($secret), 'expiresAt' => $expiresAt];
        });

        return ['code' => 'psq1.'.Link::base64url($this->origin()).'.'.$id.'.'.$secret, 'expiresAt' => $expiresAt];
    }

    /**
     * Accepts another owner's invitation; the link stays pending until both sides approve.
     *
     * @return array<string, mixed>
     */
    public function acceptInvitation(string $code): array
    {
        $invitation = Link::readInvitation($code);
        if ($invitation === null || $invitation['origin'] === $this->origin()) {
            throw new AssistantException('INVITATION_INVALID', 'This is not a valid invitation for another site.', 400);
        }
        $partner = $this->declarationOf($invitation['origin']);
        $nonce = Link::random(16);
        $answer = $this->send($partner, [
            'type' => 'accept',
            'link' => null,
            'nonce' => $nonce,
            'body' => ['invitation' => $invitation['id'], 'proof' => Link::invitationProof(Link::keyHash($invitation['secret']), $this->origin(), $nonce)],
        ], 'accepted');
        $id = $answer['body']['link'] ?? null;
        if (! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{16,64}$/', $id) || $answer['link'] !== $id) {
            throw new AssistantException('PARTNER_INVALID', 'The partner answered with an invalid link.', 502);
        }
        $now = ($this->now)();
        $record = ['id' => $id, 'role' => 'invitee', 'status' => 'pending', 'partner' => $partner, 'ours' => ['approved' => false, 'offer' => [], 'accept' => []], 'theirs' => ['approved' => false, 'accept' => []], 'createdAt' => $now, 'updatedAt' => $now];
        $this->store->transaction(static function (array &$data) use ($id, $record): void {
            $data['links'][$id] = $record;
        });

        return $record;
    }

    /**
     * Approves this site's side and tells the partner; `notified` is false when it could not be reached.
     *
     * @param  array{offer: array<string, list<string>>, accept: list<string>}  $scope
     * @return array{record: array<string, mixed>, notified: bool}
     */
    public function approve(string $id, array $scope): array
    {
        $record = $this->store->transaction(function (array &$data) use ($id, $scope): array {
            $link = $data['links'][$id] ?? throw new AssistantException('LINK_UNKNOWN', 'No such link.', 404);
            if ($link['status'] === 'revoked') {
                throw new AssistantException('LINK_REVOKED', 'This link was revoked.', 410);
            }
            $link['ours'] = ['approved' => true] + $this->checkScope($link, $scope);
            $link['status'] = $link['theirs']['approved'] ? 'active' : 'pending';
            $link['updatedAt'] = ($this->now)();

            return $data['links'][$id] = $link;
        });
        $notified = $this->notify($record['partner'], ['type' => 'approve', 'link' => $id, 'body' => ['accept' => $record['ours']['accept']]]);

        return ['record' => $record, 'notified' => $notified];
    }

    /**
     * Revokes the link here at once, then tells the partner.
     *
     * @return array{record: array<string, mixed>, notified: bool}
     */
    public function revoke(string $id): array
    {
        $record = $this->store->transaction(function (array &$data) use ($id): array {
            $link = $data['links'][$id] ?? throw new AssistantException('LINK_UNKNOWN', 'No such link.', 404);
            if ($link['status'] !== 'revoked') {
                $link['status'] = 'revoked';
                $link['revokedBy'] = 'us';
                $link['updatedAt'] = ($this->now)();
            }

            return $data['links'][$id] = $link;
        });

        return ['record' => $record, 'notified' => $this->notify($record['partner'], ['type' => 'revoke', 'link' => $id, 'body' => []])];
    }

    /**
     * Hands a visitor to the partner (Phase 6B). The skill must be offered here
     * and accepted there, and every field allowed by this site's scope and valid
     * for the partner's schema. Returns the URL where the visitor continues; its
     * fragment code works once, for Link::TICKET_SECONDS.
     *
     * @param  array<string, mixed>  $handoff  skill, goal, optional fields and locale.
     * @return array{url: string, expiresAt: int}
     */
    public function handoff(string $id, array $handoff): array
    {
        $link = $this->get($id) ?? throw new AssistantException('LINK_UNKNOWN', 'No such link.', 404);
        $this->active($link);
        $body = $this->checkHandoff($handoff, $link['partner']['skills'], static fn (array $skill): ?array => in_array($skill['id'], $link['theirs']['accept'], true) ? ($link['ours']['offer'][$skill['id']] ?? null) : null);
        $answer = $this->send($link['partner'], ['type' => 'handoff', 'link' => $id, 'body' => $body], 'ticket');
        $skill = $this->skill($link['partner']['skills'], $body['skill']);
        $prefix = $link['partner']['origin'].$skill['startPath'].'#psq-link=';
        $url = $answer['body']['url'] ?? null;
        $expiresAt = $answer['body']['expiresAt'] ?? null;
        if (! is_string($url) || ! str_starts_with($url, $prefix) || ! preg_match(Link::CODE, substr($url, strlen($prefix))) || ! is_int($expiresAt)) {
            throw new AssistantException('PARTNER_INVALID', 'The partner answered with an invalid ticket.', 502);
        }

        return ['url' => $url, 'expiresAt' => $expiresAt];
    }

    /**
     * Redeems a handoff code once. Null when it is unknown, used, expired, or
     * its link is no longer active.
     *
     * @return array<string, mixed>|null
     */
    public function redeem(string $code): ?array
    {
        if (! preg_match(Link::CODE, $code)) {
            return null;
        }

        return $this->store->transaction(function (array &$data) use ($code): ?array {
            $this->prune($data);
            $key = Link::base64url(hash('sha256', $code, true));
            $ticket = $data['tickets'][$key] ?? null;
            if ($ticket === null) {
                return null;
            }
            unset($data['tickets'][$key]);

            return ($data['links'][$ticket['link']]['status'] ?? null) === 'active' ? $ticket : null;
        });
    }

    /**
     * Handles one envelope a partner POSTed and returns the signed answer.
     *
     * @return array{claims: string, value: string}
     */
    public function receive(mixed $envelope): array
    {
        $claims = Link::readClaims($envelope);
        if ($claims === null) {
            throw new AssistantException('LINK_INVALID', 'The link message is malformed.', 400);
        }
        if ($claims['to'] !== $this->origin()) {
            throw new AssistantException('LINK_INVALID', 'The link message is for another site.', 400);
        }
        if ($claims['type'] === 'accept') {
            return $this->accept($envelope, $claims);
        }
        if (! in_array($claims['type'], ['approve', 'revoke', 'handoff'], true)) {
            throw new AssistantException('LINK_INVALID', 'Unexpected link message.', 400);
        }
        $known = $claims['link'] !== null ? $this->get($claims['link']) : null;
        if ($known === null || $known['partner']['origin'] !== $claims['from']) {
            throw new AssistantException('LINK_UNKNOWN', 'No such link with this partner.', 404);
        }
        $this->verifyFromPartner($known, $envelope, $claims['type']);
        if ($claims['type'] === 'handoff') {
            return $this->ticket($known, $claims);
        }
        $this->store->transaction(function (array &$data) use ($claims, $known): void {
            $this->useNonce($data, $claims);
            $link = $data['links'][$known['id']];
            if ($claims['type'] === 'revoke') {
                if ($link['status'] !== 'revoked') {
                    $link['status'] = 'revoked';
                    $link['revokedBy'] = 'partner';
                }
            } else {
                if ($link['status'] === 'revoked') {
                    throw new AssistantException('LINK_REVOKED', 'This link was revoked.', 410);
                }
                $own = array_column($link['partner']['skills'], 'id');
                $accept = is_array($claims['body']['accept'] ?? null) ? $claims['body']['accept'] : [];
                $link['theirs'] = ['approved' => true, 'accept' => array_values(array_unique(array_filter($accept, static fn (mixed $entry): bool => is_string($entry) && in_array($entry, $own, true))))];
                $link['status'] = $link['ours']['approved'] ? 'active' : 'pending';
            }
            $link['updatedAt'] = ($this->now)();
            $data['links'][$known['id']] = $link;
        });

        return $this->signed($known['partner']['origin'], $known['id'], 'ack', []);
    }

    /**
     * @param  array<string, mixed>  $claims
     * @return array{claims: string, value: string}
     */
    private function accept(mixed $envelope, array $claims): array
    {
        // The accepting site proves its key through its own origin's declaration.
        $partner = $this->declarationOf($claims['from']);
        Link::verify($envelope, $partner['publicKey'], ['to' => $this->origin(), 'type' => 'accept', 'link' => null], $this->seconds());
        $id = 'lnk_'.Link::random(16);
        $this->store->transaction(function (array &$data) use ($claims, $partner, $id): void {
            $this->prune($data);
            $this->useNonce($data, $claims);
            $invitation = $data['invitations'][(string) ($claims['body']['invitation'] ?? '')] ?? null;
            $proof = (string) ($claims['body']['proof'] ?? '');
            $expected = $invitation !== null ? Link::invitationProof($invitation['keyHash'], $claims['from'], $claims['nonce']) : '';
            if ($invitation === null || $invitation['expiresAt'] < ($this->now)() || ! hash_equals($expected, $proof)) {
                throw new AssistantException('INVITATION_INVALID', 'The invitation is unknown, used or expired.', 403);
            }
            // Single use, whatever happens next.
            unset($data['invitations'][$invitation['id']]);
            $now = ($this->now)();
            $data['links'][$id] = ['id' => $id, 'role' => 'inviter', 'status' => 'pending', 'partner' => $partner, 'ours' => ['approved' => false, 'offer' => [], 'accept' => []], 'theirs' => ['approved' => false, 'accept' => []], 'createdAt' => $now, 'updatedAt' => $now];
        });

        return $this->signed($partner['origin'], $id, 'accepted', ['link' => $id]);
    }

    /**
     * Stores a partner's handoff under a fresh code and answers with the start URL.
     *
     * @param  array<string, mixed>  $known
     * @param  array<string, mixed>  $claims
     * @return array{claims: string, value: string}
     */
    private function ticket(array $known, array $claims): array
    {
        $code = Link::random(16);
        $expiresAt = ($this->now)() + Link::TICKET_SECONDS * 1000;
        $skill = $this->store->transaction(function (array &$data) use ($known, $claims, $code, $expiresAt): array {
            $this->prune($data);
            $this->useNonce($data, $claims);
            $link = $data['links'][$known['id']];
            $this->active($link);
            $body = $this->checkHandoff(is_array($claims['body']) ? $claims['body'] : [], $this->skills, static fn (array $skill): ?array => in_array($skill['id'], $link['ours']['accept'], true) ? array_keys($skill['fields']) : null);
            if (count($data['tickets']) >= 1000) {
                throw new AssistantException('LINK_BUSY', 'Too many open handoffs. Try again shortly.', 429);
            }
            $data['tickets'][Link::base64url(hash('sha256', $code, true))] = ['link' => $link['id'], 'partner' => ['origin' => $link['partner']['origin'], 'name' => $link['partner']['name']]] + $body + ['expiresAt' => $expiresAt];

            return $this->skill($this->skills, $body['skill']);
        });

        return $this->signed($known['partner']['origin'], $known['id'], 'ticket', ['url' => $this->origin().$skill['startPath'].'#psq-link='.$code, 'expiresAt' => $expiresAt]);
    }

    /** @param array<string, mixed> $link */
    private function active(array $link): void
    {
        if ($link['status'] === 'revoked') {
            throw new AssistantException('LINK_REVOKED', 'This link was revoked.', 410);
        }
        if ($link['status'] !== 'active') {
            throw new AssistantException('LINK_INACTIVE', 'Both owners must approve this link first.', 409);
        }
    }

    /**
     * @param  list<array<string, mixed>>  $skills
     * @return array<string, mixed>
     */
    private function skill(array $skills, string $id): array
    {
        foreach ($skills as $skill) {
            if ($skill['id'] === $id) {
                return $skill;
            }
        }

        throw new AssistantException('HANDOFF_SCOPE', 'This link does not allow that skill.', 403);
    }

    /**
     * A checked handoff body. `$scope` names the fields a skill may carry in
     * this direction, or null when the skill is not allowed at all.
     *
     * @param  array<string, mixed>  $value
     * @param  list<array<string, mixed>>  $skills
     * @param  callable(array<string, mixed>): ?list<string>  $scope
     * @return array{skill: string, goal: string, fields: array<string, mixed>, locale?: string}
     */
    private function checkHandoff(array $value, array $skills, callable $scope): array
    {
        if (array_diff(array_keys($value), ['skill', 'goal', 'fields', 'locale']) !== []) {
            throw new AssistantException('HANDOFF_INVALID', 'The handoff is malformed.', 400);
        }
        $skill = $this->skill($skills, is_string($value['skill'] ?? null) ? $value['skill'] : '');
        $allowed = $scope($skill) ?? throw new AssistantException('HANDOFF_SCOPE', 'This link does not allow that skill.', 403);
        $goal = $value['goal'] ?? null;
        if (! is_string($goal) || trim($goal) === '' || ! mb_check_encoding($goal, 'UTF-8') || mb_strlen($goal) > 300 || preg_match('/[\x00-\x1f\x7f]/', $goal)) {
            throw new AssistantException('HANDOFF_INVALID', 'A handoff needs a goal of at most 300 characters.', 400);
        }
        if (array_key_exists('locale', $value) && (! is_string($value['locale']) || ! preg_match('/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/', $value['locale']))) {
            throw new AssistantException('HANDOFF_INVALID', 'The handoff locale is invalid.', 400);
        }
        $fields = $value['fields'] ?? [];
        if (! is_array($fields) || (array_is_list($fields) && $fields !== [])) {
            throw new AssistantException('HANDOFF_INVALID', 'Handoff fields must be an object.', 400);
        }
        foreach ($fields as $name => $entry) {
            $name = (string) $name;
            if (! in_array($name, $allowed, true) || ! isset($skill['fields'][$name]) || ! Link::valueAllowed($skill['fields'][$name], $entry)) {
                throw new AssistantException('HANDOFF_INVALID', 'The field "'.mb_substr($name, 0, 40).'" is not allowed or not valid.', 400);
            }
        }

        return ['skill' => $skill['id'], 'goal' => $goal, 'fields' => $fields] + (array_key_exists('locale', $value) ? ['locale' => $value['locale']] : []);
    }

    /**
     * @param  array<string, mixed>  $link
     * @param  array<string, mixed>  $scope
     * @return array{offer: array<string, list<string>>, accept: list<string>}
     */
    private function checkScope(array $link, array $scope): array
    {
        if (! is_array($scope['offer'] ?? null) || (array_is_list($scope['offer']) && $scope['offer'] !== []) || ! is_array($scope['accept'] ?? null) || ! array_is_list($scope['accept'])) {
            throw new AssistantException('INVALID_SCOPE', 'A scope needs an offer map and an accept list.', 400);
        }
        $offer = [];
        foreach ($scope['offer'] as $skillId => $fields) {
            $skill = null;
            foreach ($link['partner']['skills'] as $candidate) {
                if ($candidate['id'] === $skillId) {
                    $skill = $candidate;
                }
            }
            if ($skill === null || ! is_array($fields) || ! array_is_list($fields)) {
                throw new AssistantException('INVALID_SCOPE', "The partner has no skill \"$skillId\" with those fields.", 400);
            }
            foreach ($fields as $name) {
                if (! is_string($name) || ! array_key_exists($name, $skill['fields'])) {
                    throw new AssistantException('INVALID_SCOPE', "The partner has no skill \"$skillId\" with those fields.", 400);
                }
            }
            $offer[(string) $skillId] = array_values(array_unique($fields));
        }
        $own = array_column($this->skills, 'id');
        foreach ($scope['accept'] as $entry) {
            if (! is_string($entry) || ! in_array($entry, $own, true)) {
                throw new AssistantException('INVALID_SCOPE', "Accept only lists this site's own skills.", 400);
            }
        }

        return ['offer' => $offer, 'accept' => array_values(array_unique($scope['accept']))];
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{claims: string, value: string}
     */
    private function signed(string $to, ?string $link, string $type, array $body): array
    {
        return Link::sign(['type' => $type, 'from' => $this->origin(), 'to' => $to, 'link' => $link, 'body' => $body], $this->signer, $this->seconds());
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>  $claims
     */
    private function useNonce(array &$data, array $claims): void
    {
        $key = $claims['from'].' '.$claims['nonce'];
        if (isset($data['nonces'][$key])) {
            throw new AssistantException('LINK_REPLAYED', 'This link message was already used.', 409);
        }
        $data['nonces'][$key] = $claims['exp'];
    }

    /** @param array<string, mixed> $data */
    private function prune(array &$data): void
    {
        $now = ($this->now)();
        foreach ($data['nonces'] as $key => $exp) {
            if (($exp + Link::CLOCK_SKEW_SECONDS) * 1000 < $now) {
                unset($data['nonces'][$key]);
            }
        }
        foreach ($data['invitations'] as $key => $invitation) {
            if ($invitation['expiresAt'] < $now) {
                unset($data['invitations'][$key]);
            }
        }
        $data['tickets'] ??= [];
        foreach ($data['tickets'] as $key => $ticket) {
            if ($ticket['expiresAt'] < $now) {
                unset($data['tickets'][$key]);
            }
        }
    }

    /**
     * Verifies with the stored key; after a failure, re-reads the partner's
     * declaration at most once a minute (key rotation).
     *
     * @param  array<string, mixed>  $link
     */
    private function verifyFromPartner(array $link, mixed $envelope, string $type): void
    {
        $expected = ['to' => $this->origin(), 'from' => $link['partner']['origin'], 'type' => $type, 'link' => $link['id']];
        try {
            Link::verify($envelope, $link['partner']['publicKey'], $expected, $this->seconds());

            return;
        } catch (AssistantException $exception) {
            $origin = $link['partner']['origin'];
            if ($exception->errorCode !== 'LINK_SIGNATURE' || ($this->now)() - ($this->refreshed[$origin] ?? 0) < 60_000) {
                throw $exception;
            }
            $this->refreshed[$origin] = ($this->now)();
            try {
                $partner = $this->declarationOf($origin);
            } catch (AssistantException) {
                throw $exception;
            }
            if ($partner['publicKey'] === $link['partner']['publicKey']) {
                throw $exception;
            }
            $this->store->transaction(static function (array &$data) use ($link, $partner): void {
                if (isset($data['links'][$link['id']])) {
                    $data['links'][$link['id']]['partner'] = $partner;
                }
            });
            Link::verify($envelope, $partner['publicKey'], $expected, $this->seconds());
        }
    }

    /** @return array{origin: string, name: string, endpoint: string, publicKey: string, skills: list<array<string, mixed>>} */
    private function declarationOf(string $origin): array
    {
        if (! Link::originAllowed($origin) || $origin === $this->origin()) {
            throw new AssistantException('PARTNER_INVALID', 'The partner origin is not allowed.', 400);
        }
        $partner = Link::readDeclaration($this->json('GET', $origin.'/.well-known/pagesquire.json', null), $origin);
        if ($partner === null) {
            throw new AssistantException('PARTNER_INVALID', 'The partner does not declare PageSquire Link.', 502);
        }

        return $partner;
    }

    /**
     * @param  array<string, mixed>  $partner
     * @param  array{type: string, link: ?string, body: array<string, mixed>, nonce?: string}  $message
     * @return array<string, mixed>
     */
    private function send(array $partner, array $message, string $answer): array
    {
        $envelope = Link::sign($message + ['from' => $this->origin(), 'to' => $partner['origin']], $this->signer, $this->seconds());
        $reply = $this->json('POST', $partner['endpoint'], json_encode($envelope, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        if (is_array($reply) && is_array($reply['error'] ?? null)) {
            throw new AssistantException('PARTNER_REJECTED', 'The partner refused: '.substr((string) ($reply['error']['code'] ?? ''), 0, 40).'.', 502);
        }
        $expected = ['to' => $this->origin(), 'from' => $partner['origin'], 'type' => $answer];
        if ($message['link'] !== null) {
            $expected['link'] = $message['link'];
        }

        return Link::verify($reply, $partner['publicKey'], $expected, $this->seconds());
    }

    /**
     * @param  array<string, mixed>  $partner
     * @param  array{type: string, link: ?string, body: array<string, mixed>}  $message
     */
    private function notify(array $partner, array $message): bool
    {
        try {
            $this->send($partner, $message, 'ack');

            return true;
        } catch (AssistantException) {
            return false;
        }
    }

    private function json(string $method, string $url, ?string $body): mixed
    {
        $text = $this->transport->request($method, $url, $body);
        if (strlen($text) > Link::MAX_BODY_BYTES) {
            throw new AssistantException('PARTNER_INVALID', 'The partner answer is too large.', 502);
        }
        try {
            return json_decode($text, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new AssistantException('PARTNER_INVALID', 'The partner answer is not JSON.', 502);
        }
    }
}
