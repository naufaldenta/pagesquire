<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

use PageSquire\Server\ActionSigner;
use PageSquire\Server\AssistantException;

/**
 * PageSquire Link protocol rules shared by the manager and the endpoint.
 * Mirrors packages/server/src/link.ts; see docs/link.md.
 */
final class Link
{
    /** Prefix of every signed link message, so link and call signatures never mix. */
    public const CONTEXT = 'pagesquire-link-v1.';

    public const TTL_SECONDS = 300;

    public const CLOCK_SKEW_SECONDS = 120;

    public const MAX_BODY_BYTES = 65536;

    public const TYPES = ['accept', 'accepted', 'approve', 'revoke', 'ack', 'handoff', 'ticket'];

    /** How long a handoff code stays redeemable. */
    public const TICKET_SECONDS = 120;

    public const CODE = '/^[A-Za-z0-9_-]{22}$/';

    private const ID = '/^[A-Za-z0-9_-]{16,64}$/';

    public static function base64url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    public static function fromBase64url(string $text): string|false
    {
        return base64_decode(strtr($text, '-_', '+/'), true);
    }

    public static function random(int $bytes): string
    {
        return self::base64url(random_bytes($bytes));
    }

    /** HTTPS origins, or plain HTTP only on local and `.test` hosts for development. */
    public static function originAllowed(string $value): bool
    {
        $origin = ActionSigner::origin($value);
        if ($origin === null || $origin !== $value) {
            return false;
        }
        if (str_starts_with($value, 'https://')) {
            return true;
        }
        $host = (string) parse_url($value, PHP_URL_HOST);

        return $host === 'localhost' || $host === '127.0.0.1' || $host === '[::1]' || str_ends_with($host, '.localhost') || str_ends_with($host, '.test');
    }

    private static function path(mixed $value): bool
    {
        return is_string($value) && strlen($value) <= 200 && str_starts_with($value, '/') && ! str_starts_with($value, '//') && ! preg_match('/[\s\\\\#]/', $value);
    }

    private static function text(mixed $value, int $max): bool
    {
        return is_string($value) && $value !== '' && mb_strlen($value) <= $max;
    }

