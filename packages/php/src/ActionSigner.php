<?php

declare(strict_types=1);

namespace PageSquire\Server;

/**
 * Signs action calls for the PageSquire companion extension, which runs only
 * calls signed with the key the site publishes in /.well-known/pagesquire.json.
 * Mirrors packages/server/src/signing.ts.
 */
final class ActionSigner
{
    /** Prefix of every signed message, so the key cannot sign other data. */
    public const CONTEXT = 'pagesquire-call-v1.';

    /** Lifetime of a signed call; the extension also accepts each call only once. */
    public const TTL_SECONDS = 60;

    private string $secretKey;

    private string $publicKey;

    /**
     * @param  string  $signingKey  Base64 of a 32-byte Ed25519 seed; keep it secret.
     * @param  string  $origin  The site origin the calls are for, e.g. https://shop.example.
     */
    public function __construct(string $signingKey, private string $origin)
    {
        if (! function_exists('sodium_crypto_sign_seed_keypair')) {
            throw new AssistantException('INVALID_OPTIONS', 'Signing action calls needs the sodium extension.', 500);
        }
        $seed = base64_decode($signingKey, true);
        if ($seed === false || strlen($seed) !== SODIUM_CRYPTO_SIGN_SEEDBYTES || base64_encode($seed) !== $signingKey) {
            throw new AssistantException('INVALID_OPTIONS', 'The signing key must be base64 of a 32-byte Ed25519 seed.', 500);
        }
        if (self::origin($origin) !== $origin) {
            throw new AssistantException('INVALID_OPTIONS', 'The signing origin must be an http(s) origin such as https://shop.example.', 500);
        }
        $pair = sodium_crypto_sign_seed_keypair($seed);
        $this->secretKey = sodium_crypto_sign_secretkey($pair);
        $this->publicKey = sodium_crypto_sign_publickey($pair);
    }

    /**
     * A new signing key and the public key to publish.
     *
     * @return array{signingKey: string, publicKey: string}
     */
    public static function generate(): array
    {
        $signingKey = base64_encode(random_bytes(SODIUM_CRYPTO_SIGN_SEEDBYTES));

        return ['signingKey' => $signingKey, 'publicKey' => (new self($signingKey, 'https://example.com'))->publicKey()];
    }

    /** The origin of a URL ("scheme://host[:port]"), or null. */
    public static function origin(string $url): ?string
    {
        $parts = parse_url($url);
        if (! is_array($parts) || ! in_array($parts['scheme'] ?? '', ['http', 'https'], true) || ! isset($parts['host'])) {
            return null;
        }
        $default = $parts['scheme'] === 'https' ? 443 : 80;
        $port = isset($parts['port']) && $parts['port'] !== $default ? ':'.$parts['port'] : '';

        return strtolower($parts['scheme']).'://'.strtolower($parts['host']).$port;
    }

    /** The "ed25519:…" public key for the site declaration. */
    public function publicKey(): string
    {
        return 'ed25519:'.base64_encode($this->publicKey);
    }

    /**
     * Returns the call with a signature over its claims.
     *
     * @param  array<string, mixed>  $call
     * @return array<string, mixed>
     */
    public function sign(array $call, ?int $now = null): array
    {
        $issued = $now ?? time();
        $claims = json_encode([
            'v' => 1,
            'origin' => $this->origin,
            'callId' => $call['callId'],
            'capabilityId' => $call['capabilityId'],
            'snapshotId' => $call['snapshotId'],
            'parameters' => (object) $call['parameters'],
            'iat' => $issued,
            'exp' => $issued + self::TTL_SECONDS,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $call['signature'] = ['claims' => $claims, 'value' => $this->signClaims($claims)];

        return $call;
    }

    /** Base64 Ed25519 signature over the context prefix and the claims text. */
    public function signClaims(string $claims): string
    {
        return base64_encode(sodium_crypto_sign_detached(self::CONTEXT.$claims, $this->secretKey));
    }

    /**
     * The /.well-known/pagesquire.json document for the companion extension.
     *
     * @param  bool  $screenshots  Declare redacted screenshots; the visitor still has to allow them.
     * @return array{version: int, endpoint: string, publicKey: string, features: list<string>}
     */
    public function declaration(string $endpoint, bool $screenshots = false): array
    {
        return ['version' => 1, 'endpoint' => $endpoint, 'publicKey' => $this->publicKey(), 'features' => $screenshots ? ['trustedInput', 'screenshots'] : ['trustedInput']];
    }
}
