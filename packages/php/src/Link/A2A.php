<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

use PageSquire\Server\ActionSigner;
use PageSquire\Server\AssistantException;

/**
 * PageSquire Link's optional A2A interface (Phase 6E), mirroring a2a.ts in @pagesquire/server: canonical
 * JSON (RFC 8785), the signed A2A 1.0 Agent Card, and the JSON-RPC answer to SendMessage. An agent's
 * request never acts on the site; it only yields a single-use link where the person continues and confirms.
 */
final class A2A
{
    public const PROTOCOL_VERSION = '1.0';

    /** How long the continuation link an agent receives stays redeemable. */
    public const TICKET_SECONDS = 600;

    /** The Agent Card extension that publishes each open skill's fields. */
    public const EXTENSION = 'https://github.com/naufaldenta/pagesquire/blob/main/docs/link.md#a2a-interface-phase-6e';

    /** Where a site publishes the key set that verifies its Agent Card. */
    public const KEYS_PATH = '/.well-known/pagesquire-keys.json';

    private const UNSUPPORTED = [
        'GetTask' => -32001, 'CancelTask' => -32001, 'SubscribeToTask' => -32001,
        'SendStreamingMessage' => -32004, 'ListTasks' => -32004,
        'CreateTaskPushNotificationConfig' => -32003, 'GetTaskPushNotificationConfig' => -32003,
        'ListTaskPushNotificationConfigs' => -32003, 'DeleteTaskPushNotificationConfig' => -32003,
        'GetExtendedAgentCard' => -32007,
    ];

    /**
     * RFC 8785 (JCS) canonical JSON. Lists are arrays; other arrays and objects are JSON objects (use an
     * empty stdClass for an empty object). Keys sort by UTF-16 code units.
     */
    public static function canonicalize(mixed $value): string
    {
        if ($value === null || is_bool($value) || is_string($value) || is_int($value)) {
            return self::json($value);
        }
        if (is_float($value)) {
            if (! is_finite($value)) {
                throw new \InvalidArgumentException('JSON numbers must be finite.');
            }

            return floor($value) === $value && abs($value) < 2 ** 53 ? (string) (int) $value : self::json($value);
        }
        if (is_array($value) && array_is_list($value) && $value !== []) {
            return '['.implode(',', array_map(self::canonicalize(...), $value)).']';
        }
        if (is_array($value) && $value === []) {
            return '[]';
        }
        if (is_array($value) || $value instanceof \stdClass) {
            $entries = (array) $value;
            $keys = array_map('strval', array_keys($entries));
            usort($keys, static fn (string $a, string $b): int => strcmp(self::utf16($a), self::utf16($b)));

            return '{'.implode(',', array_map(static fn (string $key): string => self::json($key).':'.self::canonicalize($entries[$key]), $keys)).'}';
        }
        throw new \InvalidArgumentException('Only JSON values can be canonicalized.');
    }

    /**
     * The site key as a JWK; kid is its RFC 7638 thumbprint.
     *
     * @return array{kty: string, crv: string, x: string, kid: string, use: string, alg: string}
     */
    public static function jwk(ActionSigner $signer): array
    {
        $x = Link::base64url((string) base64_decode(substr($signer->publicKey(), strlen('ed25519:')), true));

        return ['kty' => 'OKP', 'crv' => 'Ed25519', 'x' => $x, 'kid' => Link::base64url(hash('sha256', self::canonicalize(['crv' => 'Ed25519', 'kty' => 'OKP', 'x' => $x]), true)), 'use' => 'sig', 'alg' => 'EdDSA'];
    }

    /**
     * Signs an Agent Card as A2A section 8.4 describes: JCS over the card without signatures, then a JWS
     * with an EdDSA protected header naming the key (kid) and where to fetch it (jku).
     *
     * @param  array<string, mixed>  $card
     * @return array<string, mixed>
     */
    public static function signCard(array $card, ActionSigner $signer, string $jku): array
    {
        unset($card['signatures']);
        $header = Link::base64url(self::canonicalize(['alg' => 'EdDSA', 'typ' => 'JOSE', 'kid' => self::jwk($signer)['kid'], 'jku' => $jku]));
        $signature = Link::base64url((string) base64_decode($signer->signText('', $header.'.'.Link::base64url(self::canonicalize($card))), true));

        return $card + ['signatures' => [['protected' => $header, 'signature' => $signature]]];
    }

