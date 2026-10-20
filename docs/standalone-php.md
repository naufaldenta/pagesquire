# Standalone PHP integration

`pagesquire/server` supports PHP 8.3 without Laravel. It includes Opis validation, a conversation engine, native cURL provider, bounded endpoint and single-host file store. No framework-specific model training is required. Use the CLI/manual capability workflow and the same trusted manifest on browser/server.

## Local package installation

The package is unpublished. Build this checkout first (`npm ci`, `npm run build`) so `packages/php/resources/schemas/*.json` exists. In an owner-approved PHP host, add a Composer path repository pointing to this checkout's `packages/php` and require `pagesquire/server` with `@dev`. A future release archive must contain the generated schemas, PHP sources, composer.json, README and LICENSE; do not distribute only src. Install `ext-curl` for the native transport. No Laravel dependencies are required by this package.

## Endpoint

The following is a host-owned endpoint sketch. `hostAuthorizeAssistant`, `hostPublicOrigin` and `hostPrivateAssistantDirectory` are your reviewed application integrations, not PageSquire functions:

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
$provider = new OpenAiCompatibleProvider(
    $validator,
    getenv('ASSISTANT_PROVIDER_URL'),
    getenv('ASSISTANT_PROVIDER_KEY'),
    getenv('ASSISTANT_MODEL'),
);
$endpoint = new ChatEndpoint(
    new ConversationEngine($provider, $validator, $manifest),
    $validator,
    new FileConversationStore(hostPrivateAssistantDirectory()),
    hostPublicOrigin(),
);
$endpoint->serve($session);
```

Validate environment settings during host startup; missing configuration must disable the endpoint without exposing exception details. The full provider endpoint must be HTTPS, server-owned and credential-free in its URL; there are no redirects or retries. Default HTTP timeout is 20 seconds with a 5-second connection bound. TLS certificate verification stays enabled. The JSON response is streamed with a 256 KiB ceiling; model content is limited to 64 KiB and validated before PHP object/array normalization. The native HTTP implementation is injectable for trusted testing/transports, not client-selected URLs.

The authorized session array is `{ key: string, principal: string, csrfToken: string, capabilityIds: list<string> }`. Bind key to the host's secure opaque session. Include user/role revision in principal if needed. Generate CSRF on the server, expose only its token to same-origin browser bootstrap, and configure `createHttpTransport` to send it. Deny access by returning null; filter IDs using actual site permissions, not model/browser claims. Hosts own secure/HttpOnly/SameSite cookies, login/logout, anonymous access policy, public HTTPS, global/principal/IP quotas and reverse-proxy configuration.

`serve` accepts POST uncompressed JSON, checks exact configured Origin, CSRF and authorization, reads at most 196,609 bytes and returns no-store JSON. `handle(method, headers, body, session)` is available for existing host routers; their body reader must enforce the ingress limit before buffering and emit equivalent no-store/nosniff headers. The server-owned bucket allows 20 valid requests/session/minute by default. Rejecting malformed unauthenticated input is not global abuse protection; add web-server/edge limits.

## State and concurrency

Create the storage directory outside the document root, limited to the application service account (0700/0600 on Unix; explicit Windows ACLs). Do not share it with untrusted writers. The file store serializes operations with a separate OS file lock and writes flushed temporary-file/rename checkpoints independently of the PHP session. Failed model attempts are saved before inference even if the request later fails. Concurrent same-session requests return 409; the OS releases locks if a worker exits. One conversation per session. Changing principal invalidates conversation state but preserves the session rate bucket.

This is **single-host persistent local-filesystem storage**. For multiple hosts, network filesystems or ephemeral/serverless PHP, implement `ConversationStore::transaction` using an actually shared atomic store; every checkpoint must be durable before returning. Do not save only on success. Configure host execution/input timeouts and storage quotas. Expire/delete inactive state/lock files under a reviewed retention policy; the package does not schedule cleanup. Power-loss durability is not certified.

For full-document pages, opt into the [client navigation checkpoint](../packages/client/README.md). The destination verifies the pending navigation and continues the server conversation without rerunning the handler; no browser transcript is persisted. Browser success remains untrusted telemetry, never permission for server business writes.

## Tests

The [localhost-only PHP router](../examples/php-chat/router.php) uses the native endpoint/store with a deterministic provider. Never deploy that development router publicly. Shared fixtures cover the same protocol scenarios in PHP and Node; native tests cover CSRF/origin/default-deny, replay, principal changes, rate/lock behavior, durable failed attempts, raw object-vs-array validation and bounded provider configuration. Live provider delivery/model quality and production hosting are separate evaluation gates.
