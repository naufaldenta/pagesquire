# AI providers and model compatibility

PageSquire connects through server-side, non-streaming OpenAI-compatible Chat Completions. The same presets work in Node/Next.js, standalone PHP, Laravel and the WordPress plugin. A preset selects an endpoint and request dialect, **not a model**. There is no fixed model list, automatic provider switch, hidden paid retry, or guarantee that every model follows the action contract.

## Minimum configuration

For a hosted preset, supply these three server-only settings:

```dotenv
PAGESQUIRE_PROVIDER=groq
PAGESQUIRE_API_KEY=
PAGESQUIRE_MODEL=
```

Fill the key from that provider's account and an exact text-chat model ID available to that account. Do not use a model's marketing display name. Model IDs differ between direct providers and gateways. Changing a model does not require source edits or website retraining; changing a provider requires its own key and a compatibility check.

For `qwen`, `9router` and `custom`, also provide:

```dotenv
PAGESQUIRE_PROVIDER_URL=https://your-reviewed-gateway.example/v1/chat/completions
```

This is the **full endpoint**, not only a base URL. Qwen requires the account/workspace/region endpoint from Alibaba Cloud; 9Router requires your own gateway. The transport deliberately requires HTTPS, valid TLS, no credentials/query/fragment in URLs and no redirects. Put local 9Router behind a trusted TLS endpoint; do not disable certificate verification or expose its dashboard publicly. A localhost HTTP default is not silently enabled. WordPress additionally applies its safe HTTP host/IP restrictions: private/internal gateway targets are not permitted by that transport.

API credentials, model and provider settings never belong in browser JavaScript, `NEXT_PUBLIC_*`, `VITE_*`, exported website context or Git. Provider keys and the private OFFBEAT visitor access code are different credentials.

## Built-in presets

The [dated documentation review](provider-evidence.json) was refreshed on **2026-10-21** for every named profile. It records source URLs and unresolved model-specific boundaries, not live certification. See [model evaluation](model-evaluation.md) for the separate Sumopod-only live smoke and reproducible synthetic checks.

“Supported” means an implemented preset with synthetic request/response, parity and packaging coverage. It does **not** mean live certification of every provider/model, account, region, price or native tool API. Verify availability and terms in the linked official documentation. Preset defaults are starting profiles; explicit overrides handle model differences.

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

GLM model families can be hosted by Z.AI (`zai`), Zhipu China (`glm`) or a gateway. Choose the service that issued your key, not just the model family. Z.AI Coding Plan subscriptions are not assumed to authorize a public website assistant; use the standard API service or an independently reviewed permitted endpoint. Qwen regional/workspace URLs must be copied from the correct account.

Gateways can route requests or resolve model aliases independently of PageSquire. PageSquire does not configure fallback lists or repair plugins, but that does not disable a gateway's own routing. A requested model ID is not proof of the upstream model weights. Do not copy direct-provider model aliases into a gateway configuration without checking that gateway's account documentation.

