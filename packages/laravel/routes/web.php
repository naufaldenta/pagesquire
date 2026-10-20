<?php

use Illuminate\Support\Facades\Route;
use PageSquire\Laravel\Http\Controllers\ChatController;
use PageSquire\Laravel\Http\Middleware\GuardAssistantRequest;

Route::post(config('pagesquire.path'), ChatController::class)
    ->middleware(array_merge(['web', GuardAssistantRequest::class, 'throttle:pagesquire'], config('pagesquire.middleware', [])))
    ->name('pagesquire.chat')
    ->block(max(10, min(65, (int) config('pagesquire.provider.timeout_seconds') + 5)), 5);
