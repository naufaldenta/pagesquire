# PageSquire Laravel adapter

Laravel 13 (PHP 8.3) integration for PageSquire's server-side conversation engine. It is in beta.

## Install

```sh
composer require pagesquire/server:^0.1@beta pagesquire/laravel:^0.1@beta
```

Both packages need `@beta`, because Composer only allows a beta version for packages you require directly.

This package is a read-only copy of `packages/laravel` in the [PageSquire repository](https://github.com/naufaldenta/pagesquire). Send issues and pull requests there.

## Enable it

The service provider is auto-discovered but registers no route until `pagesquire.enabled` is true. Publish the configuration:

```sh
php artisan vendor:publish --tag=pagesquire-config --no-interaction
```

Pick a provider preset, then set its key and your model ID on the server:

```dotenv
PAGESQUIRE_ENABLED=true
PAGESQUIRE_PROVIDER=groq
PAGESQUIRE_API_KEY=your-server-only-key
PAGESQUIRE_MODEL=your-provider-model
```

Custom or regional gateways also need the full HTTPS `PAGESQUIRE_PROVIDER_URL`. The older `PAGESQUIRE_PROVIDER_ENDPOINT`, `PAGESQUIRE_PROVIDER_KEY` and `PAGESQUIRE_PROVIDER_MODEL` names still work. If you published the config earlier, merge in any new provider and dialect entries and refresh the config cache when you deploy. See the [provider matrix and Laravel tutorial](https://github.com/naufaldenta/pagesquire/blob/main/docs/providers.md#laravel--reactinertia).

Keep these values on the server. Never put them in Inertia shared props, Vite variables, widget options, scan artifacts or public exports.

Each chat request sends the approved capability descriptions, the visitor's conversation and the filtered page snapshot to your provider, and the provider charges for that. Tell visitors about it before you turn the assistant on.

In `config/pagesquire.php`, set `manifest` to a trusted manifest array or the absolute path of a trusted manifest JSON file. It must match the capabilities your browser adapter defines. The server never accepts capability definitions or permissions from the browser; the browser's `capabilityIds` can only narrow the server's catalog.

## Authorize

Both gates deny access until you define them. A public integration that only changes presentation could use:

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

Adapt the user type and conditions to your app; authenticated workflows should use your own policies.

The engine blocks consequential capabilities even when a gate allows them, unless `PAGESQUIRE_ALLOW_CONSEQUENTIAL=true`. Even then, the browser runtime needs an approval prompt and a person's approval for each call. Action results reported by the browser are untrusted and never authorize business changes.

## Endpoint and browser integration

The `pagesquire.chat` route is a POST endpoint in the `web` middleware group, with CSRF protection, a named rate limiter and session blocking. Its default path is `/pagesquire/chat`, but resolve it with `route('pagesquire.chat')` (or Wayfinder's generated route function in an Inertia frontend) instead of assuming the path. Give the widget transport only that URL and your normal CSRF header.

A request carries a bounded message or a matching pending action result, a snapshot, the advertised capability IDs and protocol, request and conversation IDs. Client history, system instructions and provider settings are rejected. Success returns a `ChatReply`. Errors handled by PageSquire return a sanitized `{ error: { code, message } }` with `Cache-Control: no-store`. Other middleware may still return standard Laravel errors, such as a CSRF rejection.

### Sessions and storage

- Use server-side sessions, for example `file`, `database` or Redis. Cookie sessions are rejected. Configure secure session cookies and trusted proxies as usual.
- Conversation state is written straight to a cache store that supports atomic locks, under a key derived from the session ID and bound to the current principal. `pagesquire.cache_store` picks the store; otherwise the default cache is used. Multi-worker deployments need a durable, private, shared cache. The `session` and `null` drivers are rejected, and `array` is allowed only in tests.
- Each session holds one conversation. Starting a new one replaces it, even from another tab. Logging in or out requires a new conversation.
- Cache entries expire at the conversation's original deadline; checkpoints don't extend it. State is never stored in the ordinary session or a client cookie. The adapter does not save the host session early or age its flash messages.
- The session lock outlasts the provider timeout. Each inference attempt is checkpointed before the request, so a failed upstream call still counts. An exact repeat of a request may get its cached reply; changed or already-used request IDs are rejected. Authorization is checked again on every continuation.

## Limits

Configuration bounds request size, conversation lifetime, action steps, inference attempts and output tokens. Rate limits apply per session and per IP. These are not spending caps, so also set spending limits in your provider account and add your own abuse protection. JSON is bounded in application memory; set matching request and response limits on the web server and reverse proxy as well.

## Provider transport

The provider uses JSON-object mode or prompt-only JSON mode and either output-token field, as configured. It never guesses from the model name. Every response still goes through strict validation, and a preset does not mean every model has been tested.

Timeouts are explicit. Redirects, insecure TLS and automatic retries are off. Oversized responses are aborted, and compressed responses are rejected so decompression cannot get around the size limit. Aborting a browser request does not necessarily cancel a provider request that is already running.

To use another API, bind your own `PageSquire\Server\Provider` implementation in the container. No particular model vendor, remote PageSquire service or telemetry is required, and the tests make no live provider calls.

## App context

The adapter accepts optional [public app context and availability](https://github.com/naufaldenta/pagesquire/blob/main/docs/app-context.md). Deploy matching browser and PHP schemas first. The FormRequest keeps the validated context array, but the raw protocol checks and your gates still decide. No route or automatic state collection is added.

## Language

Set `PAGESQUIRE_LOCALE=id` for Indonesian fixed engine replies (default `en`). Browser text follows `<html lang>` or the `locale` option; see [languages](https://github.com/naufaldenta/pagesquire/blob/main/docs/i18n.md).

## Companion extension

Set `PAGESQUIRE_SIGNING_KEY` to a key from `npx pagesquire signing-key` to sign every action call for the [companion extension](https://github.com/naufaldenta/pagesquire/blob/main/docs/companion-extension.md#signed-action-calls). The package then also serves the public key at `/.well-known/pagesquire.json`. Calls are signed for the origin of `APP_URL`; set `PAGESQUIRE_SITE_ORIGIN` if the public origin differs. Keep the key secret, like the provider key.

`PAGESQUIRE_SCREENSHOTS=true` also declares redacted screenshots and forwards each one once to the model, which must accept images. Visitors still have to allow screenshots in the extension.

## PageSquire Link

With the signing key set, `PAGESQUIRE_LINK=true` lets this site pair with another owner's PageSquire site ([PageSquire Link](https://github.com/naufaldenta/pagesquire/blob/main/docs/link.md#using-link-phase-6a)).

- The package serves `POST /pagesquire/link`, adds a `link` section to `/.well-known/pagesquire.json` and keeps links in `storage/app/pagesquire-links.json` (move it with `PAGESQUIRE_LINK_STORE`).
- Name the site with `PAGESQUIRE_LINK_NAME` and list partner-facing skills under `pagesquire.link.skills`.
- Owners pair from the command line with `pagesquire:link-invite`, `pagesquire:link-accept`, `pagesquire:link-list`, `pagesquire:link-overview`, `pagesquire:link-approve` and `pagesquire:link-revoke`.
- Handoffs also need the browser side: the one-tag embed with `data-link="true"`, or `createLinkBindings` and `mountLinkArrival` in a custom setup ([details](https://github.com/naufaldenta/pagesquire/blob/main/docs/link.md#handoff-phase-6b)). Allow `link.handoff` in your `pagesquire.capability` gate.

With `PAGESQUIRE_A2A=true` and skill IDs under `pagesquire.link.a2a.skills`, any A2A agent can send requests into those skills ([A2A interface](https://github.com/naufaldenta/pagesquire/blob/main/docs/link.md#a2a-interface-phase-6e)). The package publishes a signed Agent Card and serves `POST /pagesquire/a2a`. The agent only gets a single-use link where the person continues.

## Tests

From the root of the [PageSquire repository](https://github.com/naufaldenta/pagesquire), after building the protocol and installing Composer dependencies:

```sh
php vendor/bin/phpunit tests/php/Laravel
php vendor/bin/pint packages/laravel tests/php/Laravel --format agent
```

The tests run the real Laravel router, session middleware, authorization, CSRF rejection, rate limiting and checkpointing against a faked HTTP provider. They don't cover multi-server locking, live-model behaviour or screen readers.

This package is MIT licensed.
