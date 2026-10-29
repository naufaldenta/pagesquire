<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

/** Network access to partner sites: GET a declaration, POST an envelope. */
interface LinkTransport
{
    /**
     * Returns the response body whatever the HTTP status (partners answer
     * errors as JSON); throws when the partner cannot be reached.
     */
    public function request(string $method, string $url, ?string $body): string;
}
