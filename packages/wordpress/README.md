# PageSquire for WordPress

An opt-in assistant for a small set of public pages you choose. The plugin ships prebuilt JavaScript, compiled validators and isolated PHP dependencies, so your host doesn't need Node.js or Composer. It does not train a model or learn every theme and plugin on its own.

The plugin is in beta and not yet on WordPress.org. Build the ZIP from this repository (see [Development](#development)).

## Requirements and installation

- WordPress 7.1+ and PHP 8.3+ with the JSON, mbstring and sodium extensions (sodium is used to store the API key).
- HTTPS in production, and an OpenAI-compatible HTTPS JSON chat provider.
- Install `pagesquire-0.1.0-beta.0.zip` from **Plugins → Add Plugin → Upload Plugin**, activate it and open **PageSquire**.
- Set spending limits with your provider. Public access is off by default.

## Setup in five steps

1. **Provider.** Enter the assistant's name and language, choose an **AI provider** and enter the exact **Model identifier**. Hosted presets fill in the endpoint; Qwen, 9Router and Custom need your own full HTTPS endpoint. Define `PAGESQUIRE_API_KEY` in the server configuration, or enter the key over HTTPS to store it encrypted. Enter a new key when you change providers; leaving the field blank keeps the old one. Rotating the WordPress authentication salts invalidates stored keys. Leave the compatibility controls on **Provider default** unless the model needs JSON or prompt mode, a different token field, a different instruction role or a supported reasoning switch. Saving a draft never calls the provider. See the [support matrix and full WordPress tutorial](https://github.com/naufaldenta/pagesquire/blob/main/docs/providers.md#wordpress-plugin).
2. **Pages.** Select up to 20 published, unprotected pages or posts and save the draft. The list shows the first 50 public items plus anything already selected; it does not discover the whole site.
3. **Inspection.** As an administrator, open each inspection link and run the adapter checks. Review the visible changes; they are undone afterwards. If navigation is selected, move between the approved pages from the inspection panel, run the checks on each page as you arrive, and return to the first page to check it too. With only one page, leave navigation off. Then refresh readiness in the dashboard.
4. **AI-assisted mapping (optional).** Export the AI integration ZIP into a **separate review directory**, then run `$assistant-setup` in Codex or `/assistant-setup` in Claude Code. Both use the skill included in the ZIP. Review the resulting `pagesquire.mapping.json`, import only that file and inspect again. You can do the same by hand with the root and adapter controls, without a coding agent. WordPress never overwrites existing agent instructions.
5. **Access and enable.** Choose who may use the assistant (administrators, signed-in readers, or everyone if you explicitly opt in), set consent for external processing and the daily provider-attempt budget. Prepare your privacy notice and provider agreement first. Enable the assistant only when every selected page and adapter has current checks.

Importing a mapping always disables the assistant and clears inspections. Changes to a page, the site origin or the theme name or version reset readiness. Theme, plugin or CSS changes can slip past these checks, so inspect again after every deployment. Inspection reports are evidence for the administrator to review, not proof or authorization. There is no unrestricted click, no custom selector import and no arbitrary PHP or JavaScript execution.

## Adapters

By default only the three accessibility controls are on:

- **Heading color:** visible, non-private headings inside the approved content root, checked by computed color. Body text is not changed.
- **Link highlighting:** visible public links, checked by class and computed outline.
- **Font weight:** the content root's computed weight. Theme styles on descendants can override it. Private regions may inherit the style even though they are not observed.

You can opt in to more:

- **Navigation:** exact approved same-origin page URLs. The conversation continues once on the new page, without replaying actions, and needs browser session storage. The assistant confirms arrival first, then runs any remaining requested actions on the destination.
- **`page.read`, `page.scroll_to` and `page.highlight`:** limited to the approved content root (scope `content`). After selecting them, rerun the inspection on every selected page, review consent and enable them explicitly. Inspection uploads counts and verified IDs, not article text.

Actions are shown on the page with a cursor and outline, with optional motion. See [assistant driving](../../docs/assistant-driving.md) for what custom controls can and can't do. Third-party accessibility UI, Rive assets and cloud text-to-speech are not bundled.

Supported content roots are `main`, `#content`, `#primary`, `.wp-site-blocks` and `[data-pagesquire-content]`. A missing or ambiguous root fails closed. Only the currently visible desktop state is inspected. Classic and core block themes are tested with fixtures. Modals, hidden or mobile states, multilingual plugins, Elementor, WooCommerce and third-party accessibility panels are **not tested**, and other themes may not work.

Visual changes apply to the current page only, not to saved WordPress or theme settings, so a reload resets them.

The assistant emits six emotion states as `pagesquire:emotion` events (`idle`, `happy`, `sad`, `thinking`, `confused`, `hover`). Loading uses `thinking`. Bring your own licensed mascot or Rive asset.

The widget shows [action progress](../../docs/action-progress.md): the real stages, fixed recovery guidance and a short history kept only in memory. Custom browser integrations can also send [public app context](../../docs/app-context.md). The default widget doesn't collect app state, and context never grants WordPress permissions. Deploy matching browser and PHP schemas before opting in.

## Privacy

Exports contain the selected public titles and URLs, block names and structure (bounded), the theme and version, counts, mappings and gaps. They never contain post bodies, HTML, block attributes, database dumps, private or password-protected posts, users, form values, credentials, source code or transcripts. Check the titles and URLs before sharing an export.

During chat, filtered visible text, link and control labels, messages and selected metadata are sent to the configured provider. The `data-pagesquire-private` marker hides content from observation but is not access control. Don't enable the assistant on sensitive pages.

## Security

- REST administration requires `manage_options` and a valid WordPress REST nonce.
- Cookie-based chat also uses the WordPress nonce, signed HttpOnly SameSite cookies, a separate session CSRF token and exact Origin checks.
- Nonces do **not** authorize anonymous visitors or prevent abuse. Turning on public access deliberately opens the service to strangers.
- PHP HTTP requests use WordPress's safe HTTPS client with no redirects and bounded responses. Never point the provider at a private or internal address.

## Limits and caching

State is checkpointed to non-autoloaded options before each inference. Global limits:

- 60 requests per minute, and 30 per source IP per minute;
- 1,000 live sessions;
- 1–1,000 provider attempts per UTC day (default 100, failures included).

IP addresses are stored as salted hashes, and forwarded-IP headers are not trusted. These limits are not spending caps, and visitors behind a reverse proxy may share one IP. Add host or WAF controls and provider spending limits.

Exclude the selected pages and the `/pagesquire/v1/` REST responses from full-page and CDN caching. A cached logged-in nonce must never be served to someone else.

## Retention and recovery

Expired session records are removed by later traffic, two minutes after they expire; on an idle site they stay until traffic resumes. Disabling or deactivating the plugin keeps settings, encrypted keys and pending state. To uninstall for good, back up and then delete the `pagesquire_` options with your usual database tools.

Locks are stored as options. If a worker is killed, its lock stays and requests fail closed; stale locks are never taken over automatically. To recover:

1. Disable the plugin and stop or drain **all** assistant PHP workers.
2. Back up the database.
3. Remove only the stranded `pagesquire_state_<sha256>_lock` options with a trusted database tool.
4. Check the provider-attempt counts before restarting. Don't delete budget records to get around quotas.

Use a single writable WordPress database and a consistent object cache. Multisite, network activation and database failover are not tested.

## PageSquire Link (partner sites)

Step 6 of the dashboard pairs this site with another owner's PageSquire site, on WordPress or any other stack ([PageSquire Link](../../docs/link.md#using-link-phase-6a)). It is off by default and needs WordPress at the root of an HTTPS domain.

- **Enabling** creates a site key once, encrypted with the auth salt in the non-autoloaded `pagesquire_site_key` option. To manage the key yourself, define `PAGESQUIRE_SIGNING_KEY` (from `npx pagesquire signing-key`) in `wp-config.php`. The plugin then serves `/.well-known/pagesquire.json` with the public key, the site name and the skills you list.
- **Pairing.** Create an invitation and send it to the partner owner over a channel you trust, or paste theirs. Then approve which partner skills to offer, with their fields, and which of your skills the partner may use. Either owner can revoke at any time.
- **Partner messages** arrive at the public REST route `pagesquire/v1/link`. They are Ed25519-signed, checked against the partner's own declaration, limited to 60 per source IP per minute and stored in the non-autoloaded `pagesquire_links` option.
- **Outbound requests** to partners use the WordPress HTTP API with no redirects and bounded time and size. HTTPS partners pass WordPress's unsafe-URL checks.

While Link is enabled, the assistant can offer an approved partner skill:

- The visitor sees the partner, its origin, the goal and every field before anything is sent, and the partner opens in a new tab.
- A visitor sent here by a partner sees a banner and continues with one click. A partner's `startPath` must be one of the approved public pages.
- When the partner is done, its assistant can send the visitor back with a one-line outcome, once the visitor approves.
- When several partners offer the same skill, the visitor chooses which one to continue on.

The panel's overview lists the partner services your assistant may offer and which partners may use your skills. Each partner card shows how many visitors went each way, per skill.

**Let AI agents send requests (A2A)** opens chosen skills to any A2A agent ([A2A interface](../../docs/link.md#a2a-interface-phase-6e)). The plugin then publishes a signed Agent Card at `/.well-known/agent-card.json`. An agent only receives a single-use link: the visitor opens it, continues on this site and confirms there.

## Read-only WordPress Abilities

On WordPress 6.9+ you can offer administrator-selected abilities that are annotated `readonly`. Add the `wordpress.run_ability` adapter to the mapping and select the abilities in the dashboard. They run on the server with the visitor's own permissions, through a route protected by session, CSRF and quota checks. Writable abilities are never listed or run. See [WebMCP, approvals and WordPress Abilities](../../docs/webmcp-and-approval.md).

## Development

From the repository root: `npm ci`, `composer install`, `npm run build`, `npm run build:wordpress`. The build downloads a pinned, SHA-256-verified PHP-Scoper into the ignored `.cache/` folder. Bundled dependencies get their own namespace so they don't clash with other plugins.

`npm run test:wordpress` runs an isolated WordPress/SQLite fixture. It downloads pinned official releases of WordPress 7.1.3, SQLite Database Integration 3.1.0 and verified WP-CLI 2.12.0, installs the real ZIP and uses only synthetic accounts and content. Never deploy `examples/wordpress` or the test fixture. Because the tests use WordPress's official SQLite layer, check a real MySQL or MariaDB host, your object cache setup and multiple workers in your own deployment.

Locks are taken with a prepared `INSERT IGNORE` on WordPress's unique option-name index, read directly from the database (not from negative option caches) and deleted only with the owner's token. Don't replace this with `add_option()`, which updates on duplicate keys.

## License

The plugin is GPL-3.0-or-later. The shared PageSquire packages it bundles are MIT. The nested `corresponding-source.zip` holds the editable project with its build and test sources; extract it outside the web root to rebuild. Plugin and shared library sources, source maps and license notices are in the repository and the distribution. See [THIRD-PARTY.md](THIRD-PARTY.md) and the included licenses.
