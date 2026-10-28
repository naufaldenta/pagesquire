<?php

declare(strict_types=1);

namespace PageSquire\Server;

/**
 * Stores verified trajectories keyed by instruction, page path and catalog.
 * Implementations decide scope (e.g. APCu or Redis per site); share one only
 * among visitors who may see the same site behaviour.
 */
interface TrajectoryCache
{
    /** @return array{steps: list<array{capabilityId: string, parameters: mixed}>, text: string}|null */
    public function get(string $key): ?array;

    /** @param array{steps: list<array{capabilityId: string, parameters: mixed}>, text: string} $value */
    public function set(string $key, array $value): void;

    public function delete(string $key): void;
}
