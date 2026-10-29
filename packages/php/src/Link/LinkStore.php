<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

/**
 * Durable storage for one site's links. Operations run one at a time and
 * receive the whole state by reference:
 * ['links' => [id => record], 'invitations' => [id => invitation], 'nonces' => [key => exp],
 * 'tickets' => [code hash => ticket], 'returns' => [return id => handoff this site may get back from]]].
 */
interface LinkStore
{
    /**
     * @template T
     *
     * @param  callable(array<string, mixed>&): T  $operation
     * @return T
     */
    public function transaction(callable $operation): mixed;
}
