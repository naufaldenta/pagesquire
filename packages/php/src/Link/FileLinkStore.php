<?php

declare(strict_types=1);

namespace PageSquire\Server\Link;

use PageSquire\Server\AssistantException;

/**
 * One JSON file outside the web root, locked and replaced atomically. For a
 * single host; use a shared store with real locking for several hosts.
 */
final class FileLinkStore implements LinkStore
{
    public function __construct(private readonly string $path) {}

    public function transaction(callable $operation): mixed
    {
        $directory = dirname($this->path);
        if (! is_dir($directory) || ! is_writable($directory) || is_link($this->path)) {
            throw new AssistantException('INVALID_STORE', 'Use a private, writable directory for the link store.', 500);
        }
        $lock = fopen($this->path.'.lock', 'c+');
        if ($lock === false) {
            throw new AssistantException('INVALID_STORE', 'The link store is unavailable.', 500);
        }
        try {
            if (! flock($lock, LOCK_EX)) {
                throw new AssistantException('INVALID_STORE', 'The link store is unavailable.', 500);
            }
            $data = ['links' => [], 'invitations' => [], 'nonces' => [], 'tickets' => [], 'returns' => []];
            if (is_file($this->path)) {
                $raw = file_get_contents($this->path, false, null, 0, 2000001);
                if ($raw === false || strlen($raw) > 2000000) {
                    throw new AssistantException('INVALID_STORE', 'The link store is unreadable.', 500);
                }
                try {
                    $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR) + $data;
                } catch (\JsonException) {
                    throw new AssistantException('INVALID_STORE', 'The link store is unreadable.', 500);
                }
            }
            $result = $operation($data);
            $temporary = tempnam($directory, 'pagesquire-links-');
            if ($temporary === false) {
                throw new AssistantException('INVALID_STORE', 'The link store is unavailable.', 500);
            }
            chmod($temporary, 0600);
            file_put_contents($temporary, json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            if (! rename($temporary, $this->path)) {
                @unlink($temporary);
                throw new AssistantException('INVALID_STORE', 'The link store could not be saved.', 500);
            }

            return $result;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}
