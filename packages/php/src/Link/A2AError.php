<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

/** A JSON-RPC error for an A2A request the site does not serve; $reason names it for clients. */
final class A2AError extends \RuntimeException
{
    public function __construct(public readonly int $rpcCode, public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
