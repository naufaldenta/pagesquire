# PageSquire for WordPress

Rebuilt shared widget assets include [action progress](../../docs/action-progress.md): actual stages, fixed recovery guidance and bounded memory-only history. No new admin setting, capability, privilege or database/provider configuration is introduced by C4. Install matching rebuilt assets/ZIP; this does not imply a deployed plugin update or real assistive-technology certification.

The shared rebuilt engine accepts optional [public app context](../../docs/app-context.md) for custom reviewed browser integrations. The default widget does not collect custom app state or add an admin context screen. Context never grants WordPress permissions; matching browser/PHP schemas must be deployed before opting in.

The built-in adapter now presents registered actions using an optional-motion cursor/outline. Three additional opt-in capabilities (`page.read`, `page.scroll_to`, `page.highlight`) target only the approved content root with scope `content`. Defaults still enable only the original three accessibility controls. Select new capabilities, rerun inspection on every selected public page, review consent and explicitly enable. Inspection uploads counts and verified IDs, not article text. See [assistant driving and custom-control boundaries](../../docs/assistant-driving.md); third-party accessibility UI, Rive assets and cloud TTS are not bundled.

An opt-in assistant for a small, owner-approved set of public pages. This alpha plugin ships prebuilt JavaScript, compiled validators and isolated PHP dependencies. Hosting users do not need Node.js or Composer. It does not train a model or understand every theme/plugin automatically.

## Requirements and installation

- WordPress 7.1+, PHP 8.3+, JSON, mbstring and sodium for dashboard key storage.
- HTTPS in production; an OpenAI-compatible HTTPS JSON chat provider.
- Install `pagesquire-0.1.0-beta.0.zip` through **Plugins → Add Plugin → Upload Plugin**, activate it, then open **PageSquire**.
- Configure provider-side spending limits. Public access is disabled by default.

## Five-step onboarding

