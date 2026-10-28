<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;

/**
 * Lock-free windowed counters in the options table. One conditional UPDATE
 * both checks and consumes, so concurrent visitors never collide on a lock.
 * Rows bypass the options cache and are written and read only through SQL.
 */
final class DatabaseCounter
{
    public const PREFIX = 'pagesquire_n_';

    public function __construct(private readonly object $database) {}

    /** Consumes one unit unless the window already reached its limit. */
    public function consume(string $kind, string $window, int $limit, string $subject = ''): bool
    {
        $name = self::name($kind, $window, $subject);
        $created = $this->database->query($this->database->prepare('INSERT IGNORE INTO %i (option_name, option_value, autoload) VALUES (%s, %s, %s)', $this->database->options, $name, '0', 'off'));
        if ($created === false) {
            throw new AssistantException('QUOTA_UNAVAILABLE', 'The assistant usage limit could not be checked.', 503);
        }
        if ($created === 1) {
            // The first request of a window removes earlier windows of the same kind.
            $this->database->query($this->database->prepare('DELETE FROM %i WHERE option_name LIKE %s AND option_name < %s', $this->database->options, $this->database->esc_like(self::PREFIX.$kind.'_').'%', self::PREFIX.$kind.'_'.$window));
        }
        $updated = $this->database->query($this->database->prepare('UPDATE %i SET option_value = option_value + 1 WHERE option_name = %s AND option_value + 0 < %d', $this->database->options, $name, $limit));
        if ($updated === false) {
            throw new AssistantException('QUOTA_UNAVAILABLE', 'The assistant usage limit could not be checked.', 503);
        }

        return $updated === 1;
    }

    public function value(string $kind, string $window, string $subject = ''): int
    {
        $value = $this->database->get_var($this->database->prepare('SELECT option_value FROM %i WHERE option_name = %s LIMIT 1', $this->database->options, self::name($kind, $window, $subject)));
        if ($this->database->last_error !== '') {
            throw new AssistantException('QUOTA_UNAVAILABLE', 'The assistant usage limit could not be checked.', 503);
        }

        return (int) $value;
    }

    /** Windows are fixed-width digits, so names sort chronologically within a kind. */
    private static function name(string $kind, string $window, string $subject): string
    {
        return self::PREFIX.$kind.'_'.$window.($subject === '' ? '' : '_'.substr($subject, 0, 32));
    }
}
