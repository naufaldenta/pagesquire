# Capability inspector

The capability inspector answers two questions for integrators: **which of the features you expect are registered, and can their targets be found on this page?** It is a local tool for developers and admins. It does not run actions, authorize anything or test AI accuracy, and it needs no model, provider key, database or extra dependency.

## Mount it yourself

Nothing is mounted by default. Use the same browser package build as your runtime, and put the inspector on a developer or admin page that your host protects. Hiding a button behind a client-side flag is not access control. Do not show schemas, internal action names or this UI on a public production page.

```ts
import { CapabilityInspector } from '@pagesquire/core';
import { mountInspector } from '@pagesquire/client';
import '@pagesquire/client/widget.css';

// registry and observer are the same host-owned instances used by your runtime.
// container is an attached element in the observer document, behind host access control.
const inspector = new CapabilityInspector({
  registry,
  observer,
  expected: [
    'accessibility.set_heading_color',
    'accessibility.set_font_weight',
  ],
  probes: {
    'accessibility.set_heading_color': {
      resolve: () => [...document.querySelectorAll('#heading-color')],
      requiresPreparation: true,
    },
  },
});
const unmount = mountInspector(container, inspector);
// On route/component teardown:
unmount();
```

`probes` may only use IDs that are in your registry. `expected` may also list IDs that are missing; those show as **Not registered**. `expected` defaults to the registered catalog, so pass your own list of features to catch omissions. Each list holds up to 1,000 entries. Duplicate or invalid expected IDs and unknown or invalid probes are rejected.

The registry already rejects missing handlers, verifiers or compiled validators and schema mismatches when it is constructed, so the inspector only ever sees a valid registry. For registration and build errors, use the [onboarding validation and reports](onboarding.md).

## Read-only target probes

A probe is a **trusted, synchronous, read-only function** that you write. It returns one `Element`, an array of candidate elements, or `null`. Use selectors you wrote yourself, never ones from the model or the page. If you want hidden, ambiguous or missing targets diagnosed, do not call `observer.findUnique` in a probe, because it throws in those cases. Return the raw candidates instead.

- The inspector never calls a handler, verifier, compiled validator, preparation callback or presentation, and never runs an action. Probes receive no execution context or parameters.
- `requiresPreparation: true` declares that the real handler has a preparation step. It does not open the menu, and it does not prove that preparation works. Implement preparation with [control bindings](assistant-driving.md) and test the real action.
- `interaction: 'click' | 'fill'` also checks the observer's interaction policy. Leave it out for handlers that do not use generic DOM interaction. Never widen `canInteract` just to make the inspector show green.
- A probe checks one sample target. It does **not** cover every input value, scope, route, permission, output or model. Test real actions for those.
- Probes are not sandboxed. A faulty probe can change the page, block the main thread or send a request, so keep probes small. A probe that throws or returns a promise reports `probe_failed`, without the error text. Async probes are not supported.

The inspector does not poll, watch the DOM or call a provider. Mounting runs one inspection, and **Refresh checks** runs the probes again. Searching, filtering, opening disclosures and exporting do not. After SPA navigation, refresh or recreate the inspector with the right registry and observer. After a full-document navigation, mount it again on the new page.

## Reading the results

| Status                                                 | Meaning / next check                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_checked`                                          | No probe ran. Being in the catalog does not mean the target is on the page.                                                                       |
| `ready`                                                | The sampled target is attached, public, visible, not disabled and passes the optional local interaction check. This is **not** a verified action. |
| `needs_preparation`                                    | The target is hidden and the host declared preparation. Check that the actual handler prepares it.                                                |
| `not_registered`                                       | An expected ID is missing. Implement it or correct the list of expected features.                                                                 |
| `target_missing` / `target_ambiguous`                  | No attached target in this document, or the resolver returned more than one candidate. Never fall back to a nearby element.                       |
| `target_private` / `target_hidden` / `target_disabled` | The usual privacy, visibility or native/ARIA disabled checks stop the target from being ready.                                                    |
| `interaction_denied`                                   | The optional generic click or fill check was denied by the observer.                                                                              |
| `scope_denied`                                         | The current URL is outside the observer's allowed scope, so target probes are skipped. The URL is not included.                                   |
| `probe_failed`                                         | The resolver returned an unsupported value or a local check threw. Debug locally; no private exception detail is included.                        |
| `blocked_in_alpha`                                     | Consequential capabilities: blocked unless approval is configured (see [approvals](webmcp-and-approval.md)). Their probes are not run.            |

The inline UI lets you search IDs, descriptions and aliases, filter by status, and open native disclosures that show binding names and input-schema metadata. It has labelled controls, visible keyboard focus, no modal, no motion and no HTML rendering. It carries `data-pagesquire-root`, so the observer ignores it. It has not been tested with screen readers yet.

Every report says `authorization: 'not_evaluated'`. Server catalog selection, session permissions, parameter validation, current snapshots, replay and cost budgets and real postcondition checks still decide what runs. Reports are never sent to the model or used by the executor. [AppContext](app-context.md) availability is a separate check: a ready target does not mean the capability is available in the current state. [Action progress](action-progress.md) is separate too. The inspector never reads context fields or action timelines and never calls their callbacks.

## Diagnostics without page content

For a custom protected UI, `inspector.inspect()` returns an immutable local report that includes the registered definitions. **Do not upload that full report**: schemas, descriptions and aliases can reveal details about your site.

`inspector.exportDiagnostics()` returns JSON from the **last** inspection, without calling any probe. Before the first inspection it reports unchecked metadata. It contains only:

- the diagnostics schema version `1` (separate from wire protocol `0.1`), the scope and authorization values, and summary counts
- for each entry: the public capability ID, whether it was expected, its risk, its registration status and its readiness status

It leaves out definitions, descriptions, aliases, schemas, handler names, target text, values and selectors, URLs, timestamps, call and snapshot IDs, transcripts, raw errors, function source and credentials. Nothing is downloaded, copied to the clipboard, stored or uploaded automatically. The UI shows a read-only JSON field you can copy on purpose.

**The export is not anonymous:** capability IDs, risks and counts remain. Do not put secrets or personal data in IDs, and review the JSON before sharing it. The export is a fixed field list, not a general secret scrubber. A refresh can change the report, and an export says nothing about whether it is still current.

## Offline example

From a development checkout, run `npm run build` and `npm run demo`, then open `/driving.html` on the local demo server and choose **Open capability inspector**. The example deliberately includes a missing `site.search`, a heading control that needs preparation and a hidden article. Open the real settings panel or run a registered action, then refresh; inspecting never opens the panel itself. The global debug object and the fake missing ID exist only in this example and are not patterns for production.

The inspector runs in the browser, whatever the backend: Node, native PHP, Laravel or WordPress. It adds no step to the WordPress dashboard and does not replace the plugin's own inspection. The plugin never mounts it automatically; if you want it there, add it to a protected developer page yourself.
