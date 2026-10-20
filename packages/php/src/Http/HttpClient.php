<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

interface HttpClient
{
    /** @param list<string> $headers */
    public function post(string $url, array $headers, string $body, int $timeoutSeconds, int $maxBytes): string;
}