    /**
     * Whether one of the card's signatures verifies with a key from $keys (a JWK Set). Decode the card
     * with objects kept as stdClass (json_decode without associative arrays) so empty objects survive.
     */
    public static function verifyCard(mixed $card, mixed $keys): bool
    {
        if (! $card instanceof \stdClass || ! isset($card->signatures) || ! is_array($card->signatures)) {
            return false;
        }
        $unsigned = clone $card;
        unset($unsigned->signatures);
        $payload = Link::base64url(self::canonicalize($unsigned));
        foreach ($card->signatures as $entry) {
            $header = is_object($entry) && is_string($entry->protected ?? null) ? json_decode((string) Link::fromBase64url($entry->protected), true) : null;
            if (! is_array($header) || ($header['alg'] ?? null) !== 'EdDSA' || ! is_string($entry->signature ?? null)) {
                continue;
            }
            foreach (is_object($keys) && is_array($keys->keys ?? null) ? $keys->keys : [] as $key) {
                if (is_object($key) && ($key->kid ?? null) === ($header['kid'] ?? false) && ($key->kty ?? null) === 'OKP' && ($key->crv ?? null) === 'Ed25519' && is_string($key->x ?? null)) {
                    $signature = Link::fromBase64url($entry->signature);
                    $public = Link::fromBase64url($key->x);
                    if (is_string($signature) && is_string($public) && ActionSigner::verifyText('ed25519:'.base64_encode($public), '', $entry->protected.'.'.$payload, base64_encode($signature))) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Reads SendMessage params: one user message whose parts are text (the goal) and at most one data part
     * {skill?, goal?, fields?}. Files and URLs are not accepted, and a message cannot continue a task.
     *
     * @return array{request: array{skill?: string, goal: string, fields: array<string, mixed>}, contextId?: string}
     */
    public static function readMessage(mixed $params): array
    {
        $invalid = static fn (string $message): A2AError => new A2AError(-32602, 'A2A_INVALID', $message);
        $message = is_array($params) ? ($params['message'] ?? null) : null;
        if (! is_array($message) || array_is_list($message)) {
            throw $invalid('SendMessage needs a message.');
        }
        $outputs = is_array($params['configuration'] ?? null) ? ($params['configuration']['acceptedOutputModes'] ?? null) : null;
        if (is_array($outputs) && array_intersect($outputs, ['text/plain', 'application/json']) === []) {
            throw new A2AError(-32005, 'A2A_CONTENT', 'This agent answers with text/plain and application/json only.');
        }
        if (array_key_exists('taskId', $message)) {
            throw new A2AError(-32001, 'A2A_TASK', 'This agent keeps no tasks.');
        }
        $parts = $message['parts'] ?? null;
        if (($message['role'] ?? null) !== 'ROLE_USER' || ! is_string($message['messageId'] ?? null) || ! preg_match('/^[\x21-\x7e]{1,128}$/', $message['messageId']) || ! is_array($parts) || ! array_is_list($parts) || count($parts) < 1 || count($parts) > 10) {
            throw $invalid('Send one user message with a messageId and one to ten parts.');
        }
        $texts = [];
        $data = null;
        foreach ($parts as $part) {
            if (! is_array($part)) {
                throw $invalid('Each part must be an object.');
            }
            if (is_string($part['text'] ?? null)) {
                $texts[] = $part['text'];
            } elseif (is_array($part['data'] ?? null) && ! array_is_list($part['data']) && $data === null) {
                $data = $part['data'];
            } else {
                throw new A2AError(-32005, 'A2A_CONTENT', 'Send text and at most one data part; files and URLs are not accepted.');
            }
        }
        if ($data !== null && array_diff(array_keys($data), ['skill', 'goal', 'fields']) !== []) {
            throw $invalid('The data part takes skill, goal and fields only.');
        }
        $contextId = $message['contextId'] ?? null;

        return ['request' => (is_string($data['skill'] ?? null) ? ['skill' => $data['skill']] : []) + [
            'goal' => is_string($data['goal'] ?? null) ? $data['goal'] : trim(implode(' ', $texts)),
            'fields' => is_array($data['fields'] ?? null) ? $data['fields'] : [],
        ]] + (is_string($contextId) && preg_match('/^[\x21-\x7e]{1,128}$/', $contextId) ? ['contextId' => $contextId] : []);
    }

    /**
     * One JSON-RPC request body to its JSON-RPC answer. $version is the request's A2A-Version header or
     * query parameter; an empty one means 0.3, which is not served.
     *
     * @return array<string, mixed>
     */
    public static function answer(LinkManager $manager, string $raw, string $version): array
    {
        $error = static fn (mixed $id, int $code, string $message, ?string $reason = null): array => ['jsonrpc' => '2.0', 'id' => $id, 'error' => ['code' => $code, 'message' => $message]
            + ($reason !== null ? ['data' => [['@type' => 'type.googleapis.com/google.rpc.ErrorInfo', 'reason' => $reason, 'domain' => 'pagesquire']]] : [])];
        try {
            $call = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $error(null, -32700, 'The request is not JSON.');
        }
        $id = is_array($call) ? ($call['id'] ?? null) : null;
        if (! is_array($call) || array_is_list($call) || ($call['jsonrpc'] ?? null) !== '2.0' || ! is_string($call['method'] ?? null)
            || ! ($id === null || is_int($id) || is_float($id) || (is_string($id) && strlen($id) <= 128))) {
            return $error(null, -32600, 'Send one JSON-RPC 2.0 request.');
        }
        if (trim($version) !== self::PROTOCOL_VERSION) {
            return $error($id, -32009, 'This agent speaks A2A '.self::PROTOCOL_VERSION.'; send the A2A-Version header.', 'A2A_VERSION');
        }
        if ($call['method'] !== 'SendMessage') {
            $code = self::UNSUPPORTED[$call['method']] ?? null;

            return $code === null
                ? $error($id, -32601, 'Unknown method '.$call['method'].'.')
                : $error($id, $code, $code === -32001 ? 'This agent keeps no tasks.' : $call['method'].' is not supported.', 'A2A_UNSUPPORTED');
        }
        try {
            $read = self::readMessage($call['params'] ?? null);
            $ticket = $manager->agentHandoff($read['request']);
        } catch (A2AError $exception) {
            return $error($id, $exception->rpcCode, $exception->getMessage(), $exception->reason);
        } catch (AssistantException $exception) {
            return $error($id, $exception->errorCode === 'LINK_BUSY' ? -32603 : -32602, $exception->getMessage(), $exception->errorCode);
        }

        return ['jsonrpc' => '2.0', 'id' => $id, 'result' => ['message' => ['messageId' => 'msg_'.Link::random(16)]
            + (isset($read['contextId']) ? ['contextId' => $read['contextId']] : [])
            + ['role' => 'ROLE_AGENT', 'parts' => [
                ['text' => 'Open '.$ticket['url'].' to continue on '.$ticket['name'].'. The link works once, within '.(self::TICKET_SECONDS / 60).' minutes, and the person confirms on the site before its assistant does anything.'],
                ['data' => ['url' => $ticket['url'], 'expiresAt' => gmdate('Y-m-d\TH:i:s', intdiv($ticket['expiresAt'], 1000)).sprintf('.%03dZ', $ticket['expiresAt'] % 1000)], 'mediaType' => 'application/json'],
            ]]]];
    }

    private static function json(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR);
    }

    /** A key's UTF-16 code units as big-endian bytes, which compare like JavaScript strings. */
    private static function utf16(string $key): string
    {
        return mb_convert_encoding($key, 'UTF-16BE', 'UTF-8');
    }
}
