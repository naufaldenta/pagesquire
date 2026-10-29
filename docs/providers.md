# AI providers and model compatibility

PageSquire calls AI providers from the server, using non-streaming OpenAI-compatible Chat Completions. The same presets work in Node/Next.js, standalone PHP, Laravel and the WordPress plugin. A preset picks an endpoint and a request dialect, **not a model**; you choose the model. There is no fixed model list, no automatic switch to another provider and no hidden paid retry. Not every model follows the action contract well, so test the one you choose.

## Minimum configuration

For a hosted preset, set these three server-only values:

```dotenv
PAGESQUIRE_PROVIDER=groq
PAGESQUIRE_API_KEY=
PAGESQUIRE_MODEL=
```

Use a key from that provider's account and the exact ID of a text-chat model your account can use, not the model's marketing name. Model IDs differ between direct providers and gateways. Changing the model needs no code changes or website retraining. Changing the provider needs that provider's key and a compatibility check.

For `qwen`, `9router` and `custom`, also set:

```dotenv
PAGESQUIRE_PROVIDER_URL=https://your-reviewed-gateway.example/v1/chat/completions
```

This is the **full endpoint**, not a base URL. For Qwen, copy the endpoint for your account, workspace and region from Alibaba Cloud. For 9Router, use your own gateway. The transport requires:

- HTTPS with a valid certificate
- no credentials, query string or fragment in the URL
- no redirects

Plain HTTP to localhost is not allowed either. Put a local 9Router behind a trusted TLS endpoint; do not turn off certificate checks or expose its dashboard publicly. WordPress also applies its safe-HTTP rules, which block gateways on private or internal addresses.

API keys and provider and model settings never belong in browser JavaScript, `NEXT_PUBLIC_*` or `VITE_*` variables, exported website context or Git. The OFFBEAT demo's visitor access code is a different credential from the provider key.

## Built-in presets

[provider-evidence.json](provider-evidence.json) lists the official documentation checked for each preset, last on **2026-10-21**, along with open model-specific questions. See [model evaluation](model-evaluation.md) for the live smoke test (Sumopod only) and the reproducible synthetic checks.

Each preset has request and response tests, Node/PHP parity tests and packaging tests. That does not mean every model, account, region or price has been tried live. Check availability and terms in the provider's documentation. Presets are starting points; the overrides below handle differences between models.

