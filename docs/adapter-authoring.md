# Authoring a website adapter

An adapter connects reviewed website capabilities; it does not train the model or grant general DOM control. Start with [the protocol](protocol.md), [runtime](runtime.md) and [onboarding](onboarding.md). Follow the compilable examples in `examples/plain-html` and `tests/fixtures`, not an unverified AI success message.

## Contract checklist

1. Give each capability a stable English ID, bounded input schema, clear description, risk/permission scope and explicit target policy. Keep the trusted server catalog synchronized with the browser manifest. Unknown capabilities/parameters must fail closed.
2. Bind execution and verification together. Prefer desired state, such as setting a weight, over toggling it. Restrict targets to the approved root; never let a model supply arbitrary selectors or executable JavaScript.
3. Verify the actual postcondition: heading color on headings, visible link outlines on links, computed style/application state on the intended content, and destination readiness after navigation. Missing or ambiguous targets are failures, not permission to affect the whole page.
4. Honor the execution signal, timeouts and fresh observations. Navigation must use the host adapter; full-document continuation must not replay the original action. Do not persist transcripts or sensitive page data in browser checkpoints.
5. Keep authorization and consequential business permissions on the server. Client results are untrusted telemetry. Presentation-only capability approval is not permission to submit forms, purchase, delete or modify records.

## Tests and handoff

Add synthetic unit/real-browser fixtures for success, repeated desired state, missing/ambiguous/hidden/stale targets, denial, timeout/cancellation and navigation. Verify schemas under the no-unsafe-eval CSP and both PHP/Node wire contracts when changing shared behavior. Test a built/packed consumer where packaging changes.

Source/DOM scans report observed metadata and coverage gaps; they do not certify hidden/authenticated states. Optional `$assistant-setup`/`/assistant-setup` guidance helps a coding agent wire and test reviewed contracts; its output is still owner-reviewed code. WordPress uses its separate dashboard and closed built-in mapping import. Custom theme/plugin/business adapters require a developer-reviewed source change, not executable JSON import.

Add exact supported-version evidence to [compatibility.json](compatibility.json), explain limitations in the English guide and preserve asset/dependency rights. Do not bundle pilot branding, private content or an unlicensed avatar. Emotion callbacks accept the protocol's six states; keep loading in `thinking` and provide a fallback when a renderer/state is unavailable.
