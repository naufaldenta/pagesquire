<?php

use Illuminate\Support\Facades\Route;
use PageSquire\Laravel\Http\Controllers\ChatController;
use PageSquire\Laravel\Http\Controllers\SiteDeclarationController;
use PageSquire\Laravel\Http\Middleware\GuardAssistantRequest;

Route::post(config('pagesquire.path'), ChatController::class)
    ->middleware(array_merge(['web', GuardAssistantRequest::class, 'throttle:pagesquire'], config('pagesquire.middleware', [])))
    ->name('pagesquire.chat')
    ->block(max(10, min(65, (int) config('pagesquire.provider.timeout_seconds') + 5)), 5);

// The companion extension reads the site's public key here; only with signing configured.
if (config('pagesquire.companion.signing_key')) {
    Route::get('.well-known/pagesquire.json', SiteDeclarationController::class)->name('pagesquire.declaration');
}
