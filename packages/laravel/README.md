# PageSquire Laravel adapter

For optional [public app context and availability](../../docs/app-context.md), install matching browser/PHP schemas first. FormRequest preserves the optional validated array while raw protocol/semantic checks and Gates remain authoritative; no new route or automatic state discovery is enabled.

Early Laravel 13 / PHP 8.3 integration for PageSquire's server-owned conversation engine. This package is developed in the local monorepo and is not published on Packagist yet. Do not treat this preview as a production security audit or a guarantee of model accuracy.

## Enable deliberately

The discovered service provider registers no endpoint until `pagesquire.enabled` is true. Publish configuration with the host application's Artisan command:

```sh
php artisan vendor:publish --tag=pagesquire-config --no-interaction
```

Select a server-side provider preset, its key and an account-owned model ID:

```dotenv
PAGESQUIRE_ENABLED=true
PAGESQUIRE_PROVIDER=groq
PAGESQUIRE_API_KEY=your-server-only-key
PAGESQUIRE_MODEL=your-provider-model
```

Custom/regional gateways also require the full HTTPS `PAGESQUIRE_PROVIDER_URL`. Existing `PAGESQUIRE_PROVIDER_ENDPOINT/KEY/MODEL` aliases remain available. Merge new provider-name/dialect entries into previously published configuration and refresh the host config cache on deployment. See the [provider matrix and Laravel tutorial](https://github.com/naufaldenta/pagesquire/blob/main/docs/providers.md#laravel--reactinertia).

These values must never become Inertia shared props, Vite variables, widget options, scan artifacts or public exports. Requests to the configured external provider transmit approved capability descriptions, the visitor's conversation and the filtered page snapshot. Explain this data transfer and provider charges to visitors before activation. Inference is not free merely because PageSquire is open source.

In `config/pagesquire.php`, set `manifest` to either a trusted manifest array or an absolute path to a trusted manifest JSON file. It must match the browser adapter's reviewed capability definitions. The server does not accept capability definitions or permissions from the browser. The browser's `capabilityIds` merely narrows the server-approved catalog.

## Authorize explicitly

Both gates deny access unless the host defines them. An intentionally public, presentation-only integration could define:

```php
use App\Models\User;
use Illuminate\Support\Facades\Gate;

Gate::define('pagesquire.use', fn (?User $user): bool => true);
Gate::define('pagesquire.capability', fn (?User $user, string $id): bool => in_array($id, [
    'accessibility.set_heading_color',
    'accessibility.set_link_highlight',
    'accessibility.set_font_weight',
], true));
```

Adapt the principal type and conditions to the host application. Authenticated workflows should use the application's own policies. Consequential capabilities are blocked by the engine even if a gate approves them. Browser action evidence is untrusted client telemetry; it is not authorization for business mutations.

## Endpoint and browser integration

The named `pagesquire.chat` route is a POST endpoint with the `web` middleware group, CSRF protection, a named rate limiter and session blocking. The default path is `/pagesquire/chat`; resolve it with `route('pagesquire.chat')`, not by assuming the path. Laravel/Inertia hosts using Wayfinder should generate and use its route function in the frontend. Pass only the generated endpoint URL and the host's normal CSRF header into the widget transport.

The request contract accepts a bounded message or a matching pending action result, a snapshot, advertised capability IDs, and protocol/request/conversation identifiers. It rejects client history, system instructions and provider configuration. Successful replies contain `ChatReply`; PageSquire-handled errors use a sanitized `{ error: { code, message } }`, with `Cache-Control: no-store`. Host middleware may return standard Laravel errors instead, such as a CSRF rejection.

Use server-side sessions (`file`, `database` or Redis, for example) and a cache store supporting atomic locks. Cookie sessions are rejected. Configure secure session cookies and trusted proxies normally for your deployment. Conversation state is written immediately into the selected server-side cache, using a key derived from the session ID and a principal-bound wrapper. `pagesquire.cache_store` selects that store; when unset it uses the application's default cache. Use a durable, appropriately private shared cache for multi-worker deployments. The `session` and `null` cache drivers are rejected; `array` is allowed only in tests.

One conversation slot is stored per session: starting a new conversation replaces the previous slot, including across tabs. Logging in or out requires a new conversation. Cache entries expire with the engine's original deadline; each checkpoint uses its remaining lifetime, not a new conversation lifetime. State is not embedded in the ordinary session or a client cookie. The adapter does not prematurely save the host session or age its flash messages.

The session lock outlasts the configured provider timeout. Each inference attempt is checkpointed before the request, so upstream failure cannot erase its attempt count. An exact cached request may replay its reply; changed or consumed request IDs are rejected by the engine. Authorization is checked again on continuations.

## Limits and extension points

Configuration bounds request size, conversation lifetime, action steps, inference attempts and output tokens. Rate limits apply to both session and IP. These controls are not dollar-denominated billing guarantees; use the provider's own account spending controls and host-specific abuse prevention as well. JSON is bounded in application memory; configure matching request/response limits at the web server and reverse proxy for hostile traffic.

The provider supports explicit JSON-object or prompt-only JSON mode and either output-token field, without guessing from model names. The response must still pass strict validation; a preset is not live certification of every model. HTTP timeouts are explicit; redirects, insecure TLS and automatic retries are not enabled. Header and progress callbacks abort oversized responses; the transport requests identity encoding and rejects compressed responses to keep decompression from bypassing the byte limit. Aborting a browser request does not guarantee cancellation of an already-running provider request.

Bind your own `PageSquire\Server\Provider` implementation in the host container to support another API. There is no required model vendor, remote PageSquire service, telemetry or live-provider call in the tests.

## Verification

From the monorepo root, after building the protocol and installing Composer dependencies:

```sh
php vendor/bin/phpunit tests/php/Laravel
php vendor/bin/pint packages/laravel tests/php/Laravel --format agent
```

Tests exercise the actual Laravel router, session middleware, authorization, CSRF rejection, rate limiting, state/checkpoint behavior and a faked HTTP provider. They do not prove multi-server lock performance, live-model tool selection, screen-reader support or production readiness. See the root roadmap for the remaining release gates.

This package's original source is covered by the repository's MIT license.
