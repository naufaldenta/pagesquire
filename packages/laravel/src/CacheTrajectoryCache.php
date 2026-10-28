<?php

namespace PageSquire\Laravel;

use Illuminate\Contracts\Cache\Repository;
use PageSquire\Server\TrajectoryCache;

/** Verified trajectories in the application's cache store, shared by all visitors of this site. */
final class CacheTrajectoryCache implements TrajectoryCache
{
    public function __construct(private readonly Repository $store, private readonly int $ttlSeconds = 86400) {}

    public function get(string $key): ?array
    {
        $value = $this->store->get(self::key($key));

        return is_array($value) && is_array($value['steps'] ?? null) && is_string($value['text'] ?? null) ? $value : null;
    }

    public function set(string $key, array $value): void
    {
        $this->store->put(self::key($key), json_decode(json_encode($value, JSON_THROW_ON_ERROR), true), $this->ttlSeconds);
    }

    public function delete(string $key): void
    {
        $this->store->forget(self::key($key));
    }

    private static function key(string $key): string
    {
        return 'pagesquire.trajectory:'.$key;
    }
}
