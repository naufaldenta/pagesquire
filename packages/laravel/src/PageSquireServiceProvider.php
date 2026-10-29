<?php

namespace PageSquire\Laravel;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use PageSquire\Server\ActionSigner;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\Link\CurlLinkTransport;
use PageSquire\Server\Link\FileLinkStore;
use PageSquire\Server\Link\LinkManager;
use PageSquire\Server\Link\LinkStore;
use PageSquire\Server\Link\LinkTransport;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;

final class PageSquireServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/pagesquire.php', 'pagesquire');
        $this->app->singleton(ProtocolValidator::class);
        $this->app->singleton(CapabilityCatalog::class);
        $this->app->singleton(ActionSigner::class, function ($app): ActionSigner {
            $config = $app['config'];

            return new ActionSigner(
                (string) $config->get('pagesquire.companion.signing_key'),
                (string) ($config->get('pagesquire.companion.origin') ?: ActionSigner::origin((string) $config->get('app.url'))),
            );
        });
        $this->app->singleton(LinkStore::class, fn ($app): LinkStore => new FileLinkStore(
            (string) ($app['config']->get('pagesquire.link.store') ?: storage_path('app/pagesquire-links.json')),
        ));
        $this->app->bind(LinkTransport::class, CurlLinkTransport::class);
        $this->app->singleton(LinkManager::class, function ($app): LinkManager {
            $config = $app['config'];

            return new LinkManager(
                $app->make(ActionSigner::class),
                $app->make(LinkStore::class),
                [
                    'endpoint' => '/'.ltrim((string) $config->get('pagesquire.link.path', 'pagesquire/link'), '/'),
                    'name' => (string) ($config->get('pagesquire.link.name') ?: $config->get('app.name', 'PageSquire site')),
                    'skills' => (array) $config->get('pagesquire.link.skills', []),
                ],
                $app->make(LinkTransport::class),
            );
        });
        $this->app->bind(Provider::class, function ($app): Provider {
            $config = $app['config']->get('pagesquire.provider');

            return new OpenAiCompatibleProvider(
                $app->make(Factory::class),
                $app->make(ProtocolValidator::class),
                $config['endpoint'],
                $config['key'],
                $config['model'],
                $config['timeout_seconds'],
                $config['connect_timeout_seconds'],
                array_filter([
                    'provider' => $config['name'] ?? 'custom',
                    'responseMode' => $config['response_mode'] ?? null,
                    'tokenParameter' => $config['token_parameter'] ?? null,
                    'systemRole' => $config['system_role'] ?? null,
                    'thinking' => $config['thinking'] ?? null,
                ], static fn (mixed $value): bool => $value !== null && $value !== ''),
                $app->make(Dispatcher::class),
            );
        });
        $this->app->bind(ConversationEngine::class, function ($app): ConversationEngine {
            $limits = $app['config']->get('pagesquire.limits');

            return new ConversationEngine(
                $app->make(Provider::class),
                $app->make(ProtocolValidator::class),
                $app->make(CapabilityCatalog::class)->manifest(),
                $limits['max_steps'],
                $limits['max_attempts'],
                $limits['max_output_tokens'],
                $limits['ttl_seconds'],
                (bool) $app['config']->get('pagesquire.allow_consequential', false),
                (int) ($limits['max_recoveries'] ?? 0),
                (bool) ($limits['validate_completion'] ?? false),
                $app['config']->get('pagesquire.trajectory_cache.enabled')
                    ? new CacheTrajectoryCache(
                        $app->make(CacheFactory::class)->store($app['config']->get('pagesquire.trajectory_cache.store')),
                        (int) $app['config']->get('pagesquire.trajectory_cache.ttl_seconds', 86400),
                    )
                    : null,
                (string) $app['config']->get('pagesquire.locale', 'en'),
                (bool) ($limits['plan'] ?? false),
                (bool) ($limits['check_actions'] ?? false),
                $app['config']->get('pagesquire.companion.signing_key') ? $app->make(ActionSigner::class) : null,
                (bool) $app['config']->get('pagesquire.companion.screenshots', false),
                $app['config']->get('pagesquire.link.enabled') && $app['config']->get('pagesquire.companion.signing_key') ? $app->make(LinkManager::class) : null,
            );
        });
    }

    public function boot(): void
    {
        $this->publishes([__DIR__.'/../config/pagesquire.php' => config_path('pagesquire.php')], 'pagesquire-config');
        if ($this->app->runningInConsole()) {
            $this->commands([
                Console\LinkInviteCommand::class,
                Console\LinkAcceptCommand::class,
                Console\LinkListCommand::class,
                Console\LinkApproveCommand::class,
                Console\LinkRevokeCommand::class,
            ]);
        }

        if (! $this->app['config']->get('pagesquire.enabled')) {
            return;
        }

        RateLimiter::for('pagesquire', function (Request $request): array {
            $limit = max(1, min(120, (int) config('pagesquire.limits.requests_per_minute')));

            return [
                Limit::perMinute($limit)->by('session:'.hash('sha256', $request->session()->getId()))
                    ->response(fn (): mixed => response()->json(['error' => ['code' => 'RATE_LIMITED', 'message' => 'Please wait before sending another message.']], 429)->header('Cache-Control', 'no-store')),
                Limit::perMinute($limit * 3)->by('ip:'.hash('sha256', (string) $request->ip()))
                    ->response(fn (): mixed => response()->json(['error' => ['code' => 'RATE_LIMITED', 'message' => 'Please wait before sending another message.']], 429)->header('Cache-Control', 'no-store')),
            ];
        });
        // Partner servers call the link endpoint: no session, so limit by address.
        RateLimiter::for('pagesquire-link', fn (Request $request): Limit => Limit::perMinute(max(1, min(600, (int) config('pagesquire.link.requests_per_minute', 60))))
            ->by('ip:'.hash('sha256', (string) $request->ip()))
            ->response(fn (): mixed => response()->json(['error' => ['code' => 'RATE_LIMITED', 'message' => 'Too many link messages.']], 429)->header('Cache-Control', 'no-store')));
        $this->loadRoutesFrom(__DIR__.'/../routes/web.php');
    }
}
