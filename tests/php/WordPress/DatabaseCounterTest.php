<?php

declare(strict_types=1);

namespace PageSquire\Tests\WordPress;

use PageSquire\WordPress\DatabaseCounter;
use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PDO;
use PHPUnit\Framework\TestCase;

require_once __DIR__.'/../../../packages/wordpress/dist/pagesquire/autoload.php';

final class DatabaseCounterTest extends TestCase
{
    public function test_consume_is_bounded_per_window_and_subject_without_locks(): void
    {
        $database = new SqliteOptionsDouble;
        $counter = new DatabaseCounter($database);
        for ($index = 0; $index < 3; $index++) {
            self::assertTrue($counter->consume('ip', '0000000001', 3, 'visitor-a'));
        }
        self::assertFalse($counter->consume('ip', '0000000001', 3, 'visitor-a'));
        self::assertTrue($counter->consume('ip', '0000000001', 3, 'visitor-b'));
        self::assertSame(3, $counter->value('ip', '0000000001', 'visitor-a'));
        self::assertSame(1, $counter->value('ip', '0000000001', 'visitor-b'));
        self::assertTrue($counter->consume('site', '0000000001', 1));
        self::assertFalse($counter->consume('site', '0000000001', 1));
        self::assertSame(0, $counter->value('provider', '20261025'));
        self::assertStringNotContainsString('_lock', implode(' ', $database->names()));
    }

    public function test_a_new_window_removes_only_earlier_windows_of_the_same_kind(): void
    {
        $database = new SqliteOptionsDouble;
        $database->pdo->exec("INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('pagesquire_settings', 'keep', 'on'), ('pagesquire_nx_ip_0000000001', 'keep', 'off')");
        $counter = new DatabaseCounter($database);
        $counter->consume('ip', '0000000001', 30, 'visitor-a');
        $counter->consume('site', '0000000001', 60);
        $counter->consume('ip', '0000000002', 30, 'visitor-b');
        self::assertSame(['pagesquire_n_ip_0000000002_visitor-b', 'pagesquire_n_site_0000000001', 'pagesquire_nx_ip_0000000001', 'pagesquire_settings'], $database->names());
        self::assertTrue($counter->consume('ip', '0000000002', 30, 'visitor-a'));
    }

    public function test_query_failures_fail_closed(): void
    {
        $database = new SqliteOptionsDouble;
        $database->failing = true;
        try {
            (new DatabaseCounter($database))->consume('site', '0000000001', 60);
            self::fail('A failed counter query was accepted.');
        } catch (AssistantException $error) {
            self::assertSame('QUOTA_UNAVAILABLE', $error->errorCode);
            self::assertSame(503, $error->httpStatus);
        }
        $database->failing = false;
        $database->last_error = 'synthetic database failure';
        $this->expectException(AssistantException::class);
        (new DatabaseCounter($database))->value('site', '0000000001');
    }
}

/** A minimal wpdb stand-in over SQLite that runs the counter's real SQL. */
final class SqliteOptionsDouble
{
    public string $options = 'wp_options';

    public string $last_error = '';

    public bool $failing = false;

    public PDO $pdo;

    public function __construct()
    {
        $this->pdo = new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->pdo->exec('CREATE TABLE wp_options (option_id INTEGER PRIMARY KEY, option_name TEXT NOT NULL UNIQUE, option_value TEXT NOT NULL, autoload TEXT NOT NULL)');
    }

    public function prepare(string $query, mixed ...$arguments): string
    {
        return (string) preg_replace_callback('/%[isd]/', function (array $match) use (&$arguments): string {
            $value = array_shift($arguments);

            return match ($match[0]) {
                '%i' => '"'.$value.'"',
                '%d' => (string) (int) $value,
                default => $this->pdo->quote((string) $value),
            };
        }, $query);
    }

    public function esc_like(string $text): string
    {
        return addcslashes($text, '_%\\');
    }

    public function query(string $sql): int|false
    {
        if ($this->failing) {
            return false;
        }
        $sql = str_replace('INSERT IGNORE', 'INSERT OR IGNORE', $sql);
        $sql = (string) preg_replace("/(LIKE '[^']*')/", "$1 ESCAPE '\\\\'", $sql);

        return $this->pdo->exec($sql);
    }

    public function get_var(string $sql): ?string
    {
        $value = $this->pdo->query($sql)->fetchColumn();

        return $value === false ? null : (string) $value;
    }

    /** @return list<string> */
    public function names(): array
    {
        return $this->pdo->query('SELECT option_name FROM wp_options ORDER BY option_name')->fetchAll(PDO::FETCH_COLUMN);
    }
}
