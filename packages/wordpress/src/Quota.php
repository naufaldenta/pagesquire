<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;

final class Quota
{
    private readonly DatabaseCounter $counter;

    public function __construct(private readonly OptionsStore $store, ?DatabaseCounter $counter = null)
    {
        global $wpdb;
        $this->counter = $counter ?? new DatabaseCounter($wpdb);
    }

    public function request(string $ipHash, ?string $sessionKey = null, ?int $expiresAt = null): void
    {
        $minute = self::minute();
        // The IP bucket is checked first so an exhausted IP cannot spend the site-wide bucket.
        if (! $this->counter->consume('ip', $minute, 30, $ipHash) || ! $this->counter->consume('site', $minute, 60)) {
            throw new AssistantException('RATE_LIMITED', 'The site assistant request limit was reached. Try again later.', 429);
        }
        if ($sessionKey === null || $expiresAt === null) {
            return;
        }
        // Only session issuance still needs the serialized registry, for its cap and cleanup.
        $this->store->transaction('site-request-budget', static function (?array $state, callable $save) use ($sessionKey, $expiresAt): void {
            $now = time();
            $sessions = $state['sessions'] ?? [];
            foreach ($sessions as $key => $expiry) {
                if ($expiry + 120 < $now && ! OptionsStore::locked($key)) {
                    delete_option(OptionsStore::name($key));
                    unset($sessions[$key]);
                }
            }
            if (count($sessions) >= 1000 && ! isset($sessions[$sessionKey])) {
                throw new AssistantException('RATE_LIMITED', 'The site assistant request limit was reached. Try again later.', 429);
            }
            $sessions[$sessionKey] = $expiresAt;
            $save(['sessions' => $sessions]);
        }, 10);
    }

    /** PageSquire Link messages from partner servers, per IP and minute. */
    public function link(string $ipHash): void
    {
        if (! $this->counter->consume('link', self::minute(), 60, $ipHash)) {
            throw new AssistantException('RATE_LIMITED', 'Too many link messages. Try again later.', 429);
        }
    }

    public function provider(int $maximum): void
    {
        if (! $this->counter->consume('provider', self::day(), $maximum)) {
            throw new AssistantException('PROVIDER_BUDGET', 'The site provider attempt budget was reached.', 429);
        }
    }

    /** Lets a request fail fast with 429 before any conversation work when today's budget is spent. */
    public function providerExhausted(int $maximum): bool
    {
        return $this->counter->value('provider', self::day()) >= $maximum;
    }

    public function providerAttempts(): int
    {
        return $this->counter->value('provider', self::day());
    }

    private static function minute(): string
    {
        return str_pad((string) intdiv(time(), 60), 10, '0', STR_PAD_LEFT);
    }

    private static function day(): string
    {
        return gmdate('Ymd', time());
    }
}
