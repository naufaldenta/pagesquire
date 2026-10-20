# OFFBEAT / PageSquire demo

[Open the live demo](https://pagesquire-offbeat-demo.vercel.app/)

An independent English art/culture playground, not a copy of any host application. Guided buttons invoke real, registered and verified browser capabilities without a key. Live AI chat uses the same runtime and requires the owner's private demo access code. The buttons are not model-generated replies.

## Architecture

The static Next.js frontend and a native Vercel Node function deploy to **one Vercel project**. Exact rewrites route `/api/session` and `/api/chat` to `api/assistant.mjs`. Supabase PostgreSQL supplies external durable storage; Redis, PHP and Composer are not needed for this deployment.

The API reuses PageSquire's Node conversation engine and OpenAI-compatible provider. It authorizes only this demo's thirteen reversible capabilities, each with local postcondition checks:

- Heading color and heading highlighting, separate from body text and links.
- Body-text color, link highlighting, reading font (sans/serif/mono), weight, size (16/18/20/24 px) and line spacing (1.6/1.8/2).
- Combined gallery style filters, text search (including zero results), and featured/A–Z/Z–A ordering.
- Scrolling to the hero, gallery, culture, playground or footer, including viewport-edge verification.
- Resetting reading adjustments or all page adjustments, without clearing chat, login or usage limits.

There is no generic click, arbitrary navigation, account or purchase tool. Assistant responses carry one of six emotions; loading uses `thinking`. The original SVG avatar is not a bundled Rive renderer or licensed third-party character.

## Follow-up messages and recovery

Keep sending messages in the same conversation; there is no need to choose **New conversation** between normal requests. The current conversation ID and server-owned history carry follow-ups such as “yes, do that.” Older internal action envelopes/plain-text assistant history are normalized before inference, not accepted as new provider outputs. Provider responses and tool parameters still require strict validation.

Known provider-format failures keep the established conversation ID so the next explicit message can use prior context; there is no automatic paid retry. Unknown/network failures still abandon the uncertain ID. Access expiry returns the UI to unlock, whereas an unsupported model-selected action does not sign the visitor out. Fixed, allowlisted error explanations distinguish quotas, expired sessions and provider failures without exposing raw response bodies. Production rejection logs contain only event name, status and bounded error code, never chat text or credentials.

Try separate messages: `make headings red`, `make highlight all heading`, `make body text violet`, `use double line spacing`, `reset all page changes`. The first two operations are now distinct supported tools. “Explore more page actions” inserts examples into the message box; it does not submit them automatically.

## Local preview and tests

From the repository root, with Node.js 24+ and dependencies installed:

```sh
npm run demo:build
npm run demo:serve
```

The static preview prints its loopback URL; live chat is unavailable there. It does not load your private env file or spend provider credits. For automated browser coverage:

```sh
npm run test:demo
```

This starts a **synthetic test backend**, using the real engine/client/runtime but fake credentials, an in-memory fixture store and a deterministic provider. That store/provider is never imported by the production function. Synthetic success does not establish live-model accuracy. Do not expose the test server publicly.

## Server environment

Copy [env.example](env.example) to `.env.local` in this directory and fill it privately. The file is excluded from Git, source archives and Vercel uploads. Never use `NEXT_PUBLIC_` for any credential. Production values must be added separately to the Vercel project's **Production environment**, followed by a deployment.

| Variable                            | Value                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PAGESQUIRE_PROVIDER_URL`           | Full HTTPS OpenAI-compatible chat-completions URL, including `/v1/chat/completions` when required by your provider.      |
| `PAGESQUIRE_MODEL`                  | Your provider's exact model ID. No model is hardcoded; change this env and redeploy to switch.                           |
| `PAGESQUIRE_API_KEY`                | Server-only provider API key.                                                                                            |
| `PAGESQUIRE_SESSION_SECRET`         | Cryptographically random 32 bytes encoded as 64 hex characters.                                                          |
| `PAGESQUIRE_DEMO_ACCESS_CODE`       | Private visitor unlock code, 12–256 characters. Not your provider key.                                                   |
| `PAGESQUIRE_STORAGE_DRIVER`         | `supabase-postgres`.                                                                                                     |
| `PAGESQUIRE_DATABASE_URL`           | Supabase PostgreSQL Transaction pooler connection URL with password.                                                     |
| `PAGESQUIRE_PUBLIC_ORIGIN`          | Exact HTTPS production origin, without a trailing slash or path.                                                         |
| `PAGESQUIRE_DATABASE_CA`            | Local path to the downloaded database CA, or its complete PEM content. On Vercel, use PEM content, **not a local path**. |
| `PAGESQUIRE_DAILY_REQUEST_LIMIT`    | Optional global provider-attempt budget per rolling 24-hour bucket; default `100`.                                       |
| `PAGESQUIRE_IP_DAILY_REQUEST_LIMIT` | Optional provider attempts per hashed client IP per 24-hour bucket; default `25`.                                        |

Generate the session secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and save it privately. Rotating the secret or access code invalidates existing signed sessions. Keep API key, database URL, session secret and access code as Vercel Secret values; never paste them into chat, issues or GitHub.

The demo currently uses an owner-selected Sumopod endpoint/model through this generic configuration. See [Sumopod's OpenAI-compatible API guide](https://docs.sumopod.com/guides/ai/openai-compatible-api). Compatibility and tool-following quality must be rechecked when changing providers/models; no automatic fallback or paid retry is performed.

A bounded live check on the production alias verified heading-only red color, highlighted links and bold reading copy in one conversation, followed by a final `happy` reply. Assistant history retains the provider-response JSON shape on every turn instead of exposing internal action envelopes. This smoke check does not establish general model accuracy or production security certification.

## Supabase PostgreSQL setup

1. Use a separate Supabase project for the demo. Copy the **Transaction pooler** connection string from **Connect**; use the actual host and URL-encode special characters in the password. See [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
2. Never paste the connection string into chat, GitHub or a `NEXT_PUBLIC_` variable. Direct PostgreSQL does not need a Supabase API/service-role key.
3. Download the root CA from **Database Settings → SSL Configuration** and save it, for example, as `.cache/supabase-ca.crt` at the repository root. Set `PAGESQUIRE_DATABASE_CA` to that local path. The driver always verifies TLS and strips connection-string options that could disable verification. Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized: false`.
4. Review [the additive SQL migration](server/migrations/001_private_assistant.sql), then run from the repository root:

```sh
npm run demo:migrate
```

The migration command loads only this example's ignored `.env.local` (shell environment takes precedence). It creates the dedicated `pagesquire_private` schema, version marker, sessions and budgets tables. It refuses an existing schema without the ownership marker. All tables enable RLS, with public/`anon`/`authenticated` access revoked. Do not add public read policies or expose this schema through a Data API. The configured database role must own/have access to these private tables; this demo does not provision a separate least-privilege database role.

Each checkpoint commits before inference proceeds. Fenced 90-second leases serialize requests without holding an open SQL transaction during provider networking, including with a transaction pooler. Atomic SQL counters are shared across serverless instances. Expired session payloads are discarded on next access. Rows expire after two hours; authenticated traffic triggers bounded expiry cleanup at most once per minute. Physical removal is traffic-driven, **not guaranteed exactly at expiry**.

Optional database tests use `PAGESQUIRE_TEST_DATABASE_URL` and `PAGESQUIRE_TEST_DATABASE_CA`:

```sh
npm run test:demo-db
```

Without that explicit test URL, the suite skips and never reads the owner's env file. CI uses a disposable loopback PostgreSQL service; hosted databases require verified TLS. Tests delete only their randomly identified rows. They cover committed failure checkpoints, concurrent counters, lease fencing, expiry, payload limits and RLS.

## Vercel deployment

Deploy from the **repository root**, not this example directory. [vercel.json](../../vercel.json) builds shared packages during install so function tracing can include them, exports the frontend and deploys the Node API with a 60-second platform limit. No repository catch-all rewrite is used. Set all required production env values above, migrate the database, then:

```sh
vercel link --project your-own-demo-project
vercel deploy --prod
```

Use your own authenticated account/project. `.vercelignore` excludes credentials, dependencies, private notes, database files and local certificates. Upload the certificate's PEM **value** through Vercel environment settings; never upload your private env file. The frontend contains no provider/database credentials. Verify `/api/session`, access-code login, a real chat reply and a verified page action after deployment; a successful static build alone does not prove a working AI backend.

## Security, budgets and privacy

- Signed one-hour, HttpOnly, Secure, SameSite=Strict cookies; exact-origin and session-bound CSRF checks for writes. The access code is checked server-side. Signing out clears the browser cookie; there is no server-side cookie revocation list. Rotate the access code/secret to invalidate copied cookies.
- Login limits: five attempts per hashed IP and 100 globally per ten minutes. Chat requests: 40/IP/minute, 300 global/minute, 20/session/minute. Provider calls: 20/session/hour, plus the configurable IP/global daily budgets. Each action round and final reply counts as another provider attempt. Failed calls remain charged; no automatic paid retry.
- Vercel's platform client-IP header is trusted only on Vercel. Elsewhere all clients share an unknown-IP bucket. No raw client IP is stored; a keyed hash is used. These controls are demo safeguards, not comprehensive bot protection or a production security certification.
- Chat messages, bounded page observations and browser results are stored privately in Supabase and sent to the configured model provider. Do not share personal/sensitive information. Assistant UI/private areas are excluded from page observation; chat is not saved in browser storage. Closing/reloading does not restore the browser transcript. Start a new conversation to discard the current client conversation ID.
- Missing configuration, storage failures or limits fail closed. Guided actions remain available when AI is unavailable. This remains an alpha with thirteen scoped tools, not unrestricted autonomous browsing.

## Art and font credits

The character collage is AI-generated original demo art; the other visuals and expressions are original SVG/CSS. No third-party franchise characters or host-application assets are included. The assets are part of the MIT-licensed demo; no exclusivity is claimed for generated imagery.

Anton is self-hosted from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/anton) under the [SIL Open Font License](public/fonts/OFL.txt). The license is included beside the font; the build also copies PageSquire's MIT notice.