| Provider ID  | Service                              | Endpoint                      | Default response / token field          | Documentation                                                                                                            |
| ------------ | ------------------------------------ | ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `custom`     | Custom OpenAI-compatible             | Required: your HTTPS endpoint | `json_object` / `max_tokens`            | [Official reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| `sumopod`    | Sumopod                              | Automatic                     | `json_object` / `max_tokens`            | [Official reference](https://docs.sumopod.com/guides/ai/openai-compatible-api)                                           |
| `openai`     | OpenAI                               | Automatic                     | `json_object` / `max_completion_tokens` | [Official reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| `openrouter` | OpenRouter                           | Automatic                     | `json_object` / `max_tokens`            | [Official reference](https://openrouter.ai/docs/api_reference/overview)                                                  |
| `groq`       | Groq                                 | Automatic                     | `json_object` / `max_completion_tokens` | [Official reference](https://console.groq.com/docs/openai)                                                               |
| `deepseek`   | DeepSeek                             | Automatic                     | `json_object` / `max_tokens`            | [Official reference](https://api-docs.deepseek.com/)                                                                     |
| `qwen`       | Qwen / Alibaba Cloud Model Studio    | Required: your HTTPS endpoint | `prompt` / `max_tokens`                 | [Official reference](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)           |
| `zai`        | GLM / Z.AI                           | Automatic                     | `prompt` / `max_tokens`                 | [Official reference](https://docs.z.ai/guides/overview/quick-start)                                                      |
| `glm`        | GLM / Zhipu China                    | Automatic                     | `prompt` / `max_tokens`                 | [Official reference](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)                                      |
| `9router`    | 9Router (your HTTPS gateway)         | Required: your HTTPS endpoint | `prompt` / `max_tokens`                 | [Official reference](https://github.com/decolua/9router)                                                                 |
| `gemini`     | Google Gemini (OpenAI compatibility) | Automatic                     | `json_object` / `max_tokens`            | [Official reference](https://ai.google.dev/gemini-api/docs/openai)                                                       |
| `mistral`    | Mistral                              | Automatic                     | `json_object` / `max_tokens`            | [Official reference](https://docs.mistral.ai/api/endpoint/chat)                                                          |
| `together`   | Together AI                          | Automatic                     | `json_object` / `max_tokens`            | [Official reference](https://docs.together.ai/docs/inference/openai-compatibility)                                       |
| `fireworks`  | Fireworks AI                         | Automatic                     | `json_object` / `max_tokens`            | [Official reference](https://docs.fireworks.ai/tools-sdks/openai-compatibility)                                          |
| `cerebras`   | Cerebras                             | Automatic                     | `json_object` / `max_completion_tokens` | [Official reference](https://inference-docs.cerebras.ai/resources/openai)                                                |
| `xai`        | xAI / Grok (legacy Chat Completions) | Automatic                     | `json_object` / `max_tokens`            | [Official reference](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions)                         |

GLM models are offered by Z.AI (`zai`), Zhipu China (`glm`) and gateways. Choose the service that issued your key, not the model family. A Z.AI Coding Plan subscription may not cover a public website assistant; use the standard API service instead. Copy Qwen regional or workspace URLs from the right account.

Gateways can route requests and resolve model aliases on their own. PageSquire does not configure fallback lists, but it cannot switch off a gateway's routing either, so the model ID you request does not prove which model answered. Check the gateway's documentation before you copy model IDs from a direct provider.

The `xai` preset targets xAI's legacy Chat Completions endpoint and uses `max_tokens`. It does not cover Responses-only or multi-agent variants. See [xAI's API comparison](https://docs.x.ai/developers/model-capabilities/text/comparison) before choosing a model.

These are **not supported directly**: Anthropic Messages, OpenAI Responses, Azure deployment URLs with API-version authentication, native Gemini requests, streaming-only models, embeddings, audio and image models, and provider-hosted browsing tools. Claude and other models may work through a compatible gateway such as OpenRouter, but that is not direct Anthropic API support. For a different API protocol, implement the `Provider` interface.

## Compatibility controls

Leave these unset to use the preset's defaults. They are server-side settings, not browser preferences:

```dotenv
# json_object requests JSON mode; prompt omits response_format but keeps strict output validation;
# tools sends approved capabilities as native function definitions.
PAGESQUIRE_RESPONSE_MODE=json_object
# Send exactly one output limit field.
PAGESQUIRE_TOKEN_PARAMETER=max_completion_tokens
# Some models prefer developer rather than system instructions.
PAGESQUIRE_SYSTEM_ROLE=system
# default sends no reasoning switch.
PAGESQUIRE_THINKING=default
```

- **Response mode.** `json_object` asks the API for JSON. `prompt` gives the same JSON instructions without sending `response_format`; choose it if a provider rejects JSON mode. PageSquire never retries a billable request in another dialect.
- **Tools mode.** `tools` is opt-in; no preset uses it by default. It sends only the capabilities approved for this turn as native `tools` function definitions, with dots in IDs replaced to fit function-name rules. Only the first returned tool call is read as the proposed action; later calls are never run or reported. A plain-text reply becomes a finished answer without actions, and a JSON reply is still accepted. The engine still authorizes the capability, validates parameters against the trusted schema and requires browser verification. Some providers support only part of JSON Schema in function parameters, so test your provider and model before you enable it.
- **Token field.** `max_tokens` or `max_completion_tokens`; PageSquire never sends both. Reasoning tokens can use up the limit before the final answer arrives. Adjust the output-token budget and timeout, or choose a model suited to short interactive actions. The engine caps output at 4096 tokens and the transport at 60 seconds; your hosting may set lower limits.
- **Thinking.** `PAGESQUIRE_THINKING=disabled` sends `enable_thinking: false` to Qwen and `thinking: {type: "disabled"}` to direct Z.AI, Zhipu and DeepSeek. Use it only when the model supports turning reasoning off; some reasoning-only models reject or ignore it. Other presets reject the option instead of inventing a provider parameter.
- **Instructions.** Trusted system instructions are combined at the start of the provider request. User messages and browser results stay untrusted data. Sampling temperature, provider tools, web search and extra request fields are never turned on silently.

The response reader accepts size-limited text, or text-only content parts, containing one complete JSON object, optionally wrapped in a single JSON Markdown fence. Outside `tools` mode it does not pull fragments out of prose, repair malformed JSON, accept native tool calls or forward reasoning text. Partial, truncated and refused completions are rejected.

## Provider diagnostics

Each provider call can report metadata for logs and metrics:

- `outcome`: `ok`, `http_error`, `network_error`, `timeout`, `cancelled` (Node only) or `invalid_response`
- `status`: the HTTP status, when known
- `latencyMs`
- `usage`: `inputTokens`, `outputTokens` and `totalTokens`, when the provider returns them

Prompts, completions, headers, response bodies and keys are never included. Errors thrown by a diagnostics hook are ignored and never change the provider result.

- **Node:** pass `onDiagnostic` to `OpenAiCompatibleProvider`.
- **Native PHP:** pass a callable as the `onDiagnostic` constructor argument or to `fromEnvironment`.
- **Laravel:** listen for `PageSquire\Laravel\Events\ProviderCalled`.

Whatever the provider, the six emotions, the strict response schema, capability authorization, parameter validation and browser postconditions all still apply. A provider preset never grants extra website permissions.

## Node and Next.js

Install and build as described in the [Node guide](node-next.md). In a server-only module:

```ts
import {
  OpenAiCompatibleProvider,
  providerConfigurationFromEnv,
} from '@pagesquire/server';

const provider = new OpenAiCompatibleProvider({
  ...providerConfigurationFromEnv(process.env),
  timeoutMs: 20000,
});
```

Pass this provider to `ConversationEngine`. To build a provider picker for site administrators, use `listProviderPresets()`; it returns public metadata, never keys or account data. Do not expose a public endpoint that accepts provider URLs or keys and forwards requests. The [Next.js guide](node-next.md) covers sessions, CSRF, authorization and shared storage; choosing a provider does not replace any of them.

## Standalone PHP

Install the package as in the [PHP guide](standalone-php.md), then read the process environment on the server:

```php
use PageSquire\Server\Http\OpenAiCompatibleProvider;
use PageSquire\Server\ProtocolValidator;

$provider = OpenAiCompatibleProvider::fromEnvironment(
    new ProtocolValidator,
    getenv(),
);
```

Use the same `PAGESQUIRE_*` settings as above. PHP does not load a `.env` file on its own; use your deployment environment or your app's environment loader. Native cURL is required. The constructor that takes an explicit endpoint is still available for trusted custom transports.

## Laravel + React/Inertia

Follow the [Laravel setup](laravel-react.md), publish and review `config/pagesquire.php`, then set the same three values in the app's private `.env`. The service provider resolves the preset on the server; no provider key reaches Inertia props. Laravel reads env values only from its config file, so after changing production configuration, rebuild the config cache as part of your usual deployment (`php artisan config:cache`).

If you published the PageSquire config before the provider presets existed, merge the new provider and dialect entries by hand rather than overwriting your changes with a forced publish. The older `PAGESQUIRE_PROVIDER_ENDPOINT`, `PAGESQUIRE_PROVIDER_KEY` and `PAGESQUIRE_PROVIDER_MODEL` still work. In the shared Node and PHP environment helpers, an old and a new name with different non-empty values is an error. In Laravel the new name wins. Remove the old names instead of keeping two sets.

## WordPress plugin

Install the rebuilt ZIP as described in the [plugin guide](../packages/wordpress/README.md).

1. Open **PageSquire → Connect your provider** and select **AI provider**.
2. Hosted presets fill in the endpoint. For Qwen, 9Router or Custom, paste your full HTTPS endpoint.
3. Enter the exact **Model identifier** from that service. No model is preset.
4. Enter a **New provider key** over HTTPS to store it encrypted in the dashboard, or define the server-only `PAGESQUIRE_API_KEY` in `wp-config.php`. Leaving the field blank keeps the existing key; it does not fetch a key for a newly selected service. Replace the key when you change providers.
5. Leave the compatibility controls on **Provider default** at first. Change JSON or prompt mode, the token field, the instruction role or the reasoning switch only when your model needs it.
6. Save the disabled draft. Saving does not call the model. Finish scope inspection, consent, access and quotas before you enable the assistant.

Only administrators can change the provider, and the form is nonce-protected. Keys stay encrypted or in config, and are left out of admin responses and context exports. Saving is not a live model test. Every settings change increases the authorization revision, so existing sessions cannot quietly pick up the new configuration.

## OFFBEAT on Vercel

Use [the demo guide](../examples/brutalist-demo/README.md) and its `env.example`. The provider uses the same three variables, plus the URL for custom or regional gateways. An older configuration with only a URL still works as `custom`. The demo also needs a session secret, the visitor access code, the public origin, the Supabase connection and CA, and the storage driver. Those are deployment and security settings, not provider credentials.

## Before you open it to visitors

Test a greeting, a supported action and its verified final reply, a second unrelated command, a short confirmation, an unsupported action, cancellation, provider refusal and truncation, and the usage-limit message. Check headings separately from body text and links. Keep charging failed attempts against the budget, and review the per-session, per-IP and global budgets. Do not log provider response bodies or keys.

Synthetic tests cannot tell you how well a live model judges. Run a small, budgeted set of paid checks against the **exact provider, model and dialect** you will deploy. If a model cannot reliably follow the response contract, keep it disabled or replace it; never loosen authorization to make it work.
