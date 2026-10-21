# Assistant driving and feature parity

PageSquire supplies reusable driving primitives, not permission to operate arbitrary controls. They use the same browser core in plain HTML/PHP, Laravel/Inertia, React/Next.js and WordPress. These are alpha APIs. Reference-site content, routes, Sienna UI, Rive assets and commercial TTS credentials are not distributed.

## Reference behavior and generic implementation

| Behavior                                                                                                                      | PageSquire integration                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moving cursor, target outline, click feedback                                                                                 | `BrowserDriver` and the existing client stylesheet. Presentation never performs a click or grants permission.                                                              |
| Scrolling, including nested containers                                                                                        | `driver.scrollTo(target, signal, 'start' or 'end')`; `page.scroll_to` uses a declared public scope.                                                                        |
| Menu, dropdown, accessibility panel preparation                                                                               | Owner-authored `prepare` callbacks in `createControlBindings`; explicit, cooperative prerequisites only.                                                                   |
| Native color/range/text/select and button controls                                                                            | `createControlBindings` and `setControlValue`, with mandatory desired-state verification and no blind repeat toggles.                                                      |
| Heading/body colors, heading/link highlighting, font weight/size, spacing, alignment and contrast                             | Bind the site's actual controls with separate closed schemas and computed-state verifiers. Names alone do not make a capability available.                                 |
| Reading fonts, images/tooltips, masks/guides, focus, magnification, cursor sizes, virtual keyboard and accessibility profiles | Same generic host-control binding contract. PageSquire does not bundle a third-party accessibility engine or certify a profile's medical effectiveness.                    |
| Open page/article and continue                                                                                                | Existing document checkpoint, Inertia or committed-ready Next adapter; preserve remaining user goals after verified arrival.                                               |
| Scan/read and summarize                                                                                                       | `createPageCapabilities` / `createPageBindings`: public scope, bounded offsets, private exclusions and explicit truncation evidence. Visual scanning is not reading proof. |
| Guided highlight tour                                                                                                         | `GuidedTour`: owner-authored resolvers/literal text, Previous/Next/Finish/Stop, Escape, focus restoration and cleanup. No target click.                                    |
| Six emotions and loading expression                                                                                           | Existing `onEmotionChange` / `subscribe`: idle, happy, sad, thinking, confused, hover. Loading remains thinking through provider/browser work.                             |
| Final-answer speech                                                                                                           | Opt-in `SpeechOutput`, initially disabled and local-voice-only. No microphone or bundled cloud TTS client.                                                                 |
| Content search / recent content                                                                                               | Host semantic search/list capability with bounded public results and real verification. No reference news catalog, database or routes in core.                             |
| Print, download, PDF parsing, commercial TTS                                                                                  | Host integrations with separate permissions, privacy and cost controls. Consequential actions remain blocked in this alpha; never relabel them to bypass policy.           |

This is reusable assistant behavior and integration hooks, not an installation of every reference accessibility UI on every website. Sienna or other third-party controls remain host-owned/licensed. Only advertise features that the current host actually implements and authorizes.

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

Registered handlers call `await context.present(target, 'click' | 'fill' | 'highlight')`, check cancellation/target freshness, perform the approved operation, then verify its actual postcondition. The presenter does not execute the operation. Runtime cleanup removes presentation after each action. Replays use cached results, not another animation/click. Invalid parameters/private/hidden/detached targets and consequential actions cannot gain permission through animation.

OS reduced motion is checked dynamically; `motion: 'none'` disables motion regardless of OS settings. Overlays are noninteractive and excluded from observation. Successful scans restore saved positions; cancelled scans stop at the current position. Already-rendered DOM text does not require scrolling. Lazy-loaded/virtualized content needs a host reader and completeness tests.

Use the existing external widget stylesheet; no injected style block, animation framework or unsafe evaluation is needed. Dispose the driver on unmount/document exit. Do not share a driver/runtime among simultaneous clients and tours: stop the current operation or provide separate presenters.

## Bind the actual controls

`createControlBindings` accepts up to 100 explicit bindings:

- `definition`: the server/registry's closed capability definition, with compiled parameters.
- `target(parameters, context)`: one public host control, never a model-supplied selector.
- Optional `prepare(parameters, context)`: open the known parent menu/panel. Honor its signal and operate only approved prerequisites.
- Optional `value(parameters)`: desired native value; otherwise click an approved button/checkbox/radio control.
- `isApplied(parameters, context)`: mandatory boolean from the actual page state, not merely a changed input or in-memory success flag.

It returns `capabilities`, `handlers`, `verifiers`, avoids repeat toggles, rejects disabled/read-only/stale controls and refuses submission/link controls as generic control clicks. An input/change event is not evidence that heading styles changed. For every existing accessibility feature, either bind/verify its real postcondition or record why it is unavailable. Visibility is not authorization.

