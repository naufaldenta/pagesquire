<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

/** Process memory only: for tests and single-request demos. */
final class MemoryLinkStore implements LinkStore
{
    /** @var array<string, mixed> */
    private array $data = ['links' => [], 'invitations' => [], 'nonces' => [], 'tickets' => []];

    public function transaction(callable $operation): mixed
    {
        $working = $this->data;
        $result = $operation($working);
        $this->data = $working;

        return $result;
    }
}