    /** @param int<1, max> $max */
    private static function texts(mixed $value, int $max, int $item): bool
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) > $max) {
            return false;
        }
        foreach ($value as $entry) {
            if (! self::text($entry, $item)) {
                return false;
            }
        }

        return true;
    }

    /** @return array<string, mixed>|null */
    /**
     * The link.handoff capability, the same as createLinkCapabilities() in @pagesquire/core.
     * Hosts add it to the manifest when the engine runs with links.
     *
     * @return array<string, mixed>
     */
    public static function handoffCapability(): array
    {
        return [
            'id' => 'link.handoff',
            'description' => "Hand the visitor to a partner site for one of the partner skills listed in partnerSkills, when that is what they want and this site cannot do it. Give the skill value as listed, a one-line goal in the visitor's own words, and only fields the visitor stated. The visitor sees the partner, the goal and every field and must approve; the partner then opens in a new tab.",
            'execution' => 'browser',
            'handler' => 'link.handoff',
            'inputSchema' => [
                'type' => 'object',
                'properties' => [
                    'skill' => ['type' => 'string', 'minLength' => 3, 'maxLength' => 200],
                    'goal' => ['type' => 'string', 'minLength' => 1, 'maxLength' => 300],
                    'fields' => ['type' => 'object', 'maxProperties' => 10, 'additionalProperties' => ['anyOf' => [['type' => 'string', 'maxLength' => 200], ['type' => 'number'], ['type' => 'boolean']]]],
                    'partner' => ['type' => 'object', 'properties' => ['origin' => ['type' => 'string', 'maxLength' => 200], 'name' => ['type' => 'string', 'maxLength' => 80]], 'required' => ['origin', 'name'], 'additionalProperties' => false],
                ],
                'required' => ['skill', 'goal'],
                'additionalProperties' => false,
            ],
            'risk' => 'reversible',
            'verification' => ['handler' => 'link.handoff.verify'],
        ];
    }

    /** Whether a value fits a skill field's schema. Node applies the same rules. */
    public static function valueAllowed(array $schema, mixed $value): bool
    {
        if ($schema['type'] === 'boolean') {
            return is_bool($value);
        }
        if ($schema['type'] !== 'string') {
            // JSON may carry a whole number as 4.0; it is still an integer.
            $number = is_int($value) || (is_float($value) && is_finite($value));
            if (! $number || ($schema['type'] === 'integer' && ! is_int($value) && floor($value) !== $value)) {
                return false;
            }

            return (! isset($schema['minimum']) || $value >= $schema['minimum']) && (! isset($schema['maximum']) || $value <= $schema['maximum']);
        }
        if (! is_string($value) || $value === '' || ! mb_check_encoding($value, 'UTF-8') || mb_strlen($value) > ($schema['maxLength'] ?? 200) || preg_match('/[\x00-\x1f\x7f]/', $value)
            || (isset($schema['enum']) && ! in_array($value, $schema['enum'], true))
            || (isset($schema['pattern']) && preg_match('/'.str_replace('/', '\/', $schema['pattern']).'/u', $value) !== 1)) {
            return false;
        }

        return match ($schema['format'] ?? null) {
            'date' => preg_match('/^([1-9]\d{3})-(\d{2})-(\d{2})$/', $value, $match) === 1 && checkdate((int) $match[2], (int) $match[3], (int) $match[1]),
            'time' => preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/', $value) === 1,
            'email' => preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/u', $value) === 1,
            default => true,
        };
    }

    private static function field(mixed $value): ?array
    {
        if (! is_array($value) || array_is_list($value)) {
            return null;
        }
        $only = static fn (string ...$allowed): bool => array_diff(array_keys($value), $allowed) === [];
        $bound = static fn (string $key): bool => ! array_key_exists($key, $value) || is_int($value[$key]) || is_float($value[$key]);
        $type = $value['type'] ?? null;
        if ($type === 'boolean' && $only('type')) {
            return ['type' => 'boolean'];
        }
        if (($type === 'integer' || $type === 'number') && $only('type', 'minimum', 'maximum') && $bound('minimum') && $bound('maximum')) {
            return $value;
        }
        if ($type === 'string' && $only('type', 'maxLength', 'pattern', 'format', 'enum')
            && (! isset($value['maxLength']) || (is_int($value['maxLength']) && $value['maxLength'] >= 1 && $value['maxLength'] <= 200))
            && (! isset($value['pattern']) || (self::text($value['pattern'], 200) && @preg_match('/'.str_replace('/', '\/', $value['pattern']).'/u', '') !== false))
            && (! isset($value['format']) || in_array($value['format'], ['date', 'time', 'email'], true))
            && (! isset($value['enum']) || self::texts($value['enum'], 20, 80))) {
            return $value;
        }

        return null;
    }

    /**
     * A checked copy of a skill catalog, or null when anything is off.
     *
     * @return list<array<string, mixed>>|null
     */
    public static function readSkills(mixed $value): ?array
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) > 20) {
            return null;
        }
        $skills = [];
        $ids = [];
        foreach ($value as $entry) {
            if (! is_array($entry) || array_is_list($entry) && $entry !== []
                || array_diff(array_keys($entry), ['id', 'name', 'description', 'tags', 'examples', 'fields', 'startPath']) !== []
                || ! is_string($entry['id'] ?? null) || ! preg_match('/^[a-z0-9_]{1,40}$/', $entry['id']) || isset($ids[$entry['id']])
                || ! self::text($entry['name'] ?? null, 80) || ! self::text($entry['description'] ?? null, 300)
                || ! self::texts($entry['tags'] ?? null, 10, 40)
                || (array_key_exists('examples', $entry) && ! self::texts($entry['examples'], 5, 200))
                || ! self::path($entry['startPath'] ?? null)
                || ! is_array($entry['fields'] ?? null) || (array_is_list($entry['fields']) && $entry['fields'] !== []) || count($entry['fields']) > 10) {
                return null;
            }
            $fields = [];
            foreach ($entry['fields'] as $name => $schema) {
                $checked = self::field($schema);
                if (! is_string($name) || ! preg_match('/^[a-z][A-Za-z0-9_]{0,39}$/', $name) || $checked === null) {
                    return null;
                }
                $fields[$name] = $checked;
            }
            $ids[$entry['id']] = true;
            $skills[] = ['id' => $entry['id'], 'name' => $entry['name'], 'description' => $entry['description'], 'tags' => $entry['tags']]
                + (isset($entry['examples']) ? ['examples' => $entry['examples']] : [])
                + ['fields' => $fields, 'startPath' => $entry['startPath']];
        }

        return $skills;
    }

    /**
     * The partner a /.well-known/pagesquire.json document describes, if it offers Link.
     *
     * @return array{origin: string, name: string, endpoint: string, publicKey: string, skills: list<array<string, mixed>>}|null
     */
    public static function readDeclaration(mixed $value, string $origin): ?array
    {
        if (! is_array($value) || ($value['version'] ?? null) !== 1 || ! is_string($value['publicKey'] ?? null)
            || ! preg_match('/^ed25519:[A-Za-z0-9+\/]{43}=$/', $value['publicKey'])
            || ! is_array($value['features'] ?? null) || ! in_array('link', $value['features'], true)
            || ! is_array($value['link'] ?? null) || ! self::path($value['link']['endpoint'] ?? null) || ! self::text($value['link']['name'] ?? null, 80)) {
            return null;
        }
        $skills = self::readSkills($value['link']['skills'] ?? null);
        if ($skills === null) {
            return null;
        }

        return ['origin' => $origin, 'name' => $value['link']['name'], 'endpoint' => $origin.$value['link']['endpoint'], 'publicKey' => $value['publicKey'], 'skills' => $skills];
    }

    /**
     * A skill list encoded so empty field maps stay JSON objects.
     *
     * @param  list<array<string, mixed>>  $skills
     * @return list<array<string, mixed>>
     */
    public static function encodeSkills(array $skills): array
    {
        return array_map(static fn (array $skill): array => ['fields' => (object) $skill['fields']] + $skill, $skills);
    }

    /**
     * A pairing invitation: psq1.<origin, base64url>.<invitation ID>.<secret>.
     *
     * @return array{origin: string, id: string, secret: string}|null
     */
    public static function readInvitation(string $code): ?array
    {
        $parts = explode('.', trim($code));
        if (count($parts) !== 4 || $parts[0] !== 'psq1') {
            return null;
        }
        $origin = self::fromBase64url($parts[1]);

        return is_string($origin) && self::originAllowed($origin) && preg_match('/^inv_[A-Za-z0-9_-]{22}$/', $parts[2]) && preg_match('/^[A-Za-z0-9_-]{43}$/', $parts[3])
            ? ['origin' => $origin, 'id' => $parts[2], 'secret' => $parts[3]]
            : null;
    }

    public static function keyHash(string $secret): string
    {
        return self::base64url(hash('sha256', $secret, true));
    }

    /** Proof that the accepting site holds the invitation secret, tied to its origin and nonce. */
    public static function invitationProof(string $keyHash, string $from, string $nonce): string
    {
        return self::base64url(hash_hmac('sha256', 'pagesquire-link-accept.'.$from.'.'.$nonce, (string) self::fromBase64url($keyHash), true));
    }

    /**
     * Signs one link message.
     *
     * @param  array{type: string, from: string, to: string, link: ?string, body: array<string, mixed>, nonce?: string}  $message
     * @return array{claims: string, value: string}
     */
    public static function sign(array $message, ActionSigner $signer, ?int $now = null): array
    {
        $issued = $now ?? time();
        $claims = json_encode([
            'v' => 1,
            'type' => $message['type'],
            'from' => $message['from'],
            'to' => $message['to'],
            'link' => $message['link'],
            'nonce' => $message['nonce'] ?? self::random(16),
            'iat' => $issued,
            'exp' => $issued + self::TTL_SECONDS,
            'body' => (object) $message['body'],
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return ['claims' => $claims, 'value' => $signer->signText(self::CONTEXT, $claims)];
    }

    /**
     * The claims of a well-formed envelope, before any signature check.
     *
     * @return array{v: int, type: string, from: string, to: string, link: ?string, nonce: string, iat: int, exp: int, body: array<string, mixed>}|null
     */
    public static function readClaims(mixed $envelope): ?array
    {
        if (! is_array($envelope) || ! is_string($envelope['claims'] ?? null) || strlen($envelope['claims']) > 32768 || ! is_string($envelope['value'] ?? null)) {
            return null;
        }
        try {
            $claims = json_decode($envelope['claims'], true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return is_array($claims) && ($claims['v'] ?? null) === 1 && in_array($claims['type'] ?? null, self::TYPES, true)
            && is_string($claims['from'] ?? null) && self::originAllowed($claims['from'])
            && is_string($claims['to'] ?? null) && self::originAllowed($claims['to'])
            && array_key_exists('link', $claims) && ($claims['link'] === null || (is_string($claims['link']) && preg_match(self::ID, $claims['link'])))
            && is_string($claims['nonce'] ?? null) && preg_match(self::ID, $claims['nonce'])
            && is_int($claims['iat'] ?? null) && is_int($claims['exp'] ?? null)
            && is_array($claims['body'] ?? null) && (! array_is_list($claims['body']) || $claims['body'] === [])
            ? $claims
            : null;
    }

    /**
     * Checks signature, recipient and time window; single use is the caller's job.
     *
     * @param  array{to: string, from?: string, type?: string, link?: ?string}  $expected
     * @return array{v: int, type: string, from: string, to: string, link: ?string, nonce: string, iat: int, exp: int, body: array<string, mixed>}
     */
    public static function verify(mixed $envelope, string $publicKey, array $expected, ?int $now = null): array
    {
        $claims = self::readClaims($envelope);
        if ($claims === null) {
            throw new AssistantException('LINK_INVALID', 'The link message is malformed.', 400);
        }
        if (! ActionSigner::verifyText($publicKey, self::CONTEXT, $envelope['claims'], $envelope['value'])) {
            throw new AssistantException('LINK_SIGNATURE', "The link message is not signed by the partner's key.", 401);
        }
        $seconds = $now ?? time();
        if ($claims['exp'] < $claims['iat'] || $claims['exp'] - $claims['iat'] > self::TTL_SECONDS || $claims['iat'] > $seconds + self::CLOCK_SKEW_SECONDS || $seconds > $claims['exp'] + self::CLOCK_SKEW_SECONDS) {
            throw new AssistantException('LINK_EXPIRED', 'The link message has expired.', 401);
        }
        if ($claims['to'] !== $expected['to'] || (isset($expected['from']) && $claims['from'] !== $expected['from'])
            || (isset($expected['type']) && $claims['type'] !== $expected['type'])
            || (array_key_exists('link', $expected) && $claims['link'] !== $expected['link'])) {
            throw new AssistantException('LINK_INVALID', 'The link message is for another site, link or step.', 400);
        }

        return $claims;
    }
}
