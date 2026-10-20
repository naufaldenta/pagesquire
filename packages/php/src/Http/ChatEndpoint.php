<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

use PageSquire\Server\AssistantException;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\ProtocolValidator;
use Throwable;

final class ChatEndpoint
{
    public function __construct(
        private readonly ConversationEngine $engine,
        private readonly ProtocolValidator $validator,
        private readonly ConversationStore $store,
        private readonly string $origin,
        private readonly int $requestsPerMinute = 20,
    ) {
        $url = parse_url($origin);
        if (! is_array($url) || ! in_array($url['scheme'] ?? '', ['https', 'http'], true) || empty($url['host']) || isset($url['path']) || isset($url['query']) || isset($url['fragment']) || isset($url['user']) || isset($url['pass']) || $requestsPerMinute < 1 || $requestsPerMinute > 100) {
            throw new AssistantException('INVALID_OPTIONS', 'Invalid endpoint limits or origin.', 500);
        }
    }

    /**
     * Session data MUST come from host authentication, never from the submitted JSON/cookies directly.
     *
     * @param  array<string, string>  $headers
     * @param  array{key: string, principal: string, csrfToken: string, capabilityIds: list<string>}|null  $session
     * @return array{status: int, body: array<string, mixed>}
     */
    public function handle(string $method, array $headers, string $body, ?array $session): array
    {
        try {
            $headers = array_change_key_case($headers, CASE_LOWER);
            if ($method !== 'POST') {
                throw new AssistantException('METHOD_NOT_ALLOWED', 'Use POST.', 405);
            }
            if (($headers['origin'] ?? '') !== $this->origin) {
                throw new AssistantException('ORIGIN_DENIED', 'The request origin is not authorized.', 403);
            }
            if (! preg_match('/^application\/json(?:\s*;|$)/i', $headers['content-type'] ?? '') || ! in_array($headers['content-encoding'] ?? 'identity', ['', 'identity'], true)) {
                throw new AssistantException('JSON_REQUIRED', 'Send an uncompressed application/json request.', 415);
            }
            if ($session === null || $session['key'] === '' || $session['principal'] === '') {
                throw new AssistantException('ACCESS_DENIED', 'The assistant is not authorized.', 403);
            }
            $token = $headers['x-csrf-token'] ?? '';
            if (strlen($token) < 16 || strlen($token) > 256 || ! hash_equals($session['csrfToken'], $token)) {
                throw new AssistantException('CSRF_MISMATCH', 'Refresh the page before using the assistant.', 419);
            }
            if (strlen($body) > 196608) {
                throw new AssistantException('REQUEST_TOO_LARGE', 'The assistant request is too large.', 413);
            }
            $this->validator->validate('chatRequest', json_decode($body, false, 64, JSON_THROW_ON_ERROR));
            $request = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
            $reply = $this->store->transaction($session['key'], function (?array $stored, callable $save) use ($session, $request): array {
                $now = time();
                $rate = isset($stored['rate']) && $now - $stored['rate']['since'] < 60 ? $stored['rate'] : ['since' => $now, 'count' => 0];
                if ($rate['count'] >= $this->requestsPerMinute) {
                    throw new AssistantException('RATE_LIMITED', 'Too many assistant requests. Try again later.', 429);
                }
                $rate['count']++;
                $current = ['principal' => $session['principal'], 'state' => ($stored['principal'] ?? null) === $session['principal'] ? $stored['state'] : null, 'rate' => $rate];
                $save($current);
                $result = $this->engine->handle($request, $current['state'], $session['capabilityIds'], function (array $state) use (&$current, $save): void {
                    $current['state'] = $state;
                    $save($current);
                });

                return $result['reply'];
            });

            return ['status' => 200, 'body' => $reply];
        } catch (AssistantException $error) {
            return ['status' => $error->httpStatus, 'body' => ['error' => ['code' => $error->errorCode, 'message' => $error->getMessage()]]];
        } catch (\JsonException) {
            return ['status' => 422, 'body' => ['error' => ['code' => 'INVALID_PAYLOAD', 'message' => 'Invalid JSON request.']]];
        } catch (Throwable) {
            return ['status' => 503, 'body' => ['error' => ['code' => 'ASSISTANT_UNAVAILABLE', 'message' => 'The assistant is unavailable. Try again later.']]];
        }
    }

    /** @param array{key: string, principal: string, csrfToken: string, capabilityIds: list<string>}|null $session */
    public function serve(?array $session): void
    {
        $result = $this->handle($_SERVER['REQUEST_METHOD'] ?? '', getallheaders(), file_get_contents('php://input', false, null, 0, 196609), $session);
        http_response_code($result['status']);
        header('Content-Type: application/json');
        header('Cache-Control: no-store, private');
        header('X-Content-Type-Options: nosniff');
        if ($result['status'] === 405) {
            header('Allow: POST');
        }
        if ($result['status'] === 429) {
            header('Retry-After: 60');
        }
        echo json_encode($result['body'], JSON_THROW_ON_ERROR);
    }
}
