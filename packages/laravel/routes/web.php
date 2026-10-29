<?php

use Illuminate\Support\Facades\Route;
use PageSquire\Laravel\Http\Controllers\A2AController;
use PageSquire\Laravel\Http\Controllers\ChatController;
use PageSquire\Laravel\Http\Controllers\LinkController;
use PageSquire\Laravel\Http\Controllers\SiteDeclarationController;
use PageSquire\Laravel\Http\Middleware\GuardAssistantRequest;

Route::post(config('pagesquire.path'), ChatController::class)
    ->middleware(array_merge(['web', GuardAssistantRequest::class, 'throttle:pagesquire'], config('pagesquire.middleware', [])))
    ->name('pagesquire.chat')
    ->block(max(10, min(65, (int) config('pagesquire.provider.timeout_seconds') + 5)), 5);

// The companion extension and Link partners read the site's public key here; only with signing configured.
if (config('pagesquire.companion.signing_key')) {
    Route::get('.well-known/pagesquire.json', SiteDeclarationController::class)->name('pagesquire.declaration');

    // Server-to-server PageSquire Link messages: signed envelopes, no session or CSRF.
    if (config('pagesquire.link.enabled')) {
        Route::post(config('pagesquire.link.path', 'pagesquire/link'), LinkController::class)
            ->middleware('throttle:pagesquire-link')
            ->name('pagesquire.link');

        // The optional A2A interface: a signed Agent Card and a JSON-RPC endpoint for any A2A agent.
        if (config('pagesquire.link.a2a.enabled')) {
            Route::get('.well-known/agent-card.json', [A2AController::class, 'card'])->name('pagesquire.a2a.card');
            Route::get('.well-known/pagesquire-keys.json', [A2AController::class, 'keys'])->name('pagesquire.a2a.keys');
            Route::post(config('pagesquire.link.a2a.path', 'pagesquire/a2a'), A2AController::class)
                ->middleware('throttle:pagesquire-a2a')
                ->name('pagesquire.a2a');
        }
    }
}
