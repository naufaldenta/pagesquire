<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

use RuntimeException;

/** A provider transport failure with diagnostic metadata only, never a response body. */
final class ProviderHttpException extends RuntimeException
{
    /** @param 'http_error'|'network_error'|'timeout' $outcome */
    public function __construct(public readonly string $outcome, public readonly ?int $status = null)
    {
        parent::__construct('The assistant provider is unavailable.');
    }
}
