<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

/** Fixture-only clock: never installed in the PageSquire plugin. */
if (defined('PAGESQUIRE_FIXTURE') && PAGESQUIRE_FIXTURE) {
    function time(): int
    {
        $frozen = \get_option('pagesquire_fixture_quota_time', false);

        return is_array($frozen) && is_int($frozen['now'] ?? null) ? $frozen['now'] : \time();
    }
}
