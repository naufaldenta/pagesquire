<?php

return [
    'enabled' => env('PAGESQUIRE_ENABLED', false),
    'path' => 'pagesquire/chat',
    'middleware' => [],
    'cache_store' => env('PAGESQUIRE_CACHE_STORE'),
    'manifest' => ['schemaVersion' => '0.1', 'capabilities' => []],
    'provider' => [
        'name' => env('PAGESQUIRE_PROVIDER', 'custom'),
        'endpoint' => env('PAGESQUIRE_PROVIDER_URL', env('PAGESQUIRE_PROVIDER_ENDPOINT')),
        'key' => env('PAGESQUIRE_API_KEY', env('PAGESQUIRE_PROVIDER_KEY')),
        'model' => env('PAGESQUIRE_MODEL', env('PAGESQUIRE_PROVIDER_MODEL')),
        'response_mode' => env('PAGESQUIRE_RESPONSE_MODE'),
        'token_parameter' => env('PAGESQUIRE_TOKEN_PARAMETER'),
        'system_role' => env('PAGESQUIRE_SYSTEM_ROLE', 'system'),
        'thinking' => env('PAGESQUIRE_THINKING', 'default'),
        'timeout_seconds' => 20,
        'connect_timeout_seconds' => 5,
    ],
    'limits' => [
        'requests_per_minute' => 20,
        'max_body_bytes' => 196608,
        'max_steps' => 8,
        'max_attempts' => 12,
        'max_output_tokens' => 1000,
        'ttl_seconds' => 900,
    ],
];
