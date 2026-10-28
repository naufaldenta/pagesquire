<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;

/** Unique option-name inserts must never use add_option's duplicate-key overwrite. */
final class DatabaseLock
{
    public function __construct(private readonly object $database) {}

    public function acquire(string $name, int $attempts = 1): string
    {
        $token = bin2hex(random_bytes(16));
        for ($attempt = 1; ; $attempt++) {
            $result = $this->database->query($this->database->prepare('INSERT IGNORE INTO %i (option_name, option_value, autoload) VALUES (%s, %s, %s)', $this->database->options, $name, $token, 'off'));
            if ($result === false) {
                throw new AssistantException('LOCK_UNAVAILABLE', 'The assistant lock could not be acquired.', 503);
            }
            if ($result === 1) {
                return $token;
            }
            if ($attempt >= min(max($attempts, 1), 20)) {
                throw new AssistantException('BUSY', 'Another assistant request is running.', 409);
            }
            // A short jittered wait; a stranded lock still fails closed after the bounded attempts.
            usleep(random_int(10_000, 30_000));
        }
    }

    public function held(string $name): bool
    {
        $value = $this->database->get_var($this->database->prepare('SELECT option_value FROM %i WHERE option_name = %s LIMIT 1', $this->database->options, $name));
        if ($this->database->last_error !== '') {
            throw new AssistantException('LOCK_UNAVAILABLE', 'The assistant lock could not be checked.', 503);
        }

        return $value !== null;
    }

    public function release(string $name, string $token): void
    {
        $deleted = $this->database->query($this->database->prepare('DELETE FROM %i WHERE option_name = %s AND option_value = %s', $this->database->options, $name, $token));
        if ($deleted !== 1) {
            throw new AssistantException('LOCK_RELEASE_FAILED', 'The assistant lock could not be released safely.', 503);
        }
    }
}
