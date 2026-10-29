# Assistant driving and feature parity

These helpers let the assistant visibly drive the page: move a cursor, scroll, prepare menus, set controls, read content, give tours and speak answers. They do not grant permission to operate any control. They use the same browser core in plain HTML and PHP, Laravel with Inertia, React and Next.js, and WordPress. The APIs may still change.

## Behaviors and how to build them

| Behavior                                                                                                                      | PageSquire integration                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Moving cursor, target outline, click feedback                                                                                 | `BrowserDriver` and the client stylesheet. Presentation never clicks anything or grants permission.                                                                                  |
| Scrolling, including nested containers                                                                                        | `driver.scrollTo(target, signal, 'start' or 'end')`; `page.scroll_to` uses a declared public scope.                                                                                  |
| Preparing menus, dropdowns and accessibility panels                                                                           | `prepare` callbacks you write in `createControlBindings`; explicit, cooperative steps only.                                                                                          |
| Native color, range, text, select and button controls                                                                         | `createControlBindings` and `setControlValue`, with required desired-state verification and no blind repeated toggles.                                                               |
| Heading/body colors, heading/link highlighting, font weight/size, spacing, alignment and contrast                             | Bind the site's actual controls with separate closed schemas and verifiers that check computed state. A capability's name alone does not make it available.                          |
| Reading fonts, images/tooltips, masks/guides, focus, magnification, cursor sizes, virtual keyboard and accessibility profiles | The same host-control binding contract. PageSquire does not bundle an accessibility engine or make claims about what a profile does for users.                                       |
| Open a page or article and continue                                                                                           | The document checkpoint, the Inertia adapter or the Next.js adapter (after the destination reports it is ready). Keep the rest of the user's goal after a verified arrival.          |
| Scan, read and summarize                                                                                                      | `createPageCapabilities` / `createPageBindings`: public scope, bounded offsets, private exclusions and explicit truncation evidence. Scrolling past text does not prove it was read. |
| Guided highlight tour                                                                                                         | `GuidedTour`: resolvers and literal text you write, Previous/Next/Finish/Stop, Escape, focus restoration and cleanup. It never clicks targets.                                       |
| Six emotions and a loading expression                                                                                         | `onEmotionChange` / `subscribe`: idle, happy, sad, thinking, confused, hover. The loading state stays `thinking` while the provider or browser is working.                           |
| Speaking the final answer                                                                                                     | Opt-in `SpeechOutput`, off at first and limited to local voices. No microphone and no bundled cloud TTS client.                                                                      |
| Content search, recent content                                                                                                | A search or list capability of your own, with bounded public results and real verification. Core includes no catalog, database or routes.                                            |
| Print, download, PDF parsing, commercial TTS                                                                                  | Host integrations with their own permissions, privacy and cost controls. Consequential actions need [approval](webmcp-and-approval.md); never relabel them to get around that.       |

These are reusable behaviors and hooks. They do not install an accessibility toolbar on every site. Third-party accessibility widgets remain the host's own, under their own license. Only advertise features your site actually implements and authorizes.

## Enable presentation

```ts
import { BrowserDriver, BrowserRuntime } from '@pagesquire/core';
import '@pagesquire/client/widget.css';

const driver = new BrowserDriver({ observer, durationMs: 240 });
const runtime = new BrowserRuntime({
  observer,
  registry,
  presentation: driver,
  timeoutMs: 15000,
});
```

Registered handlers call `await context.present(target, 'click' | 'fill' | 'highlight')`, check for cancellation and that the target is still current, perform the operation, then verify the real postcondition. The presenter only animates; it executes nothing. The runtime removes presentation after each action. Replays return cached results without animating or clicking again. Animation never makes invalid parameters, private, hidden or detached targets, or consequential actions acceptable.

Reduced motion is read live from the OS setting, and `motion: 'none'` turns motion off regardless. Overlays cannot be clicked and are excluded from observation. A completed scan restores the saved scroll position; a cancelled scan stops where it is. Text already in the DOM can be read without scrolling. Lazy-loaded or virtualized content needs a reader of your own and tests that it reads everything.

Use the widget stylesheet; no injected styles, animation library or `eval` is needed. Dispose the driver on unmount or when the page unloads. Do not share one driver or runtime between clients and tours running at the same time: stop the current one, or give each its own presenter.

## Bind the actual controls

`createControlBindings` accepts up to 100 explicit bindings:

- `definition`: the closed capability definition from the server and registry, with compiled parameters.
- `target(parameters, context)`: one public host control, never a selector from the model.
- Optional `prepare(parameters, context)`: open the known parent menu or panel. Honor its signal and only perform approved steps.
- Optional `value(parameters)`: the desired native value. Without it, the binding clicks an approved button, checkbox or radio control.
- `isApplied(parameters, context)`: required. Returns a boolean from the page's actual state, not from a changed input or an in-memory success flag.

It returns `capabilities`, `handlers` and `verifiers`. It avoids repeated toggles, rejects disabled, read-only and stale controls, and refuses submit buttons and links as generic clicks. An `input` or `change` event does not prove that heading styles changed. For each accessibility feature on the site, either bind it and verify its real postcondition, or write down why it is unavailable. A visible control is not an authorized one.

