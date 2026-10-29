<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

use PageSquire\Server\AssistantException;

/** The partner endpoint: POST one JSON envelope, get the signed answer or an error. */
final class LinkEndpoint
{
    public function __construct(private readonly LinkManager $manager) {}

    /** @return array{status: int, body: array<string, mixed>} */
    public function handle(string $method, string $contentType, string $body): array
    {
        $error = static fn (int $status, string $code, string $message): array => ['status' => $status, 'body' => ['error' => ['code' => $code, 'message' => $message]]];
        if ($method !== 'POST') {
            return $error(405, 'METHOD_NOT_ALLOWED', 'POST a link message.');
        }
        if (! str_starts_with(strtolower($contentType), 'application/json')) {
            return $error(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON.');
        }
        if (strlen($body) > Link::MAX_BODY_BYTES) {
            return $error(413, 'REQUEST_TOO_LARGE', 'The link message is too large.');
        }
        try {
            $envelope = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $error(400, 'LINK_INVALID', 'The link message is not JSON.');
        }
        try {
            return ['status' => 200, 'body' => $this->manager->receive($envelope)];
        } catch (AssistantException $exception) {
            return $error($exception->httpStatus, $exception->errorCode, $exception->getMessage());
        }
    }
}
