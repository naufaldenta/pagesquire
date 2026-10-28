<?php

declare(strict_types=1);

namespace PageSquire\Server;

/** A bounded least-recently-used cache for one PHP process (tests, workers). */
final class MemoryTrajectoryCache implements TrajectoryCache
{
    /** @var array<string, array{steps: list<array{capabilityId: string, parameters: mixed}>, text: string}> */
    private array $entries = [];

    public function __construct(private readonly int $limit = 500) {}

    public function get(string $key): ?array
    {
        if (! isset($this->entries[$key])) {
            return null;
        }
        $value = $this->entries[$key];
        unset($this->entries[$key]);
        $this->entries[$key] = $value;

        return $value;
    }

    public function set(string $key, array $value): void
    {
        unset($this->entries[$key]);
        $this->entries[$key] = $value;
        while (count($this->entries) > $this->limit) {
            unset($this->entries[array_key_first($this->entries)]);
        }
    }

    public function delete(string $key): void
    {
        unset($this->entries[$key]);
    }
}
