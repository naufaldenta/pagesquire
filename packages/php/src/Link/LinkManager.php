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
     * @param  array{endpoint: string, skills: list<string>, description?: string}|null  $a2a  The optional A2A interface
     *                                                                                              (Phase 6E): its JSON-RPC endpoint path, the profile skills any A2A agent may send requests into, and the
     *                                                                                              Agent Card's description.
     */
    public function __construct(
        private readonly ActionSigner $signer,
        private readonly LinkStore $store,
        private readonly array $profile,
        private readonly LinkTransport $transport = new CurlLinkTransport,
        ?callable $now = null,
        private ?array $a2a = null,
    ) {
        $skills = Link::readSkills($profile['skills'] ?? null);
        if (! Link::originAllowed($signer->siteOrigin()) || $skills === null || ! is_string($profile['endpoint'] ?? null) || ! str_starts_with($profile['endpoint'], '/') || str_starts_with($profile['endpoint'], '//') || ! is_string($profile['name'] ?? null) || $profile['name'] === '' || mb_strlen($profile['name']) > 80) {
            throw new AssistantException('INVALID_OPTIONS', 'The link profile needs an allowed origin, an endpoint path, a name and valid skills.', 500);
        }
        $this->skills = $skills;
        if ($a2a !== null) {
            $ids = array_column($skills, 'id');
            if (! is_string($a2a['endpoint'] ?? null) || ! str_starts_with($a2a['endpoint'], '/') || str_starts_with($a2a['endpoint'], '//') || ! is_array($a2a['skills'] ?? null)
                || array_diff($a2a['skills'], $ids) !== [] || (array_key_exists('description', $a2a) && (! is_string($a2a['description']) || $a2a['description'] === '' || mb_strlen($a2a['description']) > 300))) {
                throw new AssistantException('INVALID_OPTIONS', 'The A2A interface needs an endpoint path, skills from the profile and a description of at most 300 characters.', 500);
            }
            $this->a2a = ['endpoint' => $a2a['endpoint'], 'skills' => array_values(array_unique($a2a['skills']))] + (isset($a2a['description']) ? ['description' => $a2a['description']] : []);
        }
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
     * What an owner dashboard shows: link counts, totals, the partner skills offered now grouped by skill ID
     * (several partners mean the visitor chooses), and which partners may hand visitors into each own skill.
     *
     * @return array{links: array{active: int, pending: int, revoked: int}, totals: array{sent: int, received: int}, offered: list<array<string, mixed>>, accepted: list<array<string, mixed>>}
     */
    public function overview(): array
    {
        $records = $this->list();
        $links = ['active' => 0, 'pending' => 0, 'revoked' => 0];
        $totals = ['sent' => 0, 'received' => 0];
        foreach ($records as $link) {
            $links[$link['status']]++;
            $totals['sent'] += $link['stats']['sent'] ?? 0;
            $totals['received'] += $link['stats']['received'] ?? 0;
        }
        $offered = [];
        foreach (Link::offers($records) as $offer) {
            $offered[$offer['skill']['id']] ??= ['skill' => $offer['skill']['id'], 'name' => $offer['skill']['name'], 'partners' => []];
            $offered[$offer['skill']['id']]['partners'][] = ['link' => $offer['link']] + $offer['partner'];
        }
        $accepted = array_map(static fn (array $skill): array => [
            'skill' => $skill['id'],
            'name' => $skill['name'],
            'partners' => array_values(array_map(
                static fn (array $link): array => ['link' => $link['id'], 'origin' => $link['partner']['origin'], 'name' => $link['partner']['name']],
                array_filter($records, static fn (array $link): bool => $link['status'] === 'active' && in_array($skill['id'], $link['ours']['accept'], true)),
            )),
        ], $this->skills);

        $agents = $this->a2a === null ? null : $this->store->transaction(fn (array &$data): array => ['skills' => $this->a2a['skills'], 'received' => $data['agents']['received'] ?? 0]
            + (isset($data['agents']['lastAt']) ? ['lastAt' => $data['agents']['lastAt']] : []));

        return ['links' => $links, 'totals' => $totals, 'offered' => array_values($offered), 'accepted' => $accepted] + ($agents !== null ? ['agents' => $agents] : []);
    }

    /**
     * This site's A2A Agent Card (Phase 6E), for /.well-known/agent-card.json: the open skills, the
     * JSON-RPC interface, and a signature with the site key that agentKeys() verifies.
     *
     * @return array<string, mixed>
     */
    public function agentCard(): array
    {
        $a2a = $this->openA2A();
        $open = array_values(array_filter(Link::encodeSkills($this->skills), static fn (array $skill): bool => in_array($skill['id'], $a2a['skills'], true)));
        $params = [];
        foreach ($open as $skill) {
            $params[$skill['id']] = ['fields' => $skill['fields']];
        }

        return A2A::signCard([
            'name' => $this->profile['name'],
            'description' => $a2a['description'] ?? 'Continue a request on '.$this->profile['name'].' with its PageSquire assistant. Each answer is a single-use link where the person confirms on the site.',
            'supportedInterfaces' => [['url' => $this->origin().$a2a['endpoint'], 'protocolBinding' => 'JSONRPC', 'protocolVersion' => A2A::PROTOCOL_VERSION]],
            'version' => '1.0.0',
            'capabilities' => ['streaming' => false, 'pushNotifications' => false, 'extensions' => [[
                'uri' => A2A::EXTENSION,
                'description' => 'PageSquire handoff: send a data part { skill, goal, fields } with the fields listed here. The answer is a single-use link where the person continues on this site.',
                'required' => false,
                'params' => ['skills' => (object) $params],
            ]]],
            'defaultInputModes' => ['text/plain', 'application/json'],
            'defaultOutputModes' => ['text/plain', 'application/json'],
            'skills' => array_map(static fn (array $skill): array => ['id' => $skill['id'], 'name' => $skill['name'], 'description' => $skill['description'], 'tags' => $skill['tags']]
                + (isset($skill['examples']) ? ['examples' => $skill['examples']] : []), $open),
        ], $this->signer, $this->origin().A2A::KEYS_PATH);
    }

    /**
     * The JWK Set at A2A::KEYS_PATH that verifies the Agent Card.
     *
     * @return array{keys: list<array<string, string>>}
     */
    public function agentKeys(): array
    {
        $this->openA2A();

        return ['keys' => [A2A::jwk($this->signer)]];
    }

    /**
     * An A2A agent's request into an open skill (Phase 6E): checked like a partner's handoff, then stored
     * under a fresh code for A2A::TICKET_SECONDS. Returns the single-use link to give the person.
     *
     * @param  array{skill?: string, goal: string, fields?: array<string, mixed>}  $request
     * @return array{url: string, expiresAt: int, name: string}
     */
    public function agentHandoff(array $request): array
    {
        $a2a = $this->openA2A();
        $open = array_values(array_filter($this->skills, static fn (array $skill): bool => in_array($skill['id'], $a2a['skills'], true)));
        $skill = $request['skill'] ?? (count($open) === 1 ? $open[0]['id'] : null);
        if ($skill === null) {
            throw new AssistantException('A2A_INVALID', 'Name one of the skills on the Agent Card in a data part.', 400);
        }
        $goal = is_string($request['goal'] ?? null) ? trim($request['goal']) : '';
        // A visitor reads the goal as their own request; it may not send them elsewhere.
        if (preg_match('/https?:|www\./i', $goal)) {
            throw new AssistantException('A2A_INVALID', 'The goal must not contain links.', 400);
        }
        $body = $this->checkHandoff(['skill' => $skill, 'goal' => $goal, 'fields' => $request['fields'] ?? []], $this->skills, static fn (array $entry): ?array => in_array($entry['id'], $a2a['skills'], true) ? array_keys($entry['fields']) : null);
        $code = Link::random(16);
        $now = ($this->now)();
        $expiresAt = $now + A2A::TICKET_SECONDS * 1000;
        $this->store->transaction(function (array &$data) use ($body, $code, $now, $expiresAt): void {
            $this->prune($data);
            // Agents may hold at most half of the open codes, so partners' handoffs keep room.
            if (count($data['tickets']) >= 1000 || count(array_filter($data['tickets'], static fn (array $ticket): bool => $ticket['kind'] === 'agent')) >= 500) {
                throw new AssistantException('LINK_BUSY', 'Too many open handoffs. Try again shortly.', 429);
            }
            $data['tickets'][Link::base64url(hash('sha256', $code, true))] = ['kind' => 'agent', 'link' => 'a2a'] + $body + ['expiresAt' => $expiresAt];
            $data['agents'] = ['received' => ($data['agents']['received'] ?? 0) + 1, 'lastAt' => $now];
        });

        return ['url' => $this->origin().$this->skill($this->skills, $body['skill'])['startPath'].'#psq-agent='.$code, 'expiresAt' => $expiresAt, 'name' => $this->profile['name']];
    }

    /** @return array{endpoint: string, skills: list<string>, description?: string} */
    private function openA2A(): array
    {
        return $this->a2a ?? throw new AssistantException('A2A_DISABLED', 'This site takes no A2A requests.', 404);
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
        $returnUrl = $handoff['returnUrl'] ?? null;
        unset($handoff['returnUrl']);
        $body = $this->checkHandoff($handoff, $link['partner']['skills'], static fn (array $skill): ?array => in_array($skill['id'], $link['theirs']['accept'], true) ? ($link['ours']['offer'][$skill['id']] ?? null) : null);
        // The partner may send the visitor back once, to the page they left from.
        $back = $this->returnPath($returnUrl);
        $returnId = $back !== null ? 'ret_'.Link::random(16) : null;
        if ($returnId !== null) {
            $this->store->transaction(function (array &$data) use ($returnId, $id, $body, $back): void {
                $this->prune($data);
                if (count($data['returns']) >= 1000) {
                    throw new AssistantException('LINK_BUSY', 'Too many open handoffs. Try again shortly.', 429);
                }
                $data['returns'][$returnId] = ['link' => $id, 'skill' => $body['skill'], 'path' => $back, 'expiresAt' => ($this->now)() + Link::RETURN_HOURS * 3_600_000];
            });
        }
        $answer = $this->send($link['partner'], ['type' => 'handoff', 'link' => $id, 'body' => $body + ($returnId !== null ? ['return' => $returnId] : [])], 'ticket');
        $skill = $this->skill($link['partner']['skills'], $body['skill']);
        $prefix = $link['partner']['origin'].$skill['startPath'].'#psq-link=';
        $url = $answer['body']['url'] ?? null;
        $expiresAt = $answer['body']['expiresAt'] ?? null;
        if (! is_string($url) || ! str_starts_with($url, $prefix) || ! preg_match(Link::CODE, substr($url, strlen($prefix))) || ! is_int($expiresAt)) {
            throw new AssistantException('PARTNER_INVALID', 'The partner answered with an invalid ticket.', 502);
        }
        $this->count($id, 'sent', $body['skill']);

        return ['url' => $url, 'expiresAt' => $expiresAt];
    }

    /**
     * Sends the visitor back to the site they came from (Phase 6C), once per handoff and within
     * Link::RETURN_HOURS, with a one-line outcome. Returns the URL on the partner where the visitor continues.
     *
     * @param  array<string, mixed>  $back  returnId, outcome and optional locale.
     * @return array{url: string, expiresAt: int}
     */
    public function sendBack(string $id, array $back): array
    {
        $link = $this->get($id) ?? throw new AssistantException('LINK_UNKNOWN', 'No such link.', 404);
        $this->active($link);
        $body = self::checkReturn(['return' => $back['returnId'] ?? null] + array_diff_key($back, ['returnId' => true]));
        $answer = $this->send($link['partner'], ['type' => 'return', 'link' => $id, 'body' => $body], 'ticket');
        $url = $answer['body']['url'] ?? null;
        $expiresAt = $answer['body']['expiresAt'] ?? null;
        $parts = is_string($url) ? explode('#psq-link=', $url) : [];
        if (count($parts) !== 2 || ! str_starts_with($parts[0], $link['partner']['origin'].'/') || ! preg_match(Link::CODE, $parts[1]) || ! is_int($expiresAt)) {
            throw new AssistantException('PARTNER_INVALID', 'The partner answered with an invalid ticket.', 502);
        }
        $this->count($id, 'sent');

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
            // An agent's request lives while the A2A interface is on; a partner's, while its link is active.
            if ($ticket['kind'] === 'agent') {
                return $this->a2a !== null ? $ticket : null;
            }

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
        if (! in_array($claims['type'], ['approve', 'revoke', 'handoff', 'return'], true)) {
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
        if ($claims['type'] === 'return') {
            return $this->returned($known, $claims);
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
            $data['tickets'][Link::base64url(hash('sha256', $code, true))] = ['kind' => 'handoff', 'link' => $link['id'], 'partner' => ['origin' => $link['partner']['origin'], 'name' => $link['partner']['name']]] + $body + ['expiresAt' => $expiresAt];
            $this->tally($data['links'][$known['id']], 'received', $body['skill']);

            return $this->skill($this->skills, $body['skill']);
        });

        return $this->signed($known['partner']['origin'], $known['id'], 'ticket', ['url' => $this->origin().$skill['startPath'].'#psq-link='.$code, 'expiresAt' => $expiresAt]);
    }

    /**
     * A partner sends the visitor back: one return per handoff this site sent.
     *
     * @param  array<string, mixed>  $known
     * @param  array<string, mixed>  $claims
     * @return array{claims: string, value: string}
     */
    private function returned(array $known, array $claims): array
    {
        $code = Link::random(16);
        $expiresAt = ($this->now)() + Link::TICKET_SECONDS * 1000;
        $path = $this->store->transaction(function (array &$data) use ($known, $claims, $code, $expiresAt): string {
            $this->prune($data);
            $this->useNonce($data, $claims);
            $link = $data['links'][$known['id']];
            $this->active($link);
            $body = self::checkReturn(is_array($claims['body']) ? $claims['body'] : []);
            $back = $data['returns'][$body['return']] ?? null;
            if ($back === null || $back['link'] !== $link['id']) {
                throw new AssistantException('RETURN_UNKNOWN', 'No open handoff to return from.', 404);
            }
            unset($data['returns'][$body['return']]);
            if (count($data['tickets']) >= 1000) {
                throw new AssistantException('LINK_BUSY', 'Too many open handoffs. Try again shortly.', 429);
            }
            $data['tickets'][Link::base64url(hash('sha256', $code, true))] = ['kind' => 'return', 'link' => $link['id'], 'partner' => ['origin' => $link['partner']['origin'], 'name' => $link['partner']['name']], 'skill' => $back['skill'], 'goal' => $body['outcome'], 'fields' => []]
                + (isset($body['locale']) ? ['locale' => $body['locale']] : []) + ['expiresAt' => $expiresAt];
            $this->tally($data['links'][$known['id']], 'received');

            return $back['path'];
        });

        return $this->signed($known['partner']['origin'], $known['id'], 'ticket', ['url' => $this->origin().$path.'#psq-link='.$code, 'expiresAt' => $expiresAt]);
    }

    /**
     * A checked return body: the reference, a one-line outcome and an optional locale.
     *
     * @param  array<string, mixed>  $value
     * @return array{return: string, outcome: string, locale?: string}
     */
    private static function checkReturn(array $value): array
    {
        if (array_diff(array_keys($value), ['return', 'outcome', 'locale']) !== [] || ! is_string($value['return'] ?? null) || ! preg_match(Link::RETURN_ID, $value['return'])) {
            throw new AssistantException('RETURN_INVALID', 'The return is malformed.', 400);
        }
        if (! Link::sentence($value['outcome'] ?? null)) {
            throw new AssistantException('RETURN_INVALID', 'A return needs an outcome of at most 300 characters.', 400);
        }
        if (array_key_exists('locale', $value) && (! is_string($value['locale']) || ! preg_match('/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/', $value['locale']))) {
            throw new AssistantException('RETURN_INVALID', 'The return locale is invalid.', 400);
        }

        return ['return' => $value['return'], 'outcome' => $value['outcome']] + (array_key_exists('locale', $value) ? ['locale' => $value['locale']] : []);
    }

    /** The same-origin path and query of a return URL on this site, if usable. */
    private function returnPath(mixed $value): ?string
    {
        if (! is_string($value) || ActionSigner::origin($value) !== $this->origin()) {
            return null;
        }
        $parts = parse_url($value);
        $path = ($parts['path'] ?? '/').(isset($parts['query']) ? '?'.$parts['query'] : '');

        return strlen($path) <= 200 && str_starts_with($path, '/') && ! str_starts_with($path, '//') && ! preg_match('/[\s\\\\#]/', $path) ? $path : null;
    }

    private function count(string $id, string $direction, ?string $skill = null): void
    {
        try {
            $this->store->transaction(function (array &$data) use ($id, $direction, $skill): void {
                if (isset($data['links'][$id])) {
                    $this->tally($data['links'][$id], $direction, $skill);
                }
            });
        } catch (\Throwable) {
            // Counts are for the owner's information only.
        }
    }

    /**
     * Counts one handoff (with its skill) or return on a stored link record.
     *
     * @param  array<string, mixed>  $link
     */
    private function tally(array &$link, string $direction, ?string $skill = null): void
    {
        $stats = $link['stats'] ?? ['sent' => 0, 'received' => 0];
        $stats[$direction]++;
        if ($skill !== null) {
            $stats['skills'][$skill] ??= ['sent' => 0, 'received' => 0];
            $stats['skills'][$skill][$direction]++;
        }
        $stats['lastAt'] = ($this->now)();
        $link['stats'] = $stats;
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
        if (array_diff(array_keys($value), ['skill', 'goal', 'fields', 'locale', 'return']) !== []) {
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

        if (array_key_exists('return', $value) && (! is_string($value['return']) || ! preg_match(Link::RETURN_ID, $value['return']))) {
            throw new AssistantException('HANDOFF_INVALID', 'The return reference is invalid.', 400);
        }

        return ['skill' => $skill['id'], 'goal' => $goal, 'fields' => $fields] + (array_key_exists('locale', $value) ? ['locale' => $value['locale']] : []) + (array_key_exists('return', $value) ? ['returnId' => $value['return']] : []);
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
        $data['returns'] ??= [];
        foreach ($data['returns'] as $key => $back) {
            if ($back['expiresAt'] < $now) {
                unset($data['returns'][$key]);
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