1. Enter assistant identity and language, choose **AI provider**, and enter its exact **Model identifier**. Hosted presets fill the endpoint; Qwen, 9Router and Custom also require your own full HTTPS endpoint. Define `PAGESQUIRE_API_KEY` in server configuration, or enter a key over HTTPS for encrypted option storage. Replace the key when changing providers; blank keeps the old key. Leave compatibility controls on **Provider default** unless the model requires JSON/prompt mode, a different token field, instruction role or a supported reasoning switch. Rotating WordPress authentication salts invalidates stored keys. Draft saving never calls the provider. See the [support matrix and full WordPress tutorial](https://github.com/naufaldenta/pagesquire/blob/main/docs/providers.md#wordpress-plugin).
2. Select up to 20 published, unprotected pages/posts. Save the draft. Choices show the first 50 public items plus saved selections; this is not whole-site discovery.
3. Open each inspection link as an administrator and run adapter checks. Review visible changes (they are restored afterwards). If navigation is selected, navigate between approved pages from the inspection panel, run checks on arrival, and return to the first page to verify it too. A one-page scope should leave navigation disabled. Refresh readiness in the dashboard.
4. Optionally export the AI integration ZIP into a **separate review directory**. Invoke `$assistant-setup` in Codex or `/assistant-setup` in Claude Code. Both use the included local skill. Review the resulting `pagesquire.mapping.json`, import only that file, and repeat inspection. The manual root/adapter controls do not require a coding agent. Existing agent instructions are never overwritten by WordPress.
5. Review access (administrators, authenticated readers or explicit public opt-in), external processing consent and the daily provider-attempt budget. Enable only after every selected page/adapter has current checks. Configure your privacy notice and provider agreement first.

Every mapping import disables the assistant and clears inspections. Page modifications, origin changes and theme name/version changes invalidate readiness. Dynamic theme/plugin/CSS changes can escape these fingerprints: manually reinspect after any deployment. Reports are administrator-supplied review evidence, not remote attestation or authorization. There is no unrestricted click, custom-selector import or arbitrary PHP/JavaScript execution.

## Initial adapters and limits

- Heading color: visible, non-private headings inside one approved content root, verified using computed color. Body text is not targeted.
- Link highlighting: visible public links, verified class and computed outline.
- Font weight: the selected root's computed weight; descendants with theme-specific weights may override inheritance. Private regions may inherit visual styles even though they are excluded from observation.
- Navigation: exact approved same-origin page URLs, one-shot full-document continuation, no action replay. Browser session storage must be available for continuation.

Supported root choices are `main`, `#content`, `#primary`, `.wp-site-blocks` and `[data-pagesquire-content]`; ambiguous/missing roots fail closed. Current visible desktop states only are inspected. Modal/hidden/mobile states, multilingual plugins, Elementor, WooCommerce and third-party accessibility panels are **not certified**. Classic and core block-theme fixtures are tested; no universal theme compatibility claim is made. Six emotion states are exposed through `pagesquire:emotion` events (`idle`, `happy`, `sad`, `thinking`, `confused`, `hover`); bring your own licensed mascot/Rive asset. Loading uses `thinking`.

Visual settings apply to the current document, not saved WordPress/theme preferences; a normal reload resets them. Navigation continuation verifies arrival first and then executes any remaining requested actions on the destination.

## Privacy, operations and security

Exports include selected public titles/URLs, bounded block **names/structure**, theme/version, counts, mappings and gaps. They exclude raw post bodies/HTML/block attributes, database dumps, private/password posts, users, form values, credentials and source code. Review public titles/URLs before sharing. In chat, filtered visible text, link/control labels, messages and selected metadata go to the configured external provider. A private marker (`data-pagesquire-private`) excludes observation, not an access-control boundary. Do not enable on sensitive pages.

REST administration requires `manage_options` plus a valid WordPress REST nonce. Cookie-authenticated chat also uses the WordPress nonce, signed HttpOnly SameSite cookies, a separate session CSRF token and exact Origin checks. Nonces are **not** anonymous authorization or abuse protection. Public access intentionally makes the service available to strangers. PHP HTTP requests use WordPress's safe HTTPS client, no redirects and bounded responses; never configure a private/internal provider target.

Durable non-autoload options checkpoint state before inference. Global limits are 60 requests/minute, 30 per source IP/minute, 1,000 live session registrations and 1–1,000 provider attempts/UTC day (default 100, failures included). IP keys are salted hashes; forwarded-IP headers are not trusted. These limits are not currency caps, and a reverse proxy may make visitors share an IP. Add host/WAF controls and provider spending limits. Exclude selected pages and `/pagesquire/v1/` REST responses from full-page/CDN caching; cached logged-in nonces must never be shared.

Expired session records are pruned on subsequent bootstrap/chat traffic after expiry plus two minutes; idle sites retain records until traffic resumes. Disabling/deactivating preserves settings, encrypted keys and pending state for recovery. Back up/review retention and delete the `pagesquire_` options with your normal database administration tools when uninstalling permanently. Export never contains transcripts.

Atomic option-name locks fail closed if a worker is killed. There is deliberately no unsafe automatic stale-lock takeover. For recovery, disable the plugin and stop/drain **all** assistant PHP workers first, back up the database, then remove only the stranded `pagesquire_state_<sha256>_lock` options through trusted database administration. Restart only after checking provider-attempt accounting; do not delete budget records to bypass quotas. Use a single writable WordPress database and a coherent object cache. Multisite/network activation and distributed database failover are not certified.

## Development

Lock ownership uses prepared `INSERT IGNORE` against WordPress's unique option-name index, direct database reads (not negative option caches), and token-bound deletion. Do not replace this with `add_option()`, which uses duplicate-key updates. Verification uses WordPress's official SQLite compatibility layer; a live MySQL/MariaDB host, persistent-cache topology and multi-worker load still need deployment-specific evaluation.

From the PageSquire repository root: `npm ci`, `composer install`, `npm run build`, `npm run build:wordpress`. The build downloads a pinned, SHA-256-verified PHP-Scoper tool into ignored `.cache/`; bundled dependencies are namespace-isolated from other plugins. Plugin sources, shared library sources, generated source maps and license notices are available in the repository/distribution. Run `npm run test:wordpress` for the isolated WordPress/SQLite fixture. It downloads official, pinned WordPress 7.1.3, SQLite Database Integration 3.1.0 and verified WP-CLI 2.12.0, installs the real ZIP, and uses synthetic accounts/content only. Never deploy `examples/wordpress` or the test fixture.

The WordPress package is GPL-3.0-or-later. Shared PageSquire packages remain MIT. The nested `corresponding-source.zip` contains the editable project and build/test sources; extract it outside the web root to rebuild. See `THIRD-PARTY.md` and the accompanying licenses. This local alpha has not been published to WordPress.org or certified against a live AI provider.
