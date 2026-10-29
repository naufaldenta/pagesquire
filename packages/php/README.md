# pagesquire/server

PageSquire's conversation engine for PHP 8.3, independent of Laravel. It includes a native HTTPS provider, a bounded standalone endpoint and injectable atomic file storage. See [standalone PHP integration](../../docs/standalone-php.md).

Not yet on Packagist, so `composer require` won't find it; install it from this repository.

## Provider

Presets use the same server-only `PAGESQUIRE_PROVIDER`, `PAGESQUIRE_API_KEY` and `PAGESQUIRE_MODEL` settings as the Node and Laravel packages. Custom or regional gateways also need `PAGESQUIRE_PROVIDER_URL`.

Create the provider with `Http\OpenAiCompatibleProvider::fromEnvironment(new ProtocolValidator, getenv())`. PHP does not load `.env` files on its own. Constructing the provider with an explicit endpoint still works, and no model ID is built in. See the [provider matrix and PHP tutorial](https://github.com/naufaldenta/pagesquire/blob/main/docs/providers.md#standalone-php).

## Engine

`Provider::complete(messages, capabilities, maxOutputTokens)` returns a structured draft: `text`, `emotion`, `finished` and at most one proposed `{capabilityId, parameters}` action. The engine owns the transcript, call IDs, snapshot binding, pending results, expiry and response envelopes. It validates every draft and all action parameters against the trusted catalog, and never accepts history or capability schemas from the client.

`ConversationEngine::handle(request, state, allowedIds, checkpoint)` returns `state` and `reply`. Your storage adapter must:

- bind state to the session and principal that started it;
- serialize concurrent operations;
- durably checkpoint the state before provider work.

Failed attempts count. Unknown or expired conversations and mismatched results fail closed. Repeating the last request returns its cached reply, after permissions and schemas are checked again.

Defaults: 8 action steps, 12 provider attempts, at most 1,000 output tokens per attempt and a fixed 15-minute expiry. These limits bound the number of requests, not the cost; input tokens are still billed. Set host-wide quotas before going public.

The engine intersects the server-approved IDs with the IDs the browser has installed. Consequential capabilities are excluded unless you construct the engine with `allowConsequential: true`. A failed result stops the turn in a predictable, safe way. Browser results are untrusted and must never authorize business changes on the server. Narration of a proposed action is replaced until the action is verified. You still need to evaluate the model's replies for accuracy and prompt injection.

## Validation

`ProtocolValidator` uses Opis JSON Schema with the same generated protocol schemas as the JavaScript packages. Run `npm run build` at the repository root before PHP tests or packaging.

- Validate raw decoded JSON objects at the HTTP boundary so `{}` and `[]` stay distinct. Associative PHP arrays lose that difference.
- Don't accept arbitrary remote schemas or use selectors chosen by the model.
- Trusted local parameter schemas must use closed object inputs.

## Errors and custom providers

`AssistantException` exposes a sanitized `errorCode`, message and HTTP status. Providers must not put raw bodies, credentials or prompt data in those errors or in logs.

A `Provider` implementation must bound its own HTTP time, response size and output length. The native `Http\OpenAiCompatibleProvider` and the Laravel package already do. The native transport validates raw JSON before converting it and keeps parameter objects intact in stored checkpoints. Custom providers must preserve the object/array distinction themselves.

## App context

Optional [public app context and availability](../../docs/app-context.md) is checked for structure and meaning, passed to the provider only as current, untrusted data, and used to narrow later proposals without breaking authorization of pending results. Use matching generated schemas and browser packages. Nothing is collected by default, and no framework dependency or permission is added.

## PageSquire Link

`Link\LinkManager` pairs this site with another owner's PageSquire site ([PageSquire Link](../../docs/link.md#using-link-phase-6a)). It signs server-to-server envelopes with the `ActionSigner` site key, keeps links in a `LinkStore` (`FileLinkStore` serializes with file locks) and reaches partners through `CurlLinkTransport`, which refuses redirects and bounds time and size. Serve `LinkEndpoint` at the link path and pass `$manager->declaration()` to `ActionSigner::declaration()`.

## Packaging

A release must include `resources/schemas/*.json`, this README, the MIT license and the Composer runtime dependencies.
