# OFFBEAT — the PageSquire public demo

An independent, English-language internet-culture playground with original character art, a filterable gallery, art-detail dialogs, accessibility controls, and real PageSquire browser actions. No host-application content or credentials are used.

## Run locally

From the repository root, using Node.js 24 or later:

```sh
npm ci
npm run demo:build
npm run demo:serve
```

Open the local URL printed by the server. For development, use `npm run demo:dev`. Run `npm run test:demo` after a production build for Chromium interaction, accessibility-control, responsive-layout, and network-boundary tests.

## What is live?

The guided buttons invoke the real `BrowserRuntime` and capability registry, using build-time compiled schemas. Completion is reported only after rendered DOM/computed-style verification. Heading color, link highlighting, reading-copy weight/size, gallery filtering, and section scrolling are implemented independently.

Live AI chat is **locked**. These are explicitly labeled guided actions, not model-generated replies. There are no provider calls, session endpoints, chat storage, paid services, or Redis requirements. Changes are local to the current page and reset on reload. The original SVG avatar demonstrates all six emotion states; it does not bundle a Rive renderer or third-party character asset.

## Environment preparation

No environment variables are needed to build or deploy the current demo. Copy [env.example](env.example) to `.env.local` inside this directory if you want to prepare future server-only configuration. The local file is ignored by Git, the source archive, and Vercel CLI uploads. Do not put real secrets in the template or any `NEXT_PUBLIC_` variable.

The listed variables are reserved, not implemented switches. **Adding keys will not unlock AI.** A future live backend must first implement durable atomic conversation/budget storage, server-only provider access, authorization, CSRF/origin checks, quotas, and abuse protection. Use a PostgreSQL-backed store or another atomic shared backend if Redis is unsuitable; an in-memory/file store is not a safe serverless substitute. Keep production secrets in the deployment platform's environment settings, not in frontend code.

## Vercel

Deploy from the **repository root**, not this example directory. Root [vercel.json](../../vercel.json) selects a static build (`npm run demo:build`) and publishes only `examples/brutalist-demo/out`. It deliberately does not deploy the local PHP/Node/Next.js conversation servers. No PHP runtime or Composer installation is required for this build.

```sh
vercel link --project pagesquire-offbeat-demo
vercel deploy --prod
```

Select your own Vercel account/team when linking. Do not reuse another application's Vercel project. Linking and deployment require your own authenticated account; no credentials are included. `.vercelignore` excludes credentials, dependencies, private working notes, and generated local artifacts. Only the static export is served; there is no catch-all rewrite exposing repository files.

## Art and font credits

The character collage is AI-generated original demo art; the other visuals and expressions are original code-native SVG/CSS. No third-party franchise characters or host-application assets are included. These assets are part of the MIT-licensed PageSquire demo; no exclusivity is claimed for generated imagery.

Anton is self-hosted from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/anton) under the [SIL Open Font License](public/fonts/OFL.txt). Its license is included alongside the font. The PageSquire MIT notice is copied into the static export by the build.
