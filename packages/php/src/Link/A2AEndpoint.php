<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

/** The A2A JSON-RPC endpoint (Phase 6E): POST one JSON-RPC request, get its JSON-RPC answer. Rate-limit it per client. */
final class A2AEndpoint
{
    public function __construct(private readonly LinkManager $manager) {}

    /**
     * @param  string  $version  The A2A-Version header, or the A2A-Version query parameter.
     * @return array{status: int, body: array<string, mixed>}
     */
    public function handle(string $method, string $contentType, string $body, string $version): array
    {
        $error = static fn (int $status, string $code, string $message): array => ['status' => $status, 'body' => ['error' => ['code' => $code, 'message' => $message]]];
        if ($method !== 'POST') {
            return $error(405, 'METHOD_NOT_ALLOWED', 'POST JSON-RPC.');
        }
        if (! str_starts_with(strtolower($contentType), 'application/json')) {
            return $error(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON.');
        }
        if (strlen($body) > Link::MAX_BODY_BYTES) {
            return $error(413, 'REQUEST_TOO_LARGE', 'The request is too large.');
        }
        try {
            return ['status' => 200, 'body' => A2A::answer($this->manager, $body, $version)];
        } catch (\Throwable) {
            return ['status' => 200, 'body' => ['jsonrpc' => '2.0', 'id' => null, 'error' => ['code' => -32603, 'message' => 'The request could not be handled.']]];
        }
    }
}
