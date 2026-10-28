<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PageSquireWPVendor\PageSquire\Server\Http\ConversationStore;

/** Atomic option-name locks serialize durable database checkpoints without using public filesystem storage. */
final class OptionsStore implements ConversationStore
{
    public static function name(string $key): string
    {
        return 'pagesquire_state_'.hash('sha256', $key);
    }

    /** @param int $attempts Short bounded retries for shared site records; conversations keep 1 (immediate BUSY). */
    public function transaction(string $key, callable $operation, int $attempts = 1): mixed
    {
        global $wpdb;
        $name = self::name($key);
        $lock = $name.'_lock';
        $locks = new DatabaseLock($wpdb);
        $token = $locks->acquire($lock, $attempts);
        try {
            $encoded = get_option($name, null);
            $state = $encoded === null ? null : self::decode($encoded);
            $save = static function (array $value) use ($name): void {
                $encoded = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE, 64);
                if (strlen($encoded) > 1048576) {
                    throw new AssistantException('STATE_LIMIT', 'The assistant storage limit was reached.', 503);
                }
                if (! update_option($name, $encoded, false) && get_option($name, null) !== $encoded) {
                    throw new AssistantException('CHECKPOINT_FAILED', 'The assistant checkpoint could not be saved.', 503);
                }
            };

            return $operation($state, $save);
        } finally {
            $locks->release($lock, $token);
        }
    }

    public static function locked(string $key): bool
    {
        global $wpdb;

        return (new DatabaseLock($wpdb))->held(self::name($key).'_lock');
    }

    private static function decode(mixed $encoded): array
    {
        if (! is_string($encoded) || strlen($encoded) > 1048576) {
            throw new AssistantException('INVALID_STORE', 'The assistant state is invalid.', 503);
        }
        try {
            $raw = json_decode($encoded, false, 64, JSON_THROW_ON_ERROR);
            $restored = self::restore($raw);
            if (! is_array($restored)) {
                throw new \RuntimeException;
            }

            return $restored;
        } catch (\Throwable) {
            throw new AssistantException('INVALID_STORE', 'The assistant state is invalid.', 503);
        }
    }

    private static function restore(mixed $value, ?string $key = null): mixed
    {
        if (in_array($key, ['parameters', 'evidence'], true)) {
            return $value;
        }
        if ($value instanceof \stdClass) {
            $value = get_object_vars($value);
        }
        if (is_array($value)) {
            foreach ($value as $name => $item) {
                $value[$name] = self::restore($item, (string) $name);
            }
        }

        return $value;
    }
}
