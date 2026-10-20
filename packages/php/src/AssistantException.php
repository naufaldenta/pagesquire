<?php

declare(strict_types=1);

namespace PageSquire\Server;

use RuntimeException;

final class AssistantException extends RuntimeException
{
    public function __construct(public readonly string $errorCode, string $message, public readonly int $httpStatus = 422)
    {
        parent::__construct($message);
    }
}