## Read content and keep compound goals

```ts
import { createPageBindings } from '@pagesquire/core';

const pages = createPageBindings({
  scopes: {
    article: (context) => context.observer.findUnique('main article'),
  },
  driver,
});
// Merge pages.capabilities/handlers/verifiers with the host catalog.
// Compile validators for these exact definitions before registry creation.
```

Only the host defines scope resolvers. The model picks a scope by name, never a selector. `page.read` takes `{ scope, mode: 'summary' | 'full', offset }`:

- Summary reads return at most 12,000 characters, full reads at most 24,000.
- `offset` is an integer from 0 to 40,000.
- Evidence contains `text`, `truncated`, `nextOffset`, `complete`, the scope and the URL. `complete` means one untruncated read from offset 0 of the configured rendered scope, not of every linked or lazy-loaded document.

Without a driver, `createPageBindings().capabilities` leaves out `page.highlight`, so the model is never offered a visual capability the host cannot show. Reading and instant scrolling still work. `createPageCapabilities` returns every definition; use only the ones you actually wire up when building a catalog.

Follow `nextOffset` only when it is supported and within budget; a truncated read without it stays partial. Never use catalog metadata in place of the article text. `PageObserver.readContent(root, maxLength, offset)` applies the same private, ignore, assistant, hidden and form-content exclusions without replacing the snapshot used for actions. Content and URL are checked again before success is reported. Nothing extra is written to localStorage or sent as telemetry.

For "open the article and summarize": navigate, wait until the destination is ready, read the article scope, then summarize the text that came back. The Node and PHP engines tell the model to keep the whole goal. A weaker model may still answer without acting; do not add hidden paid retries or regex guesses to compensate. If your host resolves intents itself, keep the remaining goals rather than stopping at a navigation confirmation.

## Tours, speech and avatar

`new GuidedTour({ observer, driver }).start(steps, signal)` accepts up to 30 `{ target: () => Element, text, prepare? }` steps. Text is shown as plain text, never HTML. Each step's target is resolved when the step starts, with route, visibility and privacy checks. `cancel()` and `dispose()` remove the UI and restore focus. Preparation is raced against cancellation, but your callbacks must honor the signal to avoid late side effects of their own. Tours do not continue across documents.

`new SpeechOutput({ window, lang: 'en', localOnly: true })` starts disabled.

- Enable it only from an audio control the user operates, then call `speak(text, signal)` for a final verified answer of at most 4,000 characters.
- It returns false when disabled, unsupported, without a local voice, on error or when aborted.
- Do not speak tool narration or private text automatically.
- OS voices that use the network need an explicit `localOnly: false` and a privacy notice. Voice availability varies.
- The browser's speech queue is shared by the whole document, so use one output owned by the host. Disable or cancel it on Stop or New conversation, and dispose it on unmount.

Forward the six emotions to your own licensed Rive mapping. PageSquire assumes no state-machine name and ships no `.riv` file or mascot. Commercial TTS belongs on the server as its own provider, never as an API key in the browser. Audio and visuals never grant permissions or change quota accounting.

## Onboarding and frameworks

- **CLI.** Manifests stay JSON, and binding modules must use direct named function exports. The helper factories return maps of functions, so wrap the entries you use in named exports the CLI can inspect. Write the factory definitions into the host manifest during a trusted build, then run `validate --compile`. The CLI never imports arbitrary application code. See the [driving manifest](../examples/plain-html/driving-capabilities.mjs) and the [host example](../examples/plain-html/driving.ts).
- **Plain PHP and Laravel.** The helpers run in your existing frontend build. Keep the PHP catalog identical, and keep sessions, CSRF, storage and keys private. Laravel routes and auth are unchanged.
- **React, Inertia and Next.js.** Create the driver and runtime in the persistent client layout, keep the navigation adapter you passed in, and dispose presentation, tours and speech on teardown. Continuing after a full-document navigation still mounts the same catalog and calls `client.resumeNavigation()` once.
- **WordPress.** The optional `page.read`, `page.scroll_to` and `page.highlight` use only the `content` scope under the mapping root, and are off by default. Select them, inspect each selected public page again, review consent and enable them. Inspection uploads counts and verified IDs, not page text. Custom third-party controls still need a reviewed site adapter, not executable JSON.

## Demo and limits

Run `npm run build`, then `npm run demo`, and open `/driving.html` on the local server. It uses scripted replies, not a paid model. It shows opening content, heading controls, cursor feedback, scanning and reading, a summary built from an excerpt, tours and local voice that the user turns on. It does not measure how well a live model understands language. Unit, browser and native PHP tests cover compound goals, and the WordPress tests run against the built ZIP. OS voices, screen readers and arbitrary websites have not been tested.

The OFFBEAT demo also uses the presenter for its thirteen actions, with verified, edge-aligned animated scrolling. It points at real visible content instead of pretending to click its hidden adapter controls. Presentation adds no capability and uses no provider quota.

Browser references: [Web Animations](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate), [motion queries](https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia), [speech synthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis), [decorative accessibility-tree exclusion](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden). Decorative overlays are positioned using geometry and style only; real targets still go through the observer's stricter privacy and accessibility exclusions.
