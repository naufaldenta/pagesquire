<?php

namespace PageSquire\Laravel;

use Illuminate\Contracts\Auth\Access\Gate;
use Illuminate\Contracts\Cache\Factory;
use Illuminate\Contracts\Config\Repository;
use Illuminate\Http\Request;
use PageSquire\Server\AssistantException;
use PageSquire\Server\ConversationEngine;

final class HandleChat
{
    public const SESSION_KEY = 'pagesquire.conversation';

    public function __construct(
        private readonly ConversationEngine $engine,
        private readonly CapabilityCatalog $catalog,
        private readonly Gate $gate,
        private readonly Factory $cache,
        private readonly Repository $config,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @param  (callable(string): void)|null  $onProgress  fixed server stages for a streamed response
     * @return array<string, mixed>
     */
    public function handle(Request $request, array $input, ?callable $onProgress = null): array
    {
        $user = $request->user();
        $principal = $user === null ? 'guest' : hash('sha256', get_class($user).':'.(string) $user->getAuthIdentifier());
        $store = $this->cache->store($this->config->get('pagesquire.cache_store'));
        $key = self::cacheKey($request->session()->getId());
        $stored = $store->get($key);
        $continuing = isset($input['conversationId']);
        $state = is_array($stored) && ($stored['principal'] ?? null) === $principal && is_array($stored['engine'] ?? null) ? $stored['engine'] : null;

        if ($continuing && $state === null) {
            throw new AssistantException('CONVERSATION_NOT_FOUND', 'The conversation is unavailable.', 404);
        }

        $allowedIds = [];

        foreach ($this->catalog->manifest()['capabilities'] as $capability) {
            if (($capability['risk'] !== 'consequential' || (bool) $this->config->get('pagesquire.allow_consequential', false)) && $this->gate->allows('pagesquire.capability', $capability['id'])) {
                $allowedIds[] = $capability['id'];
            }
        }

        $checkpoint = function (array $state) use ($store, $key, $principal): void {
            if (! $store->put($key, ['principal' => $principal, 'engine' => $state], max(1, $state['expiresAt'] - time()))) {
                throw new AssistantException('STATE_STORAGE_UNAVAILABLE', 'The conversation could not be saved.', 503);
            }
        };
        if ($onProgress !== null) {
            $onProgress('accepted');
        }
        $outcome = $this->engine->handle($input, $state, $allowedIds, $checkpoint, $onProgress);
        $checkpoint($outcome['state']);

        return $outcome['reply'];
    }

    public static function cacheKey(string $sessionId): string
    {
        return self::SESSION_KEY.':'.hash('sha256', $sessionId);
    }
}
