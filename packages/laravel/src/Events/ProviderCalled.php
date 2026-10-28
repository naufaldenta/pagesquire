<?php

namespace PageSquire\Laravel\Events;

/**
 * Dispatched after every provider call with metadata only:
 * outcome, optional HTTP status, latencyMs and optional token usage.
 * It never carries prompts, completions, headers or keys.
 */
final class ProviderCalled
{
    /** @param array{outcome: string, status?: int, latencyMs: int, usage?: array<string, int>} $diagnostic */
    public function __construct(public readonly array $diagnostic) {}
}
