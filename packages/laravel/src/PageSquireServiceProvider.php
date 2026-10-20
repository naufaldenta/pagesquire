<?php

namespace PageSquire\Laravel;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;

final class PageSquireServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/pagesquire.php', 'pagesquire');
        $this->app->singleton(ProtocolValidator::class);
        $this->app->singleton(CapabilityCatalog::class);
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
            );
        });
    }

    public function boot(): void
    {
        $this->publishes([__DIR__.'/../config/pagesquire.php' => config_path('pagesquire.php')], 'pagesquire-config');

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
        $this->loadRoutesFrom(__DIR__.'/../routes/web.php');
    }
}
