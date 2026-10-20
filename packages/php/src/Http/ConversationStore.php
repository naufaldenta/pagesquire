<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

interface ConversationStore
{
    /**
     * Serialize operations for the trusted session key. Each save MUST be durable before returning.
     *
     * @param  callable(?array<string, mixed>, callable(array<string, mixed>): void): mixed  $operation
     */
    public function transaction(string $key, callable $operation): mixed;
}