The `xai` profile targets its legacy Chat Completions endpoint and uses `max_tokens`. It does not cover Responses-only or multi-agent variants. See [xAI's API comparison](https://docs.x.ai/developers/model-capabilities/text/comparison) before choosing a model.

Anthropic Messages, OpenAI Responses, Azure deployment URLs/API-version authentication, native Gemini requests, streaming-only models, embeddings, audio/image models and provider-hosted browsing tools are **not native transports in this release**. Claude or other model families may work through a compatible gateway such as OpenRouter; this is not direct Anthropic API support. Implement the existing `Provider` interface for a genuinely different API protocol.

## Compatibility controls

Leave these unset to use the preset. They are explicit server-side settings, not browser preferences:

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

- `json_object` asks the API for JSON; `prompt` uses the same JSON instructions without sending `response_format`. If a provider rejects JSON mode, select `prompt` deliberately. PageSquire does not retry a billable request with another dialect.
- `tools` (opt-in, no preset uses it by default) sends only the capabilities approved for this turn as native `tools` function definitions, with dots in IDs replaced to fit function-name rules. Only the first returned tool call is read as the single proposed action; later calls are never executed or reported. A plain-text reply becomes a finished answer without actions, and a JSON reply is still accepted. The engine still authorizes the capability, validates parameters with the trusted schema and requires browser verification. Some providers support only a subset of JSON Schema in function parameters; test your provider and model before enabling it.
- Token fields are `max_tokens` or `max_completion_tokens`; PageSquire never sends both. Reasoning tokens may consume the limit before a final answer. Adjust the host's bounded output-token budget and timeout deliberately, or choose a model suited to short interactive actions. Current engine ceilings remain 4096 output tokens and 60 seconds at transport level; hosting may impose lower limits.
- `PAGESQUIRE_THINKING=disabled` maps to `enable_thinking: false` for Qwen and `thinking: {type: "disabled"}` for direct Z.AI/Zhipu/DeepSeek. Use it only when the selected model supports disabling reasoning. Some reasoning-only models reject or ignore it. Other presets reject this option locally rather than inventing a provider parameter.
- Trusted system instructions are consolidated at the start of the provider request. User messages and browser results remain untrusted data. No sampling temperature, provider tool, web search or arbitrary extra-body setting is silently enabled.

The response reader accepts bounded text or text-only content parts containing a complete JSON object, optionally inside a whole JSON Markdown fence. Outside `tools` mode it does not extract fragments from prose, repair malformed JSON, accept native provider tool calls, forward reasoning text, or accept partial/truncated/refused completions.

## Provider diagnostics

Each provider call can report metadata for logs and metrics: `outcome` (`ok`, `http_error`, `network_error`, `timeout`, `cancelled` in Node, `invalid_response`), the HTTP `status` when known, `latencyMs`, and token `usage` (`inputTokens`, `outputTokens`, `totalTokens`) when the provider returns it. Prompts, completions, headers, response bodies and keys are never included. Node: pass `onDiagnostic` to `OpenAiCompatibleProvider`. Native PHP: pass a callable as the `onDiagnostic` constructor argument or to `fromEnvironment`. Laravel: listen for `PageSquire\Laravel\Events\ProviderCalled`. Hook failures are ignored and never change the provider outcome. All six emotions, the strict response schema, capability authorization, parameters and browser postconditions still apply. A provider preset never grants additional website permissions.

## Node and Next.js

Install/build the GitHub alpha using the existing [Node guide](node-next.md). In a server-only module:

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

Pass this provider to the existing `ConversationEngine`. To build an owner-only provider selector, use `listProviderPresets()`; it returns public metadata, not keys or model account data. Do not expose a public endpoint that accepts provider URLs/keys and proxies arbitrary requests. The [Next.js guide](node-next.md) covers session, CSRF, authorization and shared storage; provider selection does not replace those requirements.

## Standalone PHP

Install the GitHub alpha as in the [PHP guide](standalone-php.md). Read the process environment on the server:

```php
use PageSquire\Server\Http\OpenAiCompatibleProvider;
use PageSquire\Server\ProtocolValidator;

$provider = OpenAiCompatibleProvider::fromEnvironment(
    new ProtocolValidator,
    getenv(),
);
```

Use the same `PAGESQUIRE_*` settings above. PHP does not load a dotenv file automatically; use your deployment environment or the host's existing approved environment loader. Native cURL remains required. The existing explicit-endpoint constructor remains available for trusted custom transports.

## Laravel + React/Inertia

Follow [Laravel setup](laravel-react.md), publish/review `config/pagesquire.php`, then configure the same three settings in the host's private `.env`. The service provider resolves the preset server-side; there is no provider key in Inertia props. Laravel reads env only from its configuration file. After changing a production configuration, rebuild the host's config cache with its normal deployment procedure (`php artisan config:cache`).

Earlier published PageSquire config files need the new provider-name/dialect entries merged manually; do not overwrite host changes with a forced vendor publish. Legacy `PAGESQUIRE_PROVIDER_ENDPOINT`, `PAGESQUIRE_PROVIDER_KEY` and `PAGESQUIRE_PROVIDER_MODEL` remain accepted. In the shared Node/PHP environment helpers, conflicting nonempty old/new aliases fail closed. Laravel config gives the new canonical variable precedence; remove obsolete aliases rather than maintaining two sets.

## WordPress plugin

Install the rebuilt ZIP using the [plugin guide](../packages/wordpress/README.md).

1. Open **PageSquire → Connect your provider** and select **AI provider**.
2. Hosted presets fill the endpoint automatically. For Qwen, 9Router or Custom, paste your full reviewed HTTPS endpoint.
3. Enter the exact **Model identifier** from that service. No model is hardcoded.
4. Enter **New provider key** over HTTPS for encrypted dashboard storage, or define server-only `PAGESQUIRE_API_KEY` in `wp-config.php`. Blank means keep the existing key, not obtain a key for the newly selected service. Replace credentials when changing providers.
5. Keep compatibility controls on **Provider default** initially. Set JSON/prompt mode, token field, instruction role or supported reasoning switch only when that model requires it.
6. Save the disabled draft; this performs no model call. Complete scope inspection, consent, access and quotas before enabling.

Provider selection is administrator-only and nonce-protected. Keys remain encrypted/config-owned and are omitted from admin responses/context exports. Saving configuration is not a live model test. Changing settings increments the authorization revision; existing sessions cannot silently inherit new configuration.

## OFFBEAT on Vercel

Use [the demo guide](../examples/brutalist-demo/README.md) and its `env.example`. Provider setup uses the same three variables, plus URL for custom/regional gateways. Existing URL-only owner configuration still works as `custom`; this change does not replace existing secrets or change the active model. The demo additionally needs session secret, visitor access code, public origin, Supabase connection/CA and storage driver. These are deployment/security requirements, not extra AI provider credentials.

## Verification before enabling real visitors

Test a greeting, a supported action, its verified final reply, a second independent command, a short confirmation, an unsupported action, cancellation, provider refusal/truncation and usage-limit feedback. Check headings separately from body text and links. Keep failed attempts charged and review per-session/IP/global budgets. Do not log provider response bodies or keys.

Synthetic transport coverage cannot certify live model judgment. Run bounded, owner-approved paid checks against the **exact provider + model + dialect** you will deploy. A model that cannot reliably follow the response contract should remain disabled or be replaced; never loosen authorization to accommodate it.
