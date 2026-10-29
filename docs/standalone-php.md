# Standalone PHP integration

`pagesquire/server` runs on PHP 8.3 without Laravel. It includes Opis JSON Schema validation, the conversation engine, a native cURL provider, a size-limited HTTP endpoint and a single-host file store. Write capabilities with the [onboarding CLI](onboarding.md) or by hand, and use the same trusted manifest in the browser and on the server.

These browser features work with the PHP backend unchanged:

- [Action progress](action-progress.md). The widget shows what each action is doing, with fixed failure guidance and a short local history. Rebuild the browser assets; nothing changes on the PHP side. Progress is never sent to the provider or stored on the server.
- [AppContext](app-context.md). Optional public state and feature availability. Install matching PHP schemas and browser packages before you enable it. The PHP side checks structure and limits, and uses availability only to filter new proposals, never to authorize a pending result.
- [Assistant driving](assistant-driving.md). `BrowserDriver`, host control bindings, scoped reading, tours and optional local speech. Keep the PHP catalog explicit. Animation does not authorize a control or turn unverified navigation into success.

## Installing the package

The package is not on Packagist yet. Build this checkout first (`npm ci`, `npm run build`) so that `packages/php/resources/schemas/*.json` exists. In your PHP project, add a Composer path repository that points at this checkout's `packages/php`, and require `pagesquire/server` with `@dev`. Install `ext-curl` for the native transport. The package does not depend on Laravel.

## Endpoint

Set the server-only `PAGESQUIRE_PROVIDER`, `PAGESQUIRE_API_KEY` and `PAGESQUIRE_MODEL`, plus `PAGESQUIRE_PROVIDER_URL` for custom or regional gateways. PHP does not load `.env` files on its own. See [providers](providers.md) for presets, compatibility settings and older variable names.

Below is a sketch of an endpoint. `hostAuthorizeAssistant`, `hostPublicOrigin` and `hostPrivateAssistantDirectory` stand for your own application code; they are not PageSquire functions:

```php
<?php
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Http\ChatEndpoint;
use PageSquire\Server\Http\FileConversationStore;
use PageSquire\Server\Http\OpenAiCompatibleProvider;

require __DIR__.'/../vendor/autoload.php';
// Bootstrap the site's secure authenticated session before reading authorization.
$session = hostAuthorizeAssistant();
// Returns null, or trusted key/principal/csrfToken/capabilityIds from the host.
// Never copy these values from request JSON or accept a conversation ID as a session key.
session_write_close();

$validator = new ProtocolValidator;
$manifest = json_decode(file_get_contents(__DIR__.'/../pagesquire/capabilities.json'), true, 64, JSON_THROW_ON_ERROR);
$provider = OpenAiCompatibleProvider::fromEnvironment($validator, getenv());
$endpoint = new ChatEndpoint(
    new ConversationEngine($provider, $validator, $manifest),
    $validator,
    new FileConversationStore(hostPrivateAssistantDirectory()),
    hostPublicOrigin(),
);
$endpoint->serve($session);
```

Validate the environment when your app starts. If configuration is missing, disable the endpoint without exposing exception details.

How the provider transport behaves:

- The provider URL must be HTTPS, server-owned and free of credentials. Redirects are not followed and requests are not retried.
- The HTTP timeout is 20 seconds, with 5 seconds to connect. TLS certificate verification stays on.
- The response is read as a stream, up to 256 KiB. Model content is limited to 64 KiB and validated before PHP converts it to objects and arrays.
- The HTTP client can be replaced for tests or a trusted transport, never with a URL chosen by the client.

### The session array

`hostAuthorizeAssistant()` returns null to deny access, or `{ key: string, principal: string, csrfToken: string, capabilityIds: list<string> }`:

- `key` is bound to the host's secure, opaque session.
- `principal` identifies the user. Include a user or role revision in it if needed.
- `csrfToken` is generated on the server and given only to same-origin browser bootstrap. Configure `createHttpTransport` to send it.
- `capabilityIds` is filtered by the site's real permissions, never by what the model or browser claims.

Your app owns secure, HttpOnly, SameSite cookies, login and logout, the policy for anonymous visitors, public HTTPS, quotas (global, per principal and per IP) and reverse-proxy configuration.

### What `serve` does

- Accepts POST with uncompressed JSON, checks the exact configured Origin, the CSRF token and authorization, reads at most 196,609 bytes and returns no-store JSON.
- When the client asks, streams fixed progress stages as NDJSON. Disable output buffering for the route ([streaming](streaming.md)).
- Allows 20 valid requests per session per minute by default.
- Keeps a separate hourly provider budget (`attemptsPerHour`, default 60, maximum 1000). It counts inference attempts across all conversations in the session, so starting a new conversation does not reset it. When it runs out, the endpoint returns 429 `BUDGET_EXHAUSTED`.

`handle(method, headers, body, session)` lets an existing router call the endpoint. Your body reader must enforce the size limit before buffering and send the same no-store and nosniff headers. Rejecting malformed input is not abuse protection; add rate limits at the web server or edge.

## State and concurrency

Create the storage directory outside the document root, accessible only to the application's service account (0700/0600 on Unix, explicit ACLs on Windows). Do not share it with untrusted writers.

- The file store serializes operations with a separate OS file lock. It writes each checkpoint to a flushed temporary file and renames it, independently of the PHP session.
- Failed model attempts are saved before inference, even if the request fails later.
- Concurrent requests for the same session get 409. The OS releases locks if a worker exits.
- There is one conversation per session. A change of principal discards the conversation state but keeps the session's rate bucket.

This store is for **one host with a persistent local filesystem**. For several hosts, network filesystems or serverless PHP, implement `ConversationStore::transaction` on a shared atomic store, and make every checkpoint durable before returning. Do not save only on success. Set execution and input timeouts and storage quotas. The package does not clean up after itself: expire or delete inactive state and lock files according to your retention policy. Durability across power loss has not been tested.

For full-document pages, opt into the [client navigation checkpoint](../packages/client/README.md). The destination page verifies the pending navigation and continues the server conversation without running the handler again. No transcript is kept in the browser. A browser success is still untrusted and never permits business writes on the server.

## Erasing a transcript

`PageSquire\Server\Http\ConversationPrivacy::forget($store, $sessionKey, $principal)` clears conversation state from trusted server code, inside the usual exclusive transaction, and keeps request and provider budgets. Read the [operations runbook](operations.md) before you use it. It is not a public route, does not revoke sessions, and does not erase data held by the provider or in backups.

## Tests

The [PHP development router](../examples/php-chat/router.php) runs the native endpoint and store on localhost with a scripted provider. Never deploy it. Shared fixtures run the same protocol scenarios in PHP and Node. The native tests cover CSRF, origin and default-deny, replay, principal changes, rate limits and locks, durable failed attempts, object-versus-array validation and provider configuration limits.
