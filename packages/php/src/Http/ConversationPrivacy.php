<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

use PageSquire\Server\AssistantException;

/** Host-authorized transcript erasure; this is not a public endpoint or a quota reset. */
final class ConversationPrivacy
{
    public static function forget(ConversationStore $store, string $key, string $principal): bool
    {
        if ($key === '' || strlen($key) > 2048 || $principal === '' || strlen($principal) > 2048) {
            throw new AssistantException('INVALID_SESSION', 'Use a trusted session key and principal.');
        }

        return $store->transaction($key, static function (?array $stored, callable $save) use ($principal): bool {
            if ($stored === null) {
                return false;
            }
            if (($stored['principal'] ?? null) !== $principal) {
                throw new AssistantException('ACCESS_DENIED', 'This conversation is not authorized.', 403);
            }
            $rate = $stored['rate'] ?? null;
            if (! is_array($rate) || ! is_int($rate['since'] ?? null) || $rate['since'] < 0 || ! is_int($rate['count'] ?? null) || $rate['count'] < 0 || ! array_key_exists('state', $stored)) {
                throw new AssistantException('INVALID_STORE', 'Assistant storage requires operator review.', 500);
            }
            if ($stored['state'] === null) {
                return false;
            }
            $stored['state'] = null;
            $save($stored);

            return true;
        });
    }
}
