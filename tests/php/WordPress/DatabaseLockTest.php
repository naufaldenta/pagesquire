<?php

declare(strict_types=1);

namespace PageSquire\Tests\WordPress;

use PageSquire\WordPress\DatabaseLock;
use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PHPUnit\Framework\TestCase;

require_once __DIR__.'/../../../packages/wordpress/dist/pagesquire/autoload.php';

final class DatabaseLockTest extends TestCase
{
    public function test_lock_queries_are_prepared_no_overwrite_and_owner_bound(): void
    {
        $database = new LockDatabaseDouble;
        $lock = new DatabaseLock($database);
        $token = $lock->acquire('bounded-name');
        self::assertMatchesRegularExpression('/^[a-f0-9]{32}$/', $token);
        self::assertSame(['INSERT IGNORE INTO %i (option_name, option_value, autoload) VALUES (%s, %s, %s)', ['wp_options', 'bounded-name', $token, 'off']], $database->prepared[0]);
        $lock->release('bounded-name', $token);
        self::assertSame(['DELETE FROM %i WHERE option_name = %s AND option_value = %s', ['wp_options', 'bounded-name', $token]], $database->prepared[1]);
    }

    public function test_duplicate_insert_never_becomes_an_acquired_lock(): void
    {
        $database = new LockDatabaseDouble;
        $database->result = 0;
        try {
            (new DatabaseLock($database))->acquire('busy');
            self::fail('A duplicate lock was acquired.');
        } catch (AssistantException $error) {
            self::assertSame('BUSY', $error->errorCode);
            self::assertSame(409, $error->httpStatus);
        }
    }

    public function test_query_failure_and_wrong_owner_release_fail_closed(): void
    {
        $database = new LockDatabaseDouble;
        $database->result = false;
        try {
            (new DatabaseLock($database))->acquire('failed');
            self::fail('A failed query was accepted.');
        } catch (AssistantException $error) {
            self::assertSame('LOCK_UNAVAILABLE', $error->errorCode);
        }
        $database->result = 0;
        $this->expectException(AssistantException::class);
        (new DatabaseLock($database))->release('held', 'wrong-owner');
    }

    public function test_lock_existence_reads_database_not_option_cache_and_rejects_errors(): void
    {
        $database = new LockDatabaseDouble;
        $lock = new DatabaseLock($database);
        self::assertFalse($lock->held('missing'));
        $database->value = 'owner-token';
        self::assertTrue($lock->held('held'));
        self::assertStringStartsWith('SELECT option_value FROM %i WHERE option_name = %s', $database->prepared[1][0]);
        $database->last_error = 'synthetic database failure';
        $this->expectException(AssistantException::class);
        $lock->held('unavailable');
    }
}

final class LockDatabaseDouble
{
    public string $options = 'wp_options';

    public string $last_error = '';

    public int|false $result = 1;

    public ?string $value = null;

    public array $prepared = [];

    public function prepare(string $query, mixed ...$arguments): string
    {
        $this->prepared[] = [$query, $arguments];

        return $query;
    }

    public function query(string $query): int|false
    {
        return $this->result;
    }

    public function get_var(string $query): ?string
    {
        return $this->value;
    }
}