## Read and preserve compound goals

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

Only the host chooses scope resolvers; the model selects a closed scope name, not a selector. `page.read` requires `{ scope, mode: 'summary' | 'full', offset }`. Summary/full reads return at most 12,000/24,000 characters; offsets are integers from zero through 40,000. Evidence contains `text`, `truncated`, `nextOffset`, `complete`, scope and URL. `complete` means one nontruncated read from offset zero of the configured rendered scope, not every linked/lazy-loaded document.

Without a configured driver, `createPageBindings().capabilities` omits `page.highlight`; a model must not be offered a visual capability that the host cannot present. Reading and instant scrolling remain available. `createPageCapabilities` is the complete definition blueprint; select only the actually wired entries when building a catalog.

Follow `nextOffset` only when supported and within budget. A truncated read without continuation remains partial. Never substitute catalog metadata for full article text. `PageObserver.readContent(root, maxLength, offset)` shares private/ignore/assistant/hidden/form-content exclusions without replacing the active action snapshot. Content and URL are rechecked before verified success. No extra localStorage transcript or text telemetry is added.

For “open the article and summarize”: open/navigate, wait for destination readiness, read the article scope, then summarize the returned text. Node/PHP instructions now preserve the entire goal. Prompt/contract tests are not measured model comprehension: an unsuitable model may still return answer-only text. Do not add hidden paid retries or a guessed regex fallback. Any host intent resolver must preserve remaining goals, not always finish with a navigation confirmation.

## Tours, speech and avatar

`new GuidedTour({ observer, driver }).start(steps, signal)` accepts at most 30 `{ target: () => Element, text, prepare? }` steps. Text is literal, not HTML. Targets resolve per step with route/visibility/private checks. `cancel()` / `dispose()` clean UI and restore focus. Preparation is raced against cancellation, but host callbacks must honor signals to prevent their own late side effects. No tour plan is persisted across documents.

`new SpeechOutput({ window, lang: 'en', localOnly: true })` starts disabled. Enable only from an explicit user audio control, then `speak(text, signal)` for a final verified answer, at most 4,000 characters. Disabled/unsupported/local-voice-unavailable/error/abort cases return false. Do not speak tool narration or private text automatically. Network-backed OS voices require explicit `localOnly: false` and privacy disclosure. Availability varies. The browser speech queue is document-wide: use one host-owned output, not unrelated shared audio clients. Disable/cancel on Stop/New conversation and dispose on unmount.

Forward six emotion values to the host's own licensed Rive input mapping. There is no assumed state-machine name or redistributed .riv/mascot. Commercial TTS is a separate server provider, not a browser API key. Optional audio/visual presentation never grants permissions or changes quota accounting.

## Onboarding and frameworks

- CLI manifests remain JSON and binding modules require direct named function exports. Factories return function maps: wrap selected entries in named host exports for static inspection. Serialize/review factory definitions into the host manifest with a trusted build, then use `validate --compile`. The CLI must not import arbitrary application code. See the [driving manifest](../examples/plain-html/driving-capabilities.mjs) and [host example](../examples/plain-html/driving.ts).
- Plain PHP / Laravel: helpers run in the existing frontend build; keep the PHP catalog identical and sessions/CSRF/storage/keys private. Laravel route/auth conventions are unchanged.
- React/Inertia/Next.js: create driver/runtime in the persistent client layout, retain the injected navigation adapter and dispose presentation/tour/speech during teardown. Document continuation still mounts the same catalog and calls `client.resumeNavigation()` once.
- WordPress: optional `page.read`, `page.scroll_to`, `page.highlight` use only scope `content` under the mapping root. Defaults do not enable them. Select them, inspect each selected public page again, review consent and explicitly enable. Inspection uploads counts/verified IDs, not read text. Custom third-party controls still require a reviewed site adapter, not executable JSON.

## Verification example and limits

Run `npm run build`, then `npm run demo` and visit `/driving.html` on that local server. This neutral fixture uses deterministic replies, not a paid model. It demonstrates actual opening/heading controls, cursor feedback, scan/read, a synthetic excerpt-based summary, tours and user-enabled local voice. It does not measure live language understanding. Unit/browser and native PHP compound-goal tests cover the relevant boundaries; WordPress tests exercise the built ZIP separately. OS voice, screen-reader behavior and arbitrary website compatibility remain unverified until actually tested.

The OFFBEAT art demo also wires the presenter into its existing thirteen semantic actions and uses animated, verified edge-aligned scrolling. It points to actual visible content rather than pretending to click its hidden adapter controls. No capability or provider quota is added by presentation.

Browser references: [Web Animations](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate), [motion queries](https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia), [speech synthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis), [decorative accessibility-tree exclusion](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden). Decorative overlays use visual geometry/style checks; actual host targets retain the observer's stricter privacy/accessibility exclusions.
