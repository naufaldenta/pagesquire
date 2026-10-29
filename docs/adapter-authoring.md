# Authoring a website adapter

An adapter connects a website's reviewed capabilities to PageSquire. It does not train the model or give it general control of the DOM. Start with [the protocol](protocol.md), [the runtime](runtime.md) and [onboarding](onboarding.md). Copy from the examples that compile and run, in `examples/plain-html` and `tests/fixtures`, not from an AI's claim that something works.

## Contract checklist

1. Give each capability a stable English ID, a bounded input schema, a clear description, a risk level, a permission scope and an explicit target policy. Keep the server's trusted catalog in sync with the browser manifest. Unknown capabilities and parameters must fail closed.
2. Bind execution and verification together. Prefer setting a desired state, such as a font weight, over toggling. Restrict targets to the approved root. Never let the model supply selectors or JavaScript.
3. Verify the actual postcondition: heading color on headings, visible outlines on links, the computed style or application state of the intended content, and destination readiness after navigation. Missing or ambiguous targets are failures, not permission to change the whole page.
4. Honor the execution signal, timeouts and fresh observations. Navigate through the host's navigation adapter. Continuing after a full-document navigation must not replay the original action. Do not store transcripts or sensitive page data in browser checkpoints.
5. Keep authorization and business permissions on the server. Results from the browser are untrusted. Approving a presentation-only capability is not permission to submit forms, buy, delete or change records.

## Tests and handoff

Add unit tests and real-browser fixtures with synthetic data for success, setting a state that is already set, missing, ambiguous, hidden and stale targets, denial, timeout, cancellation and navigation. When you change shared behavior, check that schemas work under a CSP without `unsafe-eval`, and that both the PHP and Node wire contracts still pass. When packaging changes, test a built and packed consumer.

Source and DOM scans report what they saw and what they could not cover; they say nothing about hidden or logged-in states. The optional `$assistant-setup` / `/assistant-setup` skill helps a coding agent wire up and test reviewed contracts, but its output is code you still review. WordPress uses its own dashboard and imports only the closed set of built-in mappings. Custom theme, plugin or business adapters need a reviewed source change, not an executable JSON import.

Record exactly which versions you support in [compatibility.json](compatibility.json), explain limitations in the English guide, and respect the rights to assets and dependencies. Do not bundle another site's branding, private content or an avatar you have no license for. Emotion callbacks accept the protocol's six states. Keep loading in `thinking`, and provide a fallback when a renderer or state is unavailable.
