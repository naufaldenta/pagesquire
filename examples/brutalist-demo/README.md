# OFFBEAT / PageSquire demo

[Open the live demo](https://pagesquire-offbeat-demo.vercel.app/)

A small art and culture site that shows PageSquire at work. The guided buttons run real registered browser capabilities, each verified after it runs, and need no key; they are not AI replies. Live AI chat uses the same runtime and requires the owner's private demo access code.

## How it works

The static Next.js frontend and a Vercel Node function deploy as **one Vercel project**. Exact rewrites send `/api/session` and `/api/chat` to `api/assistant.mjs`. Supabase PostgreSQL provides durable storage; Redis, PHP and Composer are not needed.

The API uses PageSquire's Node conversation engine and OpenAI-compatible provider. Choose a provider preset with `PAGESQUIRE_PROVIDER` and set `PAGESQUIRE_API_KEY` and `PAGESQUIRE_MODEL` on the server. Most hosted presets need no URL; Qwen, 9Router and Custom need `PAGESQUIRE_PROVIDER_URL`. See the [support matrix and setup tutorials](../../docs/providers.md). The older URL-only configuration still works.

The API allows only this demo's thirteen reversible capabilities, each with a local postcondition check:

- Heading color and heading highlighting, separate from body text and links.
- Body-text color, link highlighting, reading font (sans/serif/mono), weight, size (16/18/20/24 px) and line spacing (1.6/1.8/2).
- Combined gallery style filters, text search (including zero results), and featured/A–Z/Z–A ordering.
- Scrolling to the hero, gallery, culture, playground or footer, including viewport-edge verification.
- Resetting reading adjustments or all page adjustments, without clearing chat, login or usage limits.

There is no generic click, free navigation, account or purchase tool. Replies carry one of six emotions, and loading uses `thinking`. The SVG avatar is original artwork, not a Rive renderer or a licensed character.

## Conversations and errors

Keep sending messages in the same conversation; you don't need **New conversation** between requests. The conversation ID and server-side history carry follow-ups such as “yes, do that.” Earlier turns are normalized on the server before each request, and provider responses and tool parameters are always strictly validated.

When something goes wrong:

- A known provider-format error keeps the conversation ID, so your next message still has the context. Nothing is retried automatically, so there are no paid retries.
- An unknown or network error drops the conversation ID, because its state is uncertain.
- When access expires, the UI returns to the unlock screen. An unsupported action chosen by the model does not sign you out.
- Error messages come from a fixed list that tells quotas, expired sessions and provider failures apart, without showing raw responses. Production logs record only the event name, status and a short error code, never chat text or credentials.

Try these as separate messages: `make headings red`, `make highlight all heading`, `make body text violet`, `use double line spacing`, `reset all page changes`. The first two run different tools. “Explore more page actions” puts examples in the message box without sending them.

## Local preview and tests

From the repository root, with Node.js 24+ and dependencies installed:

```sh
npm run demo:build
npm run demo:serve
```

The static preview prints its local URL. Live chat isn't available there, and the preview doesn't read your private env file or use provider credits. For browser tests:

```sh
npm run test:demo
```

This starts a **synthetic test backend**: the real engine, client and runtime, with fake credentials, an in-memory store and a scripted provider. The production function never imports that store or provider. Passing tests say nothing about how well a live model behaves. Don't expose the test server publicly.

## Server environment

Copy [env.example](env.example) to `.env.local` in this directory and fill it in privately. The file is kept out of Git, source archives and Vercel uploads. Never use the `NEXT_PUBLIC_` prefix for a credential. Add production values separately to the Vercel project's **Production environment**, then redeploy.

| Variable                            | Value                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PAGESQUIRE_PROVIDER`               | Preset ID, for example `sumopod`, `groq`, `openai` or `custom`. Unset keeps the older explicit-URL configuration.        |
| `PAGESQUIRE_PROVIDER_URL`           | Optional full HTTPS endpoint override; required for `qwen`, `9router` and `custom`. Never a browser-supplied value.      |
| `PAGESQUIRE_MODEL`                  | Your provider's exact model ID. No model is hardcoded; change this and redeploy to switch.                               |
| `PAGESQUIRE_API_KEY`                | Server-only provider API key.                                                                                            |
| `PAGESQUIRE_SESSION_SECRET`         | Cryptographically random 32 bytes encoded as 64 hex characters.                                                          |
| `PAGESQUIRE_DEMO_ACCESS_CODE`       | Private visitor unlock code, 12–256 characters. Not your provider key.                                                   |
| `PAGESQUIRE_STORAGE_DRIVER`         | `supabase-postgres`.                                                                                                     |
| `PAGESQUIRE_DATABASE_URL`           | Supabase PostgreSQL Transaction pooler connection URL with password.                                                     |
| `PAGESQUIRE_PUBLIC_ORIGIN`          | Exact HTTPS production origin, without a trailing slash or path.                                                         |
| `PAGESQUIRE_DATABASE_CA`            | Local path to the downloaded database CA, or its complete PEM content. On Vercel, use PEM content, **not a local path**. |
| `PAGESQUIRE_DAILY_REQUEST_LIMIT`    | Optional global provider-attempt budget per rolling 24-hour bucket; default `100`.                                       |
| `PAGESQUIRE_IP_DAILY_REQUEST_LIMIT` | Optional provider attempts per hashed client IP per 24-hour bucket; default `25`.                                        |

Generate the session secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and keep it private. Rotating the secret or the access code invalidates existing signed sessions. Store the API key, database URL, session secret and access code as Vercel secret values, and never paste them into chat, issues or GitHub.

The hosted demo uses a Sumopod endpoint and model through this generic configuration; see [Sumopod's OpenAI-compatible API guide](https://docs.sumopod.com/guides/ai/openai-compatible-api). If you switch provider or model, check again that it works and follows tool instructions well. There is no automatic fallback or paid retry.

## Supabase PostgreSQL setup

1. Use a separate Supabase project for the demo. Copy the **Transaction pooler** connection string from **Connect**, use the actual host and URL-encode special characters in the password. See [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
2. Never paste the connection string into chat, GitHub or a `NEXT_PUBLIC_` variable. Direct PostgreSQL access does not need a Supabase API or service-role key.
3. Download the root CA from **Database Settings → SSL Configuration** and save it, for example as `.cache/supabase-ca.crt` at the repository root. Set `PAGESQUIRE_DATABASE_CA` to that local path. The driver always verifies TLS and strips connection-string options that could turn verification off. Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized: false`.
4. Review [the additive SQL migration](server/migrations/001_private_assistant.sql), then run from the repository root:

```sh
npm run demo:migrate
```

The migration reads only this example's ignored `.env.local`; shell variables take precedence. It creates a dedicated `pagesquire_private` schema with a version marker and tables for sessions and budgets, and refuses to touch an existing schema without its ownership marker. Every table has RLS enabled, with access revoked for public, `anon` and `authenticated`. Don't add public read policies or expose this schema through a Data API. The database role you configure must own or have access to these tables; the demo doesn't create a separate least-privilege role.

How storage behaves:

- Each checkpoint commits before inference continues.
- Fenced 90-second leases serialize requests without holding an SQL transaction open during provider calls, so this works through a transaction pooler.
- Atomic SQL counters are shared across serverless instances.
- Expired session data is discarded on next access. Rows expire after two hours, and authenticated traffic triggers a bounded cleanup at most once a minute. Rows are removed as traffic arrives, **not exactly at expiry**.

Optional database tests use `PAGESQUIRE_TEST_DATABASE_URL` and `PAGESQUIRE_TEST_DATABASE_CA`:

```sh
npm run test:demo-db
```

Without that test URL, the suite skips and never reads your env file. CI uses a throwaway local PostgreSQL service; hosted databases need verified TLS. Tests delete only their own randomly named rows. They cover committed failure checkpoints, concurrent counters, lease fencing, expiry, payload limits and RLS.

## Vercel deployment

Deploy from the **repository root**, not this example directory. [vercel.json](../../vercel.json) builds the shared packages during install so function tracing can include them, exports the frontend and deploys the Node API with a 60-second platform limit. There is no catch-all rewrite. Set all the required production values above, migrate the database, then run:

```sh
vercel link --project your-own-demo-project
vercel deploy --prod
```

Use your own Vercel account and project. `.vercelignore` excludes credentials, dependencies, private notes, database files and local certificates. Upload the certificate's PEM **value** through the Vercel environment settings, and never upload your private env file. The frontend contains no provider or database credentials.

After deploying, check `/api/session`, logging in with the access code, a real chat reply and a verified page action. A successful static build alone doesn't prove the AI backend works.

## Security, budgets and privacy

- Sessions use signed one-hour cookies that are HttpOnly, Secure and SameSite=Strict. Writes need the exact origin and a session-bound CSRF token. The access code is checked on the server. Signing out clears the cookie, but there is no server-side revocation list, so rotate the access code or secret to invalidate copied cookies.
- Login: five attempts per hashed IP and 100 overall per ten minutes. Chat: 40 requests per IP per minute, 300 overall per minute and 20 per session per minute. Provider calls: 20 per session per hour, plus the IP and global daily budgets. Each action round and final reply is a separate provider attempt. Failed calls still count, and nothing is retried automatically.
- Vercel's client-IP header is trusted only on Vercel; elsewhere all clients share one unknown-IP bucket. Raw IPs are never stored, only a keyed hash. These are demo safeguards, not full bot protection.
- Chat messages, bounded page observations and browser results are stored privately in Supabase and sent to the configured model provider. Don't share personal or sensitive information. The assistant's own UI and private areas are left out of page observation.
- Chat is not kept in browser storage, so closing or reloading the page loses the transcript. Start a new conversation to drop the current conversation ID.
- Missing configuration, storage failures and exhausted limits fail closed. The guided buttons keep working when AI is unavailable.

## Art and font credits

The character collage is original AI-generated art made for the demo; the other visuals and expressions are original SVG and CSS. No third-party franchise characters are included. The art is part of the MIT-licensed demo, and no exclusive rights are claimed for the generated images.

Anton is self-hosted from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/anton) under the [SIL Open Font License](public/fonts/OFL.txt). The license sits beside the font, and the build also copies PageSquire's MIT notice.
