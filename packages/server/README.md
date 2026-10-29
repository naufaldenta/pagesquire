# @pagesquire/server

Server-side PageSquire for Node.js 24: the conversation engine, a native HTTPS JSON provider transport and Web Request/Response integration. Never import it into browser code or a Client Component. The package is in beta and not yet on npm.

## Provider

Create the provider with `new OpenAiCompatibleProvider(providerConfigurationFromEnv(process.env))` and set the server-only `PAGESQUIRE_PROVIDER`, `PAGESQUIRE_API_KEY` and `PAGESQUIRE_MODEL`. Add `PAGESQUIRE_PROVIDER_URL` for custom or regional gateways. `listProviderPresets()` returns public preset metadata for trusted setup screens. See the [support matrix and Node/Next.js tutorial](https://github.com/naufaldenta/pagesquire/blob/main/docs/providers.md#node-and-nextjs) for every preset and the dialect controls. A preset does not mean every model has been tested.

You can also pass the settings directly: `OpenAiCompatibleProvider({ endpoint, apiKey, model, timeoutMs })` takes a full HTTPS chat-completions URL that your server controls. The provider requests structured JSON output, rejects redirects, compressed responses and oversized responses, waits a bounded time and never retries. Keys stay on the server. An injected `fetch` implementation is trusted, which is meant for custom transports and tests.

## Engine

Use the same trusted manifest as the browser. `new ConversationEngine({ provider, manifest })` enforces server-owned history, authorization, binding between pending actions and their results, expiry, replay handling and budgets.

`handle(request, state, allowedIds, checkpoint, signal)` takes JSON data and trusted state owned by the server. Await every durable checkpoint, including the one before each provider call. Browser results are untrusted and are never permission for business changes.

Parameter schemas must be portable, self-contained and synchronous, like the ones the CLI produces. References and async schemas are rejected, and unsupported formats fail compilation instead of being silently ignored. Prefer explicit patterns, enums and ranges. Never load a schema supplied by the model.

## HTTP handler

`createChatHandler({ engine, store, origin, authorize })` works with Node Web Request hosts and with Next.js Route Handlers on the **nodejs** runtime. It requires:

- a JSON POST;
- the exact configured public Origin (it never derives this from an internal or proxied request URL);
- a matching session-bound CSRF token;
- explicit authorization from the host.

The host must set up a secure, HttpOnly, SameSite session; the library does not handle authentication. `authorize` denies by default: it returns null or a trusted `{ key, principal, csrfToken, capabilityIds }`. Include an authorization revision in `principal` where it makes sense. Never take these fields from the submitted JSON.

Defaults: 20 valid requests per session per minute, a 30-second endpoint wait, 8 action steps, 12 provider attempts, 1,000 output tokens per attempt and a fixed 15-minute conversation expiry. Requests rejected before reaching authenticated storage don't count against the session's limit. None of these are cost limits or limits across sessions. Before going public, add host-wide, per-principal and per-IP quotas, plus body and connection limits at the edge.

## Storage

`ConversationStore.transaction(key, operation)` must serialize every operation for a key and provide atomic, durable `load` and `save`. Each save must finish before it resolves. Never hold writes back until a response succeeds.

`FileConversationStore(existingPrivateDirectory)` is for a single host with a persistent local disk. Put the directory outside the web root and restrict it to the service account (use Windows ACLs where Unix modes don't apply). It uses an exclusive lock directory and flushed temp-file-and-rename checkpoints. Concurrent requests get a 409.

- A killed process can leave a lock directory behind. Make sure its owner has stopped before you remove it by hand, and never break locks automatically.
- Expire and delete inactive state and locks under a retention policy you have reviewed.
- Durability after power loss and behaviour on network filesystems are not guaranteed.

For multi-instance, serverless or ephemeral hosts, the file store won't work. Use a shared, durable, transactional store with real distributed locking. A custom host adapter must bound its own I/O and hold its lock until pending writes finish. Each session has one conversation. A change of identity invalidates the state but keeps the rate-limit bucket.

## PageSquire Link

`LinkManager({ store, signingKey, origin, profile })` pairs this site with another owner's PageSquire site ([PageSquire Link](../../docs/link.md#using-link-phase-6a)): invitations, approval and revocation, with Ed25519-signed envelopes between servers. Route `createLinkHandler(manager)` at the profile's endpoint and pass `link: manager.declaration()` to `siteDeclaration()`. `FileLinkStore` suits one process; multi-instance hosts need a shared transactional `LinkStore`.

## See also

[Node/Next.js integration](../../docs/node-next.md), [standalone PHP](../../docs/standalone-php.md) and the [security policy](../../SECURITY.md). Shared test fixtures check that the PHP and Node engines behave the same way.
