<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PageSquireWPVendor\PageSquire\Server\Link\LinkStore;

/** PageSquire Link state in one option that is never autoloaded, serialized by an option-name lock. */
final class OptionLinkStore implements LinkStore
{
    public const OPTION = 'pagesquire_links';

    public function transaction(callable $operation): mixed
    {
        global $wpdb;
        $locks = new DatabaseLock($wpdb);
        $token = $locks->acquire(self::OPTION.'_lock', 20);
        try {
            $data = ['links' => [], 'invitations' => [], 'nonces' => [], 'tickets' => []];
            $encoded = get_option(self::OPTION, null);
            if ($encoded !== null) {
                if (! is_string($encoded) || strlen($encoded) > 1048576) {
                    throw new AssistantException('INVALID_STORE', 'The link store is unreadable.', 500);
                }
                try {
                    $data = json_decode($encoded, true, 64, JSON_THROW_ON_ERROR) + $data;
                } catch (\JsonException) {
                    throw new AssistantException('INVALID_STORE', 'The link store is unreadable.', 500);
                }
            }
            $result = $operation($data);
            $next = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (strlen($next) > 1048576) {
                throw new AssistantException('STATE_LIMIT', 'The link store limit was reached.', 503);
            }
            if ($next !== $encoded && ! update_option(self::OPTION, $next, false) && get_option(self::OPTION, null) !== $next) {
                throw new AssistantException('INVALID_STORE', 'The link store could not be saved.', 500);
            }

            return $result;
        } finally {
            $locks->release(self::OPTION.'_lock', $token);
        }
    }
}
