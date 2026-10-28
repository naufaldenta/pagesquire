# Capability inspector

The optional C2 inspector helps integrators answer: **which expected features are actually registered, and can their sampled targets be found on this page?** It is local development/admin tooling, not a tool runner, authorization service or AI accuracy test. No model, provider credential, database or new dependency is required.

## Mount explicitly

Use the browser packages from the same reviewed source/artifacts as your runtime. Nothing is mounted by default. Keep diagnostics on a host-protected developer/admin surface; hiding a button with a client-side Boolean is not access control. Do not put schemas, internal action names or this UI on an unrestricted production page.

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

Use only IDs present in your real registry for `probes`. `expected` may also contain missing IDs: these appear as **Not registered**, rather than acquiring a fake binding. It defaults to the registered catalog; provide an explicit feature inventory to detect omissions. Each list is bounded at 1,000 entries. Duplicate/invalid expected IDs and unknown/invalid probes are rejected.

The existing registry still rejects missing handlers, missing verifiers, missing compiled validators and schema mismatches at construction. The inspector accepts an already valid registry; it is not a partial-registry repair mechanism. Run the existing [onboarding validation and coverage reports](onboarding.md) for registration/build errors.

## Read-only target probes

A probe is a **trusted, synchronous, read-only host function**, returning one `Element`, an array of candidate elements, or `null`. Use explicit owner-authored selectors/resolvers, not model/page-supplied selectors. Do not use `observer.findUnique` inside a probe when you want a hidden/ambiguous/missing diagnosis: that method already throws for nonunique or hidden targets. Return the raw candidates instead.

- No handler, verifier, compiled parameter validator, preparation callback, presentation or action is invoked by the inspector. A probe does not receive execution context or action parameters.
- `requiresPreparation: true` is a declaration that the real handler has an explicit preparation path; it does not open a menu or prove that preparation succeeds. Implement preparation with your existing [control bindings](assistant-driving.md), then test the actual action.
- `interaction: 'click' | 'fill'` additionally checks the existing observer interaction policy. Leave it unset for semantic registered handlers that do not use generic DOM interaction. Never widen `canInteract` just to turn a diagnostic green.
- A probe samples the target chosen by its host author. It does **not** cover every input value, selected scope, route, permission, capability output or provider/model. Use multiple real-action tests for those cases.
- Host code cannot be sandboxed here: a malicious/incorrect probe can mutate the page, block the main thread or send a request. Keep it small and read-only. Thrown errors and incorrectly returned promises become `probe_failed`; error text/results are not exported. Async probes are not supported.

No automatic polling, DOM mutation observer or provider request is installed. Mounting runs one inspection; **Refresh checks** explicitly reruns probes. Search, status filters, disclosures and diagnostics export do not. After SPA navigation, refresh/recreate the inspector against the appropriate registry and observer. Full-document navigation requires mounting it again on the new protected page.

## Interpret results correctly

| Status                                                 | Meaning / next check                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_checked`                                          | No probe ran. The catalog alone does not establish DOM readiness.                                                                                 |
| `ready`                                                | The sampled target is attached, public, visible, not disabled and passes the optional local interaction check. This is **not** a verified action. |
| `needs_preparation`                                    | The target is hidden and the host declared preparation. Check that the actual handler prepares it.                                                |
| `not_registered`                                       | An expected ID is absent; implement/review it or correct the inventory.                                                                           |
| `target_missing` / `target_ambiguous`                  | There is no attached target in this document, or the resolver returned more than one candidate. Never substitute a nearby element.                |
| `target_private` / `target_hidden` / `target_disabled` | Existing privacy, visibility or native/ARIA disabled checks prevent a ready diagnosis.                                                            |
| `interaction_denied`                                   | The optional generic click/fill check was denied by the observer.                                                                                 |
| `scope_denied`                                         | The current URL is outside the observer's allowed scope; target probes are skipped. The URL is not included.                                      |
| `probe_failed`                                         | The host resolver returned an unsupported value or a local check threw. Debug locally; no private exception detail is included.                   |
| `blocked_in_alpha`                                     | Consequential capabilities: blocked unless approval is configured (see [approvals](webmcp-and-approval.md)). Their probes are not run.            |

The inline UI searches IDs/descriptions/aliases, filters statuses, and exposes registered binding names and input-schema metadata through native disclosures. It has labeled controls, keyboard focus styles, no focus-stealing modal, no motion and no HTML interpretation. It is marked `data-pagesquire-root` so the observer excludes it. Manual screen-reader and broad browser acceptance remain separate release gates.

Every report says `authorization: 'not_evaluated'`: server catalog selection, principal/session checks, parameter validation, current snapshots, replay/cost budgets and real postcondition verification stay authoritative. Inspector reports are never sent to the model or used by the executor to grant/deny actions. Optional [C3 public app context/availability](app-context.md) is a separate runtime integration: a target-ready diagnosis does not imply contextual availability. [C4 action progress](action-progress.md) observes real execution separately; this inspector never reads/exports context fields or action timelines or invokes those callbacks.

## Diagnostics without page content

For a custom protected UI, `inspector.inspect()` returns an immutable local report, including the registered definitions. **Do not upload that full report**: schema/description/alias metadata can contain host information.

`inspector.exportDiagnostics()` returns JSON from the **last** inspection, without calling any probe. Before a first inspection it reports unchecked metadata. Its fixed whitelist contains:

- Diagnostics schema version `1` (not a change to wire protocol `0.1`), scope/authorization enums and summary counts.
- Per-entry public capability ID, expected flag, risk, registration-binding status and fixed readiness enum.

It omits definitions, descriptions, aliases, schemas, handler names, target text/values/selectors, URLs, timestamps, call/snapshot IDs, transcripts, raw errors, function source and credentials. There is no automatic download, clipboard write, persistence or network upload. The UI exposes a read-only JSON field for deliberate copying.

**Metadata is not anonymous:** capability IDs, risks and counts remain. Do not put secrets/personal data in IDs; review the JSON before sharing it. This whitelist is not a general-purpose semantic secret scrubber. A refresh can change the report; exporting does not prove that it is still current.

## Offline example

Run `npm run build` and `npm run demo` from a trusted development checkout, then open `/driving.html` on the local demo origin. Choose **Open capability inspector**. The fixture deliberately includes missing `site.search`, a heading control requiring preparation and a hidden article. Open the real settings panel or run a registered action, then refresh: inspection itself never opens it. The global lab debug object and synthetic missing ID are example-only, not production integration patterns.

The inspector works in the browser regardless of whether the host backend is Node, native PHP, Laravel or WordPress. It does not add a new WordPress dashboard/setup step or replace the plugin's existing inspection. Use a host-protected developer integration if needed; no production plugin mount is enabled automatically.
