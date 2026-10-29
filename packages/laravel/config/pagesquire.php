<?php

return [
    'enabled' => env('PAGESQUIRE_ENABLED', false),
    // Language of the engine's fixed replies: 'en' or 'id'.
    'locale' => env('PAGESQUIRE_LOCALE', 'en'),
    'path' => 'pagesquire/chat',
    'middleware' => [],
    'cache_store' => env('PAGESQUIRE_CACHE_STORE'),
    'manifest' => ['schemaVersion' => '0.1', 'capabilities' => []],
    // Offer consequential capabilities that pass the pagesquire.capability gate.
    // The browser runtime still needs an approval prompt and a person's approval per call.
    'allow_consequential' => env('PAGESQUIRE_ALLOW_CONSEQUENTIAL', false),
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
        // Failed or unverified actions per conversation the model may recover from (0-5).
        'max_recoveries' => 0,
        // Ask the provider once more, as a strict reviewer, after acted turns (one extra attempt).
        'validate_completion' => false,
        // Ask the provider once per visitor message for a short plan shown with the first action (one extra attempt).
        'plan' => false,
        // Review each page-changing action against the visitor's request before it runs (one extra attempt per action).
        'check_actions' => false,
    ],
    // Companion extension: sign every action call and serve /.well-known/pagesquire.json.
    'companion' => [
        // Base64 of a 32-byte Ed25519 seed (npx pagesquire signing-key). Empty disables both.
        'signing_key' => env('PAGESQUIRE_SIGNING_KEY'),
        // The site origin calls are signed for (default: the origin of APP_URL).
        'origin' => env('PAGESQUIRE_SITE_ORIGIN'),
        // Declare and forward redacted screenshots (ui.screenshot) to a model that
        // reads images; visitors still allow them in the extension. Off by default.
        'screenshots' => env('PAGESQUIRE_SCREENSHOTS', false),
    ],
    // PageSquire Link: pair with partner PageSquire sites (docs/link.md). Needs the
    // companion signing key; owners pair with the pagesquire:link-* commands.
    'link' => [
        'enabled' => env('PAGESQUIRE_LINK', false),
        // Shown to partner owners and visitors (default: APP_NAME).
        'name' => env('PAGESQUIRE_LINK_NAME'),
        'path' => 'pagesquire/link',
        // Services partners may hand visitors into: A2A-style skills with the fields
        // a handoff may carry and the page it opens, e.g.
        // ['id' => 'book_table', 'name' => 'Book a table', 'description' => '...',
        //  'tags' => ['restaurant'], 'fields' => ['date' => ['type' => 'string', 'format' => 'date']],
        //  'startPath' => '/reservations'].
        'skills' => [],
        // JSON file for links (default: storage/app/pagesquire-links.json). Bind your
        // own PageSquire\Server\Link\LinkStore for several application servers.
        'store' => env('PAGESQUIRE_LINK_STORE'),
        'requests_per_minute' => 60,
    ],
    // Replay verified trajectories for identical instructions without calling the provider.
    'trajectory_cache' => [
        'enabled' => false,
        'store' => null,
        'ttl_seconds' => 86400,
    ],
];
