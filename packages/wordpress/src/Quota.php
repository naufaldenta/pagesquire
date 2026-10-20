<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;

final class Quota
{
    public function __construct(private readonly OptionsStore $store) {}

    public function request(string $ipHash, ?string $sessionKey = null, ?int $expiresAt = null): void
    {
        $this->store->transaction('site-request-budget', static function (?array $state, callable $save) use ($ipHash, $sessionKey, $expiresAt): void {
            $now = time();
            $state ??= ['minute' => intdiv($now, 60), 'count' => 0, 'ips' => [], 'sessions' => []];
            if ($state['minute'] !== intdiv($now, 60)) {
                $state['minute'] = intdiv($now, 60);
                $state['count'] = 0;
                $state['ips'] = [];
            }
            foreach ($state['sessions'] as $key => $expiry) {
                if ($expiry + 120 < $now && ! OptionsStore::locked($key)) {
                    delete_option(OptionsStore::name($key));
                    unset($state['sessions'][$key]);
                }
            }
            if ($state['count'] >= 60 || ($state['ips'][$ipHash] ?? 0) >= 30 || count($state['sessions']) >= 1000 && $sessionKey !== null && ! isset($state['sessions'][$sessionKey])) {
                throw new AssistantException('RATE_LIMITED', 'The site assistant request limit was reached. Try again later.', 429);
            }
            $state['count']++;
            $state['ips'][$ipHash] = ($state['ips'][$ipHash] ?? 0) + 1;
            if ($sessionKey !== null && $expiresAt !== null) {
                $state['sessions'][$sessionKey] = $expiresAt;
            }
            $save($state);
        });
    }

    public function provider(int $maximum): void
    {
        $this->store->transaction('site-provider-budget', static function (?array $state, callable $save) use ($maximum): void {
            $day = gmdate('Y-m-d');
            $state = ($state['day'] ?? null) === $day ? $state : ['day' => $day, 'attempts' => 0];
            if ($state['attempts'] >= $maximum) {
                throw new AssistantException('PROVIDER_BUDGET', 'The site provider attempt budget was reached.', 429);
            }
            $state['attempts']++;
            $save($state);
        });
    }
}
