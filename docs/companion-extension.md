# Companion extension

The companion extension is an optional Chromium extension that gives PageSquire real (trusted) input and lets it work beyond the single page.

**Status: development build.** The [development build](#development-build-4d-1-to-4d-5) runs only calls signed by the site's server, and only on local and `.test` sites. It reads and acts in the [cross-origin frames](#frames-4d-3) a site declares and in [other tabs](#tabs-4d-4) of the session. With the consent of both the site owner and the visitor, it takes [redacted screenshots](#screenshots-4d-5) for visual checks. A [spike](#spike-results-4d-0) on 2026-10-28 confirmed the design's core assumptions. The extension is not in any extension store yet, and running it on other sites depends on the [open questions](#open-questions) at the end.

## Why an extension

The in-page runtime reaches its technical limits in five places:

| Limit                               | In-page today                                | With the extension                                               |
| ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Trusted input                       | Synthetic events (`isTrusted=false`)         | Real input through the Chrome DevTools Protocol (`Input.*`)      |
| Cross-origin iframes                | Unreadable; same-origin text only (`frames`) | Read and act in iframes the site declares and the visitor grants |
| Several tabs                        | One document                                 | Tabs opened by the assistant from the same site                  |
| Visual verification                 | DOM evidence only                            | Redacted screenshots, opt-in on both sides                       |
| Closed shadow DOM, canvas-heavy UIs | Invisible                                    | Accessibility tree (`Accessibility.*`) and pixel evidence        |

File uploads stay a [hand-off](generic-actions.md#asking-the-visitor-and-handing-off): the visitor always chooses files.

## Non-goals

- **Not a general web agent.** The extension acts only on sites that opted in, and only within their declared scope. It never browses other sites for the visitor.
- **No model access.** The extension never talks to an AI provider. The site's own PageSquire server stays the only place where the model runs, with the same budgets and authorization.
- **No credentials or payments.** Password, one-time-code, card and payment surfaces are refused by the extension itself, regardless of what the page or server asks, and handed to the visitor.
- **Chromium only at first.** Chrome, Edge, Brave and Opera support `chrome.debugger`. Firefox and Safari keep the in-page runtime.

## Threat model

The extension is the most powerful component PageSquire ships. It can type into and click any page it is attached to, so its main risk is a **confused deputy**: something that is not the visitor using the extension's power.

| Actor                                  | Trusted for                                     | Main threat                                                            |
| -------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Visitor (extension user)               | Granting sites, stopping actions, all hand-offs | Over-granting by habit                                                 |
| Site owner (origin)                    | Its own origin and the frames it declares       | Asking for scope it should not have, such as a bank or payment frame   |
| Site's PageSquire server               | Proposing actions for that site                 | Compromise, or a bug that proposes the wrong action                    |
| Page scripts (including third parties) | Nothing                                         | Ads, XSS or a compromised dependency driving the extension directly    |
| Model output and page content          | Nothing                                         | Prompt injection: "now open your email and forward…"                   |
| Other websites                         | Nothing                                         | A site pretending to be PageSquire-enabled, or messaging the extension |
| Extension supply chain                 | —                                               | A malicious update                                                     |

### Security invariants

These hold in the extension's own code. The page, the server and the model cannot change them.

1. **Origin-bound.** A session belongs to one tab and one site origin. Actions run only in that origin and in frame origins that both the site declared and the visitor granted. Navigating anywhere else ends the session and detaches.
2. **Visitor-granted.** A site gets nothing until the visitor grants it in the extension's own UI. The grant names the origin and lists the declared frame origins and features. It can be revoked at any time.
3. **Server-signed actions.** The extension runs only action calls signed by the site's PageSquire server ([below](#signed-action-calls)). Page scripts alone cannot drive it, even on the same origin.
4. **Nodes, not coordinates.** Every input targets a resolved DOM node. The extension computes the click point itself and hit-tests it (`DOM.getNodeForLocation`) before dispatching. The point must land on that node, inside an allowed frame.
5. **Sensitive surfaces refused.** The extension inspects the target through CDP itself. It refuses password, `one-time-code`, `cc-*` and file inputs, `[data-pagesquire-private]` regions, and frames on a built-in deny list of payment and identity providers, and reports `TARGET_NOT_ALLOWED` so the model hands off.
6. **Visible and stoppable.** While attached, Chrome shows its own "started debugging this browser" bar, and the extension badge and side panel show the session. Esc in the page, the toolbar button or the side panel's Stop button detaches immediately.
7. **Least privilege, no remote code.** Manifest V3, no remotely hosted code, and no network access except fetching a site's well-known manifest. Host access is optional and requested per site.

## Architecture

```text
 Page (site origin)                     Extension
 ┌──────────────────────────┐   post-   ┌───────────────────────┐  runtime   ┌──────────────────────────┐
 │ BrowserRuntime            │  Message  │ Content script         │  messages  │ Service worker            │
 │  └ CdpDriver (bridge) ────┼──────────►│  handshake, relay,     ├───────────►│  policy engine            │
 │ AssistantClient ──► site  │◄──────────┤  nonce-tagged targets  │◄───────────┤  signature check          │
 │   PageSquire server       │           └───────────────────────┘            │  chrome.debugger session  │
 └──────────────────────────┘                                                 │  audit log, kill switch   │
                                                                               └────────────┬─────────────┘
                                                                                            │ CDP (flat sessions)
                                                                                 tab, OOPIF child sessions
```

### Page side (`@pagesquire/core`)

- **A driver seam.** Generic tools take an optional `InputDriver` with `click`, `type` and `pressKey`. Each method delivers the input and resolves true, or resolves false to let the built-in synthetic events run. `createCompanionDriver()` forwards to the extension when it is present and granted. The driver also has frame, tab and screenshot methods, described below.
- **Same semantics.** Capabilities, schemas, verification and the server engine do not change. Actionability, approvals and settling still run in the page. The driver only changes how input is delivered. Verifiers still check postconditions from the DOM.
- **Detection.** The page posts a `pagesquire:hello` message carrying a `MessagePort`, and waits up to 400 ms for a versioned answer on that port. Other frames cannot listen in. Without an answer, the synthetic events run, so the page works the same without the extension. A content script injected later announces itself, so a site allowed mid-visit needs no reload.

### Locating targets

The page resolves a `target-N` ID to an element, as today. It then tags the element with a one-time attribute, `data-pagesquire-target="<nonce>"`, for the duration of one call.

The extension resolves the nonce through `DOM.querySelector`, scrolls the node into view (`DOM.scrollIntoViewIfNeeded`) and reads its content quads. It checks invariants 4 and 5, then dispatches input. A page cannot point the extension at a different element than the one that carries the nonce.

In granted cross-origin frames and in other session tabs, the extension's remote script resolves that document's own target ID and tags it the same way, because the page cannot reach into it.

### Service worker

- **Policy engine.** It holds grants, the site's well-known manifest, the frame allow and deny lists, and per-session limits such as actions per minute and session length.
- **Debugger session.** It attaches on the first action of a turn and detaches after 30 seconds without actions, or at once when the visitor stops. The debugging bar takes height from the viewport, so detaching after every turn would make the page jump (see the [spike results](#spike-results-4d-0)). Cross-origin frames are reached through `Target.setAutoAttach` with `flatten: true` and `DebuggerSession.sessionId` (Chrome 125 or newer). Auto-attach is not recursive, so the worker repeats it in each child session.
- **Scope watch.** Chrome keeps the debugger attached when the tab navigates to another origin. The worker therefore watches `Target.targetInfoChanged` and navigation events, detaches when the tab or a frame leaves the granted scope, and rechecks the target's origin right before each dispatch.
- **State.** The worker keeps grants and the active session in `chrome.storage.session`. An attached debugger keeps the worker running, but it can still be restarted after a detach.
- **Audit log.** It keeps a local, redacted log of what ran where, viewable in the side panel. It is never uploaded.

### Site declaration

The site serves `/.well-known/pagesquire.json` over HTTPS from its own origin:

```json
{
  "version": 1,
  "endpoint": "/pagesquire/chat",
  "publicKey": "ed25519:BASE64...",
  "frames": ["https://maps.example-partner.com"],
  "features": ["trustedInput", "frames", "tabs"]
}
```

The file is origin-bound, so it needs no further signature. Frame origins on the deny list (payment, identity and banking providers) are rejected even when declared. The grant screen shows the remaining list to the visitor.

### Signed action calls

With signing configured, the server engine adds an optional `signature` to every `ActionCall` it proposes:

```json
{
  "claims": "{\"v\":1,\"origin\":\"https://shop.example\",\"callId\":\"…\",\"capabilityId\":\"ui.type\",\"snapshotId\":\"…\",\"parameters\":{…},\"iat\":1830000000,\"exp\":1830000060}",
  "value": "base64 Ed25519 signature over \"pagesquire-call-v1.\" + claims"
}
```

- **Claims are sent as text.** The server writes `claims` once and signs those exact bytes, so Node, PHP and the extension never need to agree on a JSON canonical form. Both servers produce identical signatures for the same claims (`tests/fixtures/signing.json`).
- **What the extension checks.** The signature verifies with the declared `publicKey`, using WebCrypto Ed25519 (Chrome 137 or newer). The claims name the exact granted origin. The input matches the claims: `ui.click` and `ui.check` become a click, `ui.type` only the signed `text`, and `ui.press_key` only the signed `key`. The call is valid for 60 seconds, with two minutes of clock tolerance either way.
- **Single use.** The extension accepts each call ID once per browser session, across tabs and worker restarts.
- **Key rotation.** After a failed signature, the extension re-reads the declaration at most once a minute. A changed key replaces the stored one for that granted origin.
- **Errors.** `UNSIGNED`, `BAD_SIGNATURE`, `MISMATCH`, `EXPIRED` and `REPLAYED` are audited and reach the page as `ACTION_FAILED`. Calls the server did not sign never reach the extension: the page driver keeps synthetic events for them.
- **The runtime ignores it.** `signature` is opaque to the page runtime and the client. Update browser bundles before you turn on signing, because older ones reject the new field.

Scripts on the page can see a signed call, but they cannot forge one, change its text or key, reuse it, or use it on another origin. **Limit:** the signature does not bind _which element_ receives a signed click. A same-origin script could move the target nonce to another element in the main frame. Same-origin scripts can already act on the page directly, so this does not grant them anything new beyond the `isTrusted` flag. Binding the target's accessible name and role is a possible later hardening.

## Features in detail

- **Trusted input.** `Input.dispatchMouseEvent` (move, press, release) at the checked point, `Input.insertText` and `Input.dispatchKeyEvent`. The existing actionability and settle checks still run in the page first.
- **Cross-origin frames.** Frames get frame-scoped target IDs (`frame1-target-3`) in an optional `frames` snapshot field. A content script reads them with the page's own observer and exclusion rules ([details](#frames-4d-3)). Only granted frame origins appear.
- **Tabs.** Only tabs that the session's page opened on its own origin, or that the visitor shares from the side panel, join the session. They are placed in a labelled tab group. A new `ui.switch_tab` tool shows a tab to the visitor, and each tab follows invariant 1 ([details](#tabs-4d-4)).
- **Screenshots.** `Page.captureScreenshot` of a tab in the session. The extension paints over form fields, private regions and frames before the image leaves it. Screenshots go to the site's server only when both the owner (`features: ["screenshots"]`) and the visitor enabled them. They are off by default ([details](#screenshots-4d-5)).

## Alternatives considered

| Option                                   | Why not (as the primary path)                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Content scripts only, without `debugger` | Can read granted cross-origin frames, but input stays synthetic. Kept as the reading path, see below.  |
| Native messaging to a local Playwright   | A second install, OS-specific, and much heavier for visitors                                           |
| Server-side cloud browser                | Cannot act in the visitor's own logged-in session, and moves their page data off the device            |
| `externally_connectable`                 | Needs every site listed at build time. A runtime grant plus a content-script handshake scales instead. |

Content scripts injected into granted frame origins (`chrome.scripting`, `allFrames`) read frames instead of CDP. The spike showed that Chrome only injects them into frame origins the extension has host access to, which matches the grant model. CDP's accessibility tree reads any attached frame regardless of host access, so it is not used for reading. This limits `debugger` to input, hit-testing and screenshots.

## Spike results (4D-0)

The spike ran on 2026-10-28 with Chromium 156 (Playwright 1.64) on Windows 11. It used a throwaway extension in [`tests/spike/extension`](../tests/spike/extension) with no grants or signatures. The fixture pages ran on three loopback sites: the page on `127.0.0.1`, a partner frame on `localhost` and a nested frame on `[::1]`. Site isolation put each frame in its own process.

| Question                          | Result                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted input in the main frame   | Yes. Click, `Input.insertText` and Enter arrive with `isTrusted=true`, including on a target below the fold.                                                                                                                           |
| React 19 controlled input         | Works. One `input` event carries the whole text, and the component's own transform (upper-casing) wins.                                                                                                                                |
| Vue 3.5 `v-model`                 | Works. The model updates, and click handlers see trusted events.                                                                                                                                                                       |
| Cross-origin and nested frames    | Work. Child sessions for both frames are ready 40–80 ms after attach. Clicks go to the top-level session at the summed frame offsets. Text goes there too, after `DOM.focus` in the frame's session.                                   |
| Hit-testing                       | Works. A covered button and a covered frame owner are both refused. See the coordinate finding below.                                                                                                                                  |
| Sensitive targets                 | Password, `one-time-code` and private-region targets are refused from CDP's own view of the node, before any input.                                                                                                                    |
| Page access to the extension      | Page scripts have no `chrome.runtime`. The only channel is the content script's `postMessage` relay, which any same-origin script can use. That is why signed calls (invariant 3) are needed.                                          |
| Latency                           | Attach takes 4–6 ms. A click from the page and back takes 29 ms at the median and 30–37 ms at p95, about 15 ms of it in the worker. An in-page synthetic click takes under 0.1 ms. A cold attach plus the first click takes 64–111 ms. |
| Service-worker lifetime           | With an attached debugger, the worker survived 45 idle seconds. A control without a debugger was restarted in the same time.                                                                                                           |
| Debugging bar                     | Appears about 170 ms after attach and took 56 px of viewport height. Chrome keeps it about 6 s after a detach, so turns closer together than that do not flicker: four quick turns caused one resize.                                  |
| Debugger after leaving the origin | Stays attached. Chrome does not enforce invariant 1, so the extension must.                                                                                                                                                            |

### Findings that change the design

1. **Two coordinate spaces.** Content quads, box models and `Input.*` use viewport coordinates. `DOM.getNodeForLocation` takes document coordinates and only finds visible nodes. The hit test adds each document's scroll offset from `Page.getLayoutMetrics`. That value comes from the renderer, so page scripts cannot fake it.
2. **The debugger ignores host access.** CDP read the accessibility tree of the `[::1]` frame without host permission for it, while `chrome.scripting` skipped that frame. Frame grants are therefore enforced in the extension's own code, and frames are read through content scripts.
3. **Chrome does not keep the scope.** The debugger survived a navigation to another origin, so the worker adds the scope watch described above.
4. **Attach lifetime.** Attaching shrinks the viewport, which fires one `resize` and can move targets. The worker attaches on the first action of a turn and waits up to 300 ms for the resize to settle before it locates the target. It then waits 30 s without actions before detaching.
5. **Dispatch dominates latency.** The three awaited mouse events take about 60% of the worker time. Commands on one session stay in order, so they can be sent without awaiting each one.

### Not covered by the spike

- Closed shadow DOM, canvas UIs, screenshots and multiple tabs. Screenshots and tabs were added later in the development build.
- Chrome, Edge and Brave builds. Branded Chrome no longer accepts `--load-extension`, so automated tests use Chromium. Installing from a store is not affected.
- Service-worker lifetime beyond 45 seconds, and how the bar looks on macOS and Linux.

### Running it

```bash
npx playwright test --config tests/spike/playwright.config.mjs
```

- **Headed bar check.** Set `SPIKE_HEADED=1`. It opens a browser window.
- **Vue check.** Set `SPIKE_VUE_DIR` to a folder with Vue installed. Vue is not a workspace dependency.
- **Lifetime check.** Takes about a minute. It launches Chromium without Playwright, because DevTools attached to a service worker keeps the worker alive by itself.

Measurements are written to `test-results/spike/measurements.jsonl`.

## Development build (4D-1 to 4D-5)

The extension lives in [`packages/extension`](../packages/extension). It runs only on `localhost`, `127.0.0.1`, `*.localhost` and `*.test` sites, over HTTP or HTTPS. Its manifest grants host access to exactly those hosts and nothing else.

### Trying it

1. Run `npm run build`, which also bundles the remote script (frames and tabs) into `packages/extension/dist`. Then, in Chrome, Edge or Brave (version 137 or newer), open the extensions page, turn on developer mode and load `packages/extension` unpacked.
2. Create a signing key with `npx pagesquire signing-key`. Keep `signingKey` as a server secret, like an API key, and never send it to a browser.
3. Turn on signing on the server for your site's origin:

   | Server     | Setting                                                                                                    |
   | ---------- | ---------------------------------------------------------------------------------------------------------- |
   | Node       | `new ConversationEngine({ …, signing: { key, origin: 'http://shop.test' } })`                              |
   | Native PHP | `new ConversationEngine(…, signer: new ActionSigner($key, 'http://shop.test'))`                            |
   | Laravel    | `PAGESQUIRE_SIGNING_KEY=…`. The origin defaults to `APP_URL`'s; override it with `PAGESQUIRE_SITE_ORIGIN`. |

4. Serve the declaration at `/.well-known/pagesquire.json`. Laravel serves it automatically when the key is set. In Node, return `siteDeclaration({ endpoint, signingKey })`; in PHP, `$signer->declaration('/pagesquire/chat')`:

   ```json
   {
     "version": 1,
     "endpoint": "/pagesquire/chat",
     "publicKey": "ed25519:…",
     "features": ["trustedInput"]
   }
   ```

5. Add `data-companion="true"` next to `data-generic="true"` on the embed script. Without the embed, pass the driver yourself:

   ```js
   import {
     createCompanionDriver,
     createGenericBindings,
   } from '@pagesquire/core';

   const generic = createGenericBindings({ driver: createCompanionDriver() });
   ```

6. Open the site, click the extension's toolbar button to open its side panel, check what the site declares and choose **Allow on this site**.

### What it does

- **Input.** `ui.click`, `ui.check`, `ui.type` and `ui.press_key` (except Escape) arrive as trusted input. `ui.select`, `ui.hover` and `ui.scroll` keep synthetic events.
- **Signed calls only.** The extension runs only calls the site's server signed ([details](#signed-action-calls)). A declaration without a `publicKey` cannot be allowed.
- **Synthetic fallback.** The page keeps its own synthetic events in these cases:
  - without the extension, or before the visitor allows the site;
  - for unsigned calls, or after Stop;
  - for targets in shadow roots or frames;
  - for inputs without a selection API, such as `type="email"`.
- **The extension's own checks.** It resolves the one node carrying the page's nonce and refuses password, file, one-time-code, card and `data-pagesquire-private` targets. Before a click, it hit-tests its own click point. It types only into editable fields. Before each dispatch, it checks that the tab is still on the granted origin. Each tab runs one action at a time, with at most 60 per minute.
- **Stopping.** Esc in the page while the assistant is acting, the side panel's **Stop**, or **Cancel** on Chrome's debugging bar detaches at once. The tab then stays stopped, and the page uses its own input, until the visitor chooses **Resume**. A page reload does not resume it, so page scripts cannot undo a stop.
- **Debugger lifetime.** It attaches on the first action and waits for the debugging bar to settle. It detaches after 30 seconds without actions, or when the tab navigates to another origin.
- **Grants.** Only the visitor grants, in the side panel, for one exact origin. A grant registers the relay for that host. The worker still checks the exact origin, so another port on the same host gets no answer. **Revoke** removes it.
- **Audit log.** The side panel lists recent actions with their time, kind, origin and result. It never keeps typed text or targets, and it is cleared when the browser closes.

### Frames (4D-3)

A site lists the frame origins it embeds in its declaration, for example `"frames": ["http://maps.test"]`. The side panel shows them before the visitor allows the site. The development build accepts only local and `.test` frame origins. It always refuses frames of payment, sign-in and banking providers, even when declared. Changing the list needs a new grant.

- **Reading.** A content script runs only in granted frame origins, and only when the tab's page declared that frame and is allowed. It reads the frame with the same observer the page uses:
  - up to 4,000 characters of text and 100 targets per frame, and at most 5 frames;
  - never field values, password fields or `data-pagesquire-private` regions.

  The page receives them as `snapshot.frames`, with target IDs such as `frame1-target-3`. Frames the site did not declare are never read.

- **Acting.** `ui.click`, `ui.check`, `ui.type` and `ui.press_key` work on frame targets. `ui.select`, `ui.hover`, `ui.scroll` and Escape answer `UNSUPPORTED_TARGET`. One action runs like this:
  1. The frame resolves its own target and applies the built-in risk tiers. A host `risk` callback cannot see inside the frame.
  2. The page asks for approval when the tier needs it.
  3. The frame tags the target.
  4. The worker finds the tag in that frame's own CDP session and hit-tests through every frame owner. It then sends the input at the top level.
  5. The frame reports what changed, so the result is verified as on the page. Typed text is reported only as "arrived" and a length, never as the value.
- **Signatures bind the target.** The frame resolves the signed target ID itself. So in frames a signed call can reach only the element the server signed for, which closes the main-page limit described above.
- **No fallback.** The page cannot reach into a cross-origin frame. Without the extension, unsigned or after Stop, frame targets fail instead of falling back to synthetic events. Stop also hides frames from snapshots until Resume. Esc inside a granted frame stops like Esc on the page.
- **Limits.**
  - Only frames in their own process (cross-site, the default on desktop) can be driven.
  - Links inside frames stay with the visitor.
  - `ui.find` and the trajectory cache cover page targets only.
  - Reading sends the frame's visible text to the site's server. That is why both the site's declaration and the visitor's grant are required.

### Tabs (4D-4)

The page with the chat controls its session and is `tab1`. Other tabs of the same origin join as `tab2` to `tab5` in two ways:

- **The page opened them.** For example with `window.open` or a link with `target="_blank"`. The new page must confirm it, through `window.opener` or a same-origin referrer, because Chrome also names an opener for tabs the visitor opens by hand.
- **The visitor shared them.** **Share this tab with the assistant** in the side panel adds the tab to the session of the most recent page with the same origin. **Stop sharing this tab** removes it.

Joined tabs are placed in a tab group labelled "PageSquire". A tab leaves the session when it is closed, navigates to another origin, or the visitor stops sharing it.

- **Reading.** The same remote script that reads frames reads each tab: up to 4,000 characters and 100 targets, never field values. The page receives the tabs as `snapshot.tabs`, with the origin and path only (no query or fragment), whether the visitor is looking at that tab, and target IDs such as `tab2-target-3`.
- **Acting.** Tab targets work like frame targets, through the same driver calls, with the same tools, risk tiers, signature binding and verification. The extension attaches its debugger to that tab and sends the input there, without bringing the tab to the front.
- **Showing a tab.** `ui.switch_tab` brings `tab1` or a member tab to the front. It is a signed call like any other, and its description tells the model to switch back to `tab1` before finishing. While another tab is in front, the chat page keeps working: generic tools no longer wait for animation frames in a hidden page.
- **Stopping.** Stop or Esc in any tab of the session stops the whole session and detaches from every tab in it.
- **Limits.**
  - Only same-origin tabs can join.
  - At most four other tabs.
  - Tabs of other windows can be shared, but the tab group holds tabs of one window.

### Screenshots (4D-5)

The `ui.screenshot` tool lets the model check something the page text cannot confirm, such as a layout, a chart or a colour. It is off unless all of these are true:

| Who        | Turns it on                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site owner | Declares `"features": ["trustedInput", "screenshots"]`, adds `ui.screenshot` (`createScreenshotCapabilities()`, or `data-screenshots="true"` on the embed) |
| Server     | `screenshots: true` on the Node engine, `screenshots: true` on the PHP engine, or `PAGESQUIRE_SCREENSHOTS=true` in Laravel, with a model that reads images |
| Visitor    | **Allow redacted screenshots of this site** in the side panel, off by default and revocable at any time                                                    |

- **Redaction in the extension.** Before the image leaves the extension, it is painted black over:
  - every form field (`input` except buttons, checkboxes, radios and similar controls; `textarea`, `select`, editable content);
  - `data-pagesquire-private` regions;
  - all frames, embeds and objects, including those in open shadow roots.

  The boxes are measured in an isolated world, which page scripts cannot change, both before and after the capture. They are then drawn onto the image inside the extension. So typed values never leave in a picture, just as they never leave in snapshots.

- **Size.** Only the visible part of the tab is captured. It is re-encoded as a JPEG no wider than 1,024 pixels, and the base64 text is at most 100,000 characters.
- **Once, never stored.** The result carries the image in an optional `ActionResult.screenshot`. The engine adds it as an OpenAI-compatible `image_url` part to the next provider call only, and marks the stored result `screenshotShown`. Conversation state never holds image data. Engines without `screenshots` drop images.
- **Signed like any action.** The signature names the tab (`tab1` is the page itself). Refusals reach the page as `ACTION_FAILED`: the extension answers `SCREENSHOTS_OFF` when the site or the visitor has not allowed screenshots.
- **Limits.**
  - Visible text outside form fields stays readable, as it is in snapshots.
  - Closed shadow roots cannot be measured.
  - Screenshots of a tab in the background may need `ui.switch_tab` first in some browsers.

### Wire format

| Direction    | Message                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page → relay | `window.postMessage({ type: 'pagesquire:hello', version: 1 }, origin, [port])`                                                                                                               |
| Relay → page | On the port, at once: `{ type: 'pagesquire:hello-wait' }`. The page then waits up to its call timeout instead of 400 ms, so a waking service worker is not mistaken for a missing extension. |
| Relay → page | On the port: `{ type: 'pagesquire:hello-ack', version: 1, features }` or `{ type: 'pagesquire:hello-nack' }`                                                                                 |
| Page → relay | On the port: `{ id, op: 'act', args: { kind, nonce, text?, key?, signature } }`, `kind` is `click`, `type` or `key`                                                                          |
| Page → relay | For frame targets: `act` with `{ kind, frame, target, text?, clear?, key?, signature }` instead of a nonce, and `{ id, op: 'frame-inspect', args: { frame, target, action } }`               |
| Page → relay | For a screenshot: `act` with `{ kind: 'screenshot', tab, signature }`; the answer carries `screenshot`                                                                                       |
| Page → relay | For tab targets the same, with `frame: 'tab2'`; to show a tab, `act` with `{ kind: 'switch', tab, signature }`                                                                               |
| Relay → page | On the port: `{ type: 'pagesquire:frames', frames }` whenever a granted frame changes, and `{ type: 'pagesquire:tabs', tabs }` whenever a session tab changes                                |
| Relay → page | On the port: `{ id, ok, code?, info?, effect? }`                                                                                                                                             |

Error codes map to runtime codes:

| Extension code       | Runtime code         |
| -------------------- | -------------------- |
| `OBSCURED`           | `TARGET_COVERED`     |
| `NOT_VISIBLE`        | `TARGET_HIDDEN`      |
| `TARGET_MISSING`     | `TARGET_MISSING`     |
| `TARGET_NOT_ALLOWED` | `TARGET_NOT_ALLOWED` |
| `STOPPED`            | `VISITOR_DECLINED`   |
| `UNAVAILABLE`        | Synthetic fallback   |
| Anything else        | `ACTION_FAILED`      |

Any same-origin script can use this channel, but only with calls the server signed.

### Tests

`npm run test:extension` loads the unpacked extension into Chromium. Playwright uses a persistent context (`--load-extension`, headless supported) and reaches the service worker through `context.serviceWorkers()`. The tests cover:

- the synthetic fallback before a grant and after a revoke;
- trusted click, text and Tab after a grant;
- refusals sent straight through the page channel, skipping the page's own checks;
- unsigned, forged, other-origin, altered, expired and replayed calls;
- a password field as the target;
- reading and acting in a declared cross-origin frame with trusted input;
- signatures bound to frame targets;
- refusing undeclared frames and denied providers, including a click redirected into a denied frame;
- hiding frames after Stop;
- a tab the page opens joining the session, read and acted in with trusted input, and shown with `ui.switch_tab`;
- sharing and unsharing a tab, and a tab leaving when it changes origin;
- signatures bound to tab targets and switches, and Esc in a member tab stopping the session;
- screenshots refused until the visitor allows them, and form fields black in the captured image (checked pixel by pixel);
- screenshots never offered or taken on a site that does not declare them;
- Esc, Stop and Resume;
- the idle and out-of-origin detach;
- another port on the same host;
- a site with an invalid declaration.

Unit tests cover the policy module, the page driver and signing. The Node and PHP tests share one Ed25519 test vector, so all three implementations must agree byte for byte.

## Protocol changes

| Feature                                                                | Protocol change                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| Grants, site declaration, stop switch, side panel, main-frame input    | None                                                |
| Signed action calls (Node and PHP engines, Laravel config, CLI key)    | Optional `ActionCall.signature`                     |
| Declared cross-origin frames                                           | Optional `PageSnapshot.frames`                      |
| Same-origin tabs the page opens or the visitor shares                  | Optional `PageSnapshot.tabs`, `ui.switch_tab`       |
| Redacted screenshots, off by default for the owner, server and visitor | Optional `ActionResult.screenshot`, `ui.screenshot` |

## Open questions

- **Distribution.** A Chrome Web Store listing needs a developer account, a privacy policy and a justification for the `debugger` permission, which gets a closer review. Edge Add-ons is optional.
- **Name and branding.** The extension's final name and branding are not settled.
- **WordPress.** Whether the plugin should serve the well-known declaration with one click.
