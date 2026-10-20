<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

use PageSquire\Server\AssistantException;

/** Single-host storage outside the web root; use a shared atomic store for multi-host deployments. */
final class FileConversationStore implements ConversationStore
{
    public function __construct(private readonly string $directory) {}

    public function transaction(string $key, callable $operation): mixed
    {
        $root = realpath($this->directory);
        if ($root === false || ! is_dir($root) || is_link($this->directory) || ! is_writable($root)) {
            throw new AssistantException('INVALID_STORE', 'Use an existing private real storage directory.', 500);
        }
        $file = $root.DIRECTORY_SEPARATOR.hash('sha256', $key).'.json';
        $lockPath = $file.'.lock';
        if (is_link($file) || is_link($lockPath)) {
            throw new AssistantException('INVALID_STORE', 'Invalid assistant storage.', 500);
        }
        $lock = fopen($lockPath, 'c+');
        if ($lock === false) {
            throw new AssistantException('INVALID_STORE', 'Assistant storage is unavailable.', 500);
        }
        chmod($lockPath, 0600);
        try {
            if (! flock($lock, LOCK_EX | LOCK_NB)) {
                throw new AssistantException('BUSY', 'Another assistant request is running.', 409);
            }
            $state = null;
            if (file_exists($file)) {
                if (! is_file($file) || filesize($file) > 2097152) {
                    throw new AssistantException('INVALID_STORE', 'Invalid assistant storage.', 500);
                }
                $raw = file_get_contents($file, false, null, 0, 2097153);
                if ($raw === false || strlen($raw) > 2097152) {
                    throw new AssistantException('INVALID_STORE', 'Invalid assistant storage.', 500);
                }
                try {
                    $state = self::restore(json_decode($raw, false, 64, JSON_THROW_ON_ERROR));
                } catch (\JsonException) {
                    throw new AssistantException('INVALID_STORE', 'Invalid assistant storage.', 500);
                }
            }
            $save = static function (array $value) use ($root, $file): void {
                $data = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE, 64);
                if (strlen($data) > 2097152) {
                    throw new AssistantException('INVALID_STORE', 'Assistant storage limit reached.', 500);
                }
                $temporary = tempnam($root, 'pagesquire-');
                if ($temporary === false) {
                    throw new AssistantException('INVALID_STORE', 'Assistant storage is unavailable.', 500);
                }
                try {
                    chmod($temporary, 0600);
                    $stream = fopen($temporary, 'wb');
                    try {
                        if (fwrite($stream, $data) !== strlen($data) || ! fflush($stream) || ! fsync($stream)) {
                            throw new AssistantException('INVALID_STORE', 'Assistant checkpoint failed.', 500);
                        }
                    } finally {
                        fclose($stream);
                    }
                    if (! rename($temporary, $file)) {
                        throw new AssistantException('INVALID_STORE', 'Assistant checkpoint failed.', 500);
                    }
                } finally {
                    if (file_exists($temporary)) {
                        unlink($temporary);
                    }
                }
            };

            return $operation($state, $save);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
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
