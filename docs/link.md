# PageSquire Link (Phase 6)

**Status:** pairing (Phase 6A) is implemented for Node, native PHP, Laravel and WordPress. Handoffs (Phase 6B) are implemented end to end: tickets between servers, the engine's `link.handoff` tool, the visitor's consent prompt, the new tab and the partner's arrival banner, in Node, native PHP, Laravel, WordPress and the one-tag embed. Returns (Phase 6C) are implemented too: the partner can send the visitor back once with a one-line outcome. With several partners for one skill (Phase 6D), the visitor chooses where to continue, and owners get an overview of who offers what and how many visitors went each way. An optional A2A interface (Phase 6E) lets any A2A agent send a request into the skills an owner opens; the agent gets only a single-use link where the person continues. See [Using Link](#using-link-phase-6a) for setup.

PageSquire Link lets two sites that both run PageSquire work together. They can belong to different owners, run on different servers and use different stacks, such as Next.js, Laravel, native PHP or WordPress. It has two parts:

1. **Pairing.** Two owners connect their sites with a one-time invitation code. Each site already knows its own capabilities, so the link only exchanges a small catalog of services and the scope each owner approves.
2. **Handoff.** On site A, the assistant notices that what the visitor wants is a service of partner site B. It offers to continue there. B opens in a new tab and carries on from the visitor's goal, without asking again.

```text
Visitor on hotel.test: "Book a table for four at a seafood place tonight at 7"
  hotel.test assistant: "Restoran Laut (resto.test) can do this. Continue there?
                         It will receive: date = tonight, time = 19:00, people = 4"   [Continue] [Stay here]
  → resto.test opens in a new tab:
    "Continued from hotel.test: book a table for 4, tonight, 19:00"                     [Continue] [Dismiss]
  → resto.test assistant fills its own booking form with its own verified capabilities
```

## Positioning

- **Website copilots** such as Pillar, CopilotKit, assistant-ui and Tambo work inside one application. See the [competitor review](competitor-review.md).
- **Platform handoffs** such as Telnyx, Vapi and Replicant pass conversations between assistants of one vendor's platform.
- **A2A** (Agent2Agent, Linux Foundation) standardizes agent-to-agent tasks between servers. It defines no visitor, consent prompt or browser widget.
- **NLWeb** makes site content reachable for agents.

None of these moves a visitor between the assistants of two independently owned websites with the visitor's consent. Link does, and its catalog uses A2A's skill shape, so a site can also publish a signed A2A Agent Card ([A2A interface](#a2a-interface-phase-6e)).

## Goals and non-goals

**Goals**

- Pair two PageSquire sites across owners, servers and stacks with an invitation code and owner-approved scopes.
- Hand a visitor from A to B in the same browser. B continues from the goal after one confirmation click.
- Carry only what the visitor said and agreed to share, validated against B's published input fields.
- Return a result from B to A (Phase 6C).

**Non-goals**

- **No shared authority.** B never runs A's capabilities, and A never runs B's. Each site keeps its own manifest, approvals, sign-in and rate limits.
- **No shared sessions.** No cookies, logins or conversation state cross sites. If B needs sign-in, the visitor signs in on B (the "Your turn" hand-off).
- **No central service.** Sites talk to each other directly. There is no PageSquire cloud, directory or relay.
- **No cross-device continuation and no tracking.** Handoffs stay in one browser. There is no referral or commission tracking, only local counts for owners.

## Threat model

| Actor                          | Trusted for                                    | Main threat                                                                                      |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Visitor                        | Their own goal; approving each handoff         | Approving by habit                                                                               |
| Owner A, owner B               | Approving a link and its scope on their side   | Over-broad scopes                                                                                |
| Server A, server B             | Their own site; signing their own messages     | A compromised partner sending crafted tickets or harvesting data                                 |
| Model on A                     | Proposing a handoff from the visitor's request | Prompt injection: handing off to the wrong partner, or carrying page data the visitor never gave |
| Model on B                     | Acting on B for the visitor                    | Treating ticket text as instructions                                                             |
| Page scripts on A or B         | Nothing                                        | Reading or replaying a handoff code                                                              |
| Network, logs, browser history | Nothing                                        | Leaked invitation codes or handoff codes                                                         |

### Invariants

1. **Mutual, owner-approved links.** A handoff needs an active link that both owners approved, each for its own side. Either owner can revoke it at any time, and revocation is immediate on that side.
2. **Intent and data, never authority.** A ticket carries a goal and fields. B decides what to do with its own capabilities, approvals and sign-in. Its action check (`checkActions`) is recommended for linked sites.
3. **Visitor consent per handoff.** A shows the partner's name and origin, the goal and every field before anything leaves. B shows the same before acting.
4. **Minimal, visitor-sourced data.** A ticket carries a goal summary and only fields that are:
   - declared in B's skill;
   - allowed by A's scope for that link;
   - present in the visitor's own messages, using the same typed-data screening that stops generic tools from typing unrequested data.

   Page content, snapshots and other visitors' data never travel.

5. **Server to server.** Tickets go from A's server to B's server. The browser carries only an opaque, single-use code in the URL fragment. The fragment is never sent in requests or `Referer` headers. B removes it from the address bar at once.
6. **Signed, short-lived, single use.** Every link message is an Ed25519-signed envelope bound to the sender, recipient and link. It expires within five minutes and is accepted once. Handoff codes expire after two minutes.
7. **Untrusted on arrival.** B treats the goal and fields as untrusted data, like page text. They are shown to the visitor and are never system instructions.
8. **Audited and bounded.** Both sides log pairing, revocation and handoffs without field values, and rate-limit each link.

## Architecture

```text
 Owner A's site (any stack)                                   Owner B's site (any stack)
 ┌─────────────────────────────┐   signed envelopes over HTTPS   ┌─────────────────────────────┐
 │ Engine A                     │ ───── pair / deliver / ───────► │ Link endpoint B             │
 │  link.handoff (catalog of B) │ ◄──── revoke / return ───────── │  verify, scope, store code  │
 │ Link store A (partners)      │                                 │ Link store B (partners)     │
 │ /.well-known/pagesquire.json │                                 │ /.well-known/pagesquire.json│
 └──────────────▲──────────────┘                                 └──────────────▲──────────────┘
                │ chat (same origin)                                            │ chat (same origin)
 ┌──────────────┴──────────────┐   new tab: b.test/#psq-link=CODE ┌──────────────┴──────────────┐
 │ Browser tab on A: widget,    │ ───────────────────────────────► │ Browser tab on B: widget    │
 │ consent prompt               │                                  │ opens with the goal         │
 └─────────────────────────────┘                                  └─────────────────────────────┘
```

### Site key and declaration

Each linked site uses the Ed25519 key from [signed action calls](companion-extension.md#signed-action-calls). One key, kept as a server secret, signs both action calls and link messages. Link messages use their own prefix, `pagesquire-link-v1.`, so a signature for one purpose never verifies as the other.

The declaration at `/.well-known/pagesquire.json` gains:

```json
{
  "version": 1,
  "endpoint": "/pagesquire/chat",
  "publicKey": "ed25519:…",
  "features": ["trustedInput", "link"],
  "link": {
    "endpoint": "/pagesquire/link",
    "name": "Restoran Laut",
    "skills": [
      {
        "id": "book_table",
        "name": "Book a table",
        "description": "Reserve a table for a date, time and party size.",
        "tags": ["restaurant", "reservation"],
        "examples": ["Book a table for 4 tonight at 7"],
        "fields": {
          "date": { "type": "string", "format": "date" },
          "time": { "type": "string", "pattern": "^[0-2][0-9]:[0-5][0-9]$" },
          "people": { "type": "integer", "minimum": 1, "maximum": 20 }
        },
        "startPath": "/reservations"
      }
    ]
  }
}
```

- **Skills** use A2A's `AgentSkill` fields: `id`, `name`, `description`, `tags` and `examples`.
- **`fields`** lists at most ten flat values (strings, numbers, booleans or enums) that a handoff may carry. Free-text values are capped at 200 characters.
- **`startPath`** is the same-origin page where the handoff opens.
- **The declaration is origin-bound.** The key a site publishes there is the key it signs with, which pairing relies on.

### Messages between servers

Every server-to-server request is one JSON envelope, POSTed to the partner's link endpoint:

```json
{
  "claims": "{\"v\":1,\"type\":\"handoff\",\"from\":\"https://hotel.test\",\"to\":\"https://resto.test\",\"link\":\"lnk_…\",\"nonce\":\"…\",\"iat\":1830000000,\"exp\":1830000300,\"body\":{…}}",
  "value": "base64 Ed25519 signature over \"pagesquire-link-v1.\" + claims"
}
```

Like action calls, the sender writes `claims` as text and signs those exact bytes. Node and PHP then never need a shared JSON canonical form, and both are tested against one shared vector.

The receiver checks:

- the signature, with the partner key stored for that link;
- `to` is its own origin, and `from` and `link` match an active link;
- the expiry, with two minutes of clock tolerance;
- that the nonce is new.

| Type      | Direction  | Body                                     | Answer                     |
| --------- | ---------- | ---------------------------------------- | -------------------------- |
| `accept`  | B → A      | Invitation ID and proof                  | Signed `accepted`: link ID |
| `approve` | either     | The skills of its own the sender accepts | Signed `ack`               |
| `revoke`  | either     | Nothing                                  | Signed `ack`               |
| `handoff` | A → B (6B) | Skill ID, goal, fields, locale           | Signed `ticket`: start URL |
| `return`  | B → A (6C) | Return reference, outcome, locale        | Signed `ticket`: start URL |

Answers are envelopes too, signed by the receiver and bound to the same link, so the sender knows the partner itself answered. Names and skills are never taken from a message body: each side reads them from the other's declaration.

## Pairing (Phase 6A)

1. **Owner A creates an invitation** with `php artisan pagesquire:link-invite`, `LinkManager::createInvitation()` in PHP, `manager.createInvitation()` in Node, or step 6 (**Partner sites**) of the WordPress dashboard. The result is a string `psq1.<A's origin, base64url>.inv_<id>.<secret>`. The secret has 256 bits. The invitation is single use and expires after 24 hours by default (1 to 168). A stores only a hash of the secret.
2. **Owner A sends the string to owner B** over any channel they trust, such as chat or email.
3. **Owner B pastes it** into their own dashboard or command. Server B:
   - fetches A's declaration over HTTPS from A's origin, which gives A's key;
   - signs an `accept` envelope with a proof that it holds the secret: an HMAC-SHA256, keyed by the secret's hash, over B's origin and the envelope nonce;
   - POSTs it to A.
4. **Server A**:
   - checks the secret in constant time, burns the invitation, and fetches B's declaration from B's own origin, confirming that the key in the envelope is the key B publishes;
   - answers with a signed `accepted` envelope that carries the link ID;
   - stores the link as **pending** on both sides.
5. **Each owner approves their side** in their own admin. A approves which of B's skills its assistant may offer, and which fields it may carry for each. B approves accepting handoffs from A and for which skills. Each `approve` is sent to the partner and shown there. The link is **active** in a direction only when both sides approved it.
6. **Revoking** marks the link revoked locally at once and notifies the partner. Revoking never waits for the partner to answer.

**Why this is safe enough.** An invitation only lets someone pair the origin whose declaration holds the matching key. Someone who intercepts a code cannot pose as B: they can only pair their own site. Owner A sees that site's origin and name before approving. Key rotation works like action calls: after a failed signature, the receiver re-reads the partner's declaration at most once a minute.

### Link record

Each side stores, per partner:

```json
{
  "id": "lnk_…",
  "role": "invitee",
  "status": "active",
  "partner": {
    "origin": "https://hotel.test",
    "name": "Hotel Test",
    "endpoint": "https://hotel.test/pagesquire/link",
    "publicKey": "ed25519:…",
    "skills": [{ "id": "find_room", "name": "Find a room", "…": "…" }]
  },
  "ours": {
    "approved": true,
    "offer": { "find_room": ["checkIn"] },
    "accept": ["book_table"]
  },
  "theirs": { "approved": true, "accept": [] },
  "createdAt": 1830000000000,
  "updatedAt": 1830000060000
}
```

- `ours.offer` holds the partner's skills this site may offer, with the fields each may carry.
- `ours.accept` holds this site's own skills the partner may hand visitors into.
- `theirs.accept` is what the partner told us it accepts from us. A skill is offered only when it is in our `offer` and in their `accept`.
- `revokedBy` (`us` or `partner`) is set once the link is revoked.

Each stack stores links its own way. Every store keeps one JSON document of links, open invitations and recently seen nonces:

| Stack      | Storage                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| Node       | A `LinkStore` interface, with `MemoryLinkStore` and `FileLinkStore`                                       |
| Native PHP | A `LinkStore` interface, with `MemoryLinkStore` and `FileLinkStore` (file locks)                          |
| Laravel    | `FileLinkStore` at `storage/app/pagesquire-links.json` (`PAGESQUIRE_LINK_STORE`), or bind any `LinkStore` |
| WordPress  | The `pagesquire_links` option, not autoloaded, behind an option-name lock                                 |

## Using Link (Phase 6A)

Link needs the site key from [signed action calls](companion-extension.md#signed-action-calls), HTTPS (plain HTTP only for `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` and `*.test`), and at least one skill in the site's catalog if partners should hand visitors in.

**Laravel.** Set `PAGESQUIRE_SIGNING_KEY` and `PAGESQUIRE_LINK=true`, optionally `PAGESQUIRE_LINK_NAME`, and list skills under `pagesquire.link.skills` in `config/pagesquire.php`. The package then serves `POST /pagesquire/link` (rate limited per IP) and adds the `link` section to `/.well-known/pagesquire.json`. Owners use:

```bash
php artisan pagesquire:link-invite --hours=24
php artisan pagesquire:link-accept psq1.…
php artisan pagesquire:link-list
php artisan pagesquire:link-overview
php artisan pagesquire:link-approve lnk_… --offer=book_table:date,people --accept=find_room
php artisan pagesquire:link-revoke lnk_…
```

**Native PHP.** Build a `PageSquire\Server\Link\LinkManager` from the `ActionSigner`, a `FileLinkStore` and a profile (`endpoint`, `name`, `skills`). Serve `LinkEndpoint::handle()` at the endpoint path, and pass `$manager->declaration()` as the third argument of `ActionSigner::declaration()`.

**Node.** Build a `LinkManager` with `{ store, signingKey, origin, profile }`, route `createLinkHandler(manager)` at the endpoint path, and pass `link: manager.declaration()` to `siteDeclaration()`. The owner operations are the manager's `createInvitation`, `acceptInvitation`, `list`, `approve` and `revoke`.

**WordPress.** In step 6 of the PageSquire dashboard, enable Link, name the site and list its skills as JSON. The plugin creates and encrypts a site key (or uses `PAGESQUIRE_SIGNING_KEY` from `wp-config.php`), serves the declaration and the REST route `pagesquire/v1/link`, and lets the owner invite, accept, approve and revoke. WordPress must run at the domain root.

Approving or revoking tells the partner at once. If the partner cannot be reached, the change still applies locally and the result reports `notified: false`; approve again later to tell it.

## Handoff (Phase 6B)

Implemented so far (6B-1), in Node and native PHP:

- `handoff(linkId, { skill, goal, fields, locale })` on A checks the scope and B's field schemas, sends a signed `handoff` envelope and returns B's start URL with the code.
- B checks its own side again: the link is active, it accepts the skill from A, and every field is declared and valid. It stores the ticket under the SHA-256 of a random 128-bit code for two minutes and answers with a signed `ticket` envelope.
- `redeem(code)` on B returns the ticket once, and only while the link is still active.
- Field values follow one set of rules in both stacks (`linkValueAllowed`, `Link::valueAllowed`), checked against a shared vector. The rules cover types, bounds, `enum`, `pattern`, the `date`, `time` and `email` formats, at most 200 characters, and no control characters. A goal is one line of at most 300 characters.

Implemented in 6B-2, in the Node and PHP engines, Laravel and WordPress:

- **The tool.** `createLinkCapabilities()` (core) and `Link::handoffCapability()` (PHP) define `link.handoff`. With `EngineOptions.links` (a `LinkManager`), the engine offers it only while an active link allows a skill in both directions. Laravel adds it to the catalog when `PAGESQUIRE_LINK` is on, and the `pagesquire.capability` gate still decides who may use it. WordPress adds it while Link is enabled.
- **What the model sees.** Each turn carries the offered skills as `partnerSkills` data: partner name, skill name and description, examples, and the allowed fields with their schemas.
- **Checks on a proposal.** Unknown skills and invalid goals are refused with a fixed reply. Fields outside the scope or the partner's schema are dropped. Contact details, links or long numbers that the visitor never gave refuse the proposal. The engine then sets `partner` itself.
- **Consent.** A `ChatRequest` with `handoff: { callId }` and the `conversationId` sends the ticket, once per call, and answers with `response.handoff.url`. The pending call then completes with a normal browser result.
- **Arrival.** A `ChatRequest` with `linkCode` and no `conversationId` redeems the code once. It starts a conversation whose first message is "Continued from Partner (host): goal". The ticket's fields arrive as `untrustedHandoff` data each turn. An unknown, used or expired code is refused with `HANDOFF_EXPIRED` (410).

Implemented in 6B-3, in the browser:

- **Consent.** `createLinkBindings({ approve })` (core) runs `link.handoff`. It shows the partner's name, its origin, the goal and every field in a "Continue on …?" prompt (`createVisitorPrompt`, English and Indonesian). Cancel ends the call as cancelled, and nothing is sent.
- **The new tab.** Continue opens a blank tab at once, while the click still counts as a user gesture, and clears its `opener`. Then `AssistantClient.approveHandoff()` asks the server for the ticket. The tab goes to the returned address only when its origin is the approved partner's and it carries a `#psq-link=` code; otherwise the tab closes.
- **Arrival.** `mountLinkArrival(host, client)` (client) removes the `#psq-link=` fragment from the address bar as the page loads and shows a "Continue from a partner site" banner. Only Continue redeems the code, through `AssistantClient.arrive()`. Dismiss discards it. An expired or used code shows a clear message.
- **Setup.** The embed takes `data-link="true"`, and the WordPress frontend turns this on by itself while Link is enabled. Custom setups add `createLinkCapabilities()` to the browser manifest, merge `createLinkBindings({ approve: (id, signal, skill) => client.approveHandoff(id, signal, skill) })` into the registry, give the runtime a visitor prompt and an action timeout of about 20 seconds, and call `mountLinkArrival`. Pages need a secure context: HTTPS, or `localhost` in development.

1. **The model proposes it.** For each active link, the system prompt lists the partner skills it may offer: the partner name, the skill description and the allowed fields. The model calls `link.handoff` with `{ "skill": "resto.test/book_table", "goal": "…", "fields": { … } }`.
2. **Server A checks the proposal before the browser sees it:**
   - the link is active and the skill is offered;
   - each field is allowed and matches B's schema;
   - each value passes typed-data screening against the visitor's own messages;
   - the goal is at most 300 characters.

   Fields that fail are dropped. If the call then has no goal, it is refused. The call is signed like any other.

3. **The browser asks the visitor.** A consent prompt shows the partner name and origin, the goal and a table of fields. The prompt lists the fields and is localized.
   - **Continue** opens a blank tab immediately, so the click counts as a user gesture and popup blockers allow it.
   - The handler then POSTs the pending call ID to A's link route on the same origin, with the usual CSRF and session checks.
4. **Server A sends the ticket.** It rebuilds the ticket from its own pending call, never from the browser, signs a `handoff` envelope and POSTs it to B.
5. **Server B stores the ticket.** It verifies the envelope and checks that it accepts this skill from A and that the fields fit its schema. It then stores the ticket under a random 128-bit code for two minutes and answers with `https://resto.test/reservations#psq-link=CODE`.
6. **Browser A sends the visitor on.** It clears the new tab's `opener` and navigates it there. The action is verified when the tab opened. A's model can then tell the visitor where to continue.
7. **The embed on B picks it up.** It reads `#psq-link=…`, removes it with `history.replaceState`, and opens the widget with a banner: "Continued from hotel.test: book a table for 4, tonight, 19:00", with **Continue** and **Dismiss**.
8. **Continue redeems the code.** The click sends a chat request with the optional `linkCode`. Server B redeems the code once and starts a conversation. The goal becomes the visitor's message, prefixed "Continued from hotel.test:". The fields are added as an `untrustedHandoff` object beside the page snapshot. B's assistant then drives with B's own capabilities.

Codes are single use and short-lived, and live only in a fragment. A page script on B that reads the code before the embed would still face B's normal session, CSRF and origin checks to redeem it, and could only start the visitor's own conversation.

### Return (Phase 6C)

A return answers a handoff, so it needs no extra owner setting:

1. **A keeps a return reference.** When the visitor approves a handoff, A records a single-use reference (`ret_…`) for the page they approved it on, valid for 24 hours. It sends the reference with the ticket. A page on another origin is ignored, so a return can only open A itself.
2. **B offers `link.return` once.** A visitor who arrived with such a ticket can be sent back. B's model calls `link.return` with a one-line outcome, such as "Table for 4 booked for 29 October, 19:00". The engine checks it like a goal: one line, at most 300 characters, and no contact details, links or long numbers the visitor never gave. It then sets the partner itself.
3. **The visitor approves.** A "Back to Hotel Nusa?" prompt shows the outcome and A's origin. Only Continue sends anything.
4. **A answers with a ticket.** B signs a `return` envelope with the reference and the outcome. A checks that the reference is open and belongs to this link, uses it up, and answers with a `ticket`: its own page with a fresh `#psq-link=` code.
5. **The visitor arrives back.** A's banner redeems the code once and starts a conversation whose first message is "Back from Restoran Laut (resto.test): …". Fields never come back, only the outcome.

`LinkManager.sendBack(linkId, { returnId, outcome, locale })` (Node) and `sendBack()` (PHP) send a return. Tickets carry `kind: 'handoff' | 'return'`, and a handoff ticket carries the `returnId` to send back with.

**Owner counts.** Each link record keeps `stats: { sent, received, skills, lastAt }`. `sent` and `received` count the visitors handed off or returned in each direction. `skills` counts handoffs per skill, and `lastAt` is the time of the last one either way. All of it is counted locally and reported to no one.

### Several partners (Phase 6D)

An owner can link several partners that offer the same service, such as two restaurants that both publish a `book_table` skill. Partners count as offering the same service when their skill IDs are identical, so a shared ID such as `book_table` lets them be grouped.

1. **The model names one partner.** `partnerSkills` lists every offered skill, and the model calls `link.handoff` with any one of them.
2. **The engine adds the others.** Up to three other active partners with the same skill ID become `alternatives`. Each carries only the fields that its own link scope and its own schema allow, from the same screened values. The model cannot add or remove partners, so a page that injects instructions cannot hide a partner from the visitor or add one.
3. **The visitor chooses.** The consent prompt asks "Where do you want to continue?" and shows one block per partner: its name, its origin and the fields it would receive, each with its own **Continue on …** button. Cancel sends nothing to anyone.
4. **Only the chosen partner hears of it.** The browser reports the choice as `ChatRequest.handoff.skill`. The server accepts only a partner it showed in that call, rebuilds the ticket from its own pending call, and sends it to that partner alone. The new tab must land on the chosen partner's origin.

The model's pick is listed first, and the other partners follow in the order they were linked. Commission or ranking does not affect the order.

**Owner overview.** `LinkManager.overview()` (Node and PHP) returns:

- link counts by status;
- total visitors sent and received;
- `offered`: the partner skills the assistant may offer now, grouped by skill ID with the partners for each;
- `accepted`: this site's own skills, with the active partners that may hand visitors into each.

`php artisan pagesquire:link-overview` prints this with each partner's per-skill counts and last activity. In WordPress, the **Overview** section of the Partners step shows the same, and each partner card adds its per-skill counts.

## Protocol changes

All additions are optional, like earlier phases:

- `ChatRequest.linkCode`: an opaque code, at most 64 characters.
- `ChatRequest.handoff: { callId, skill? }`: the visitor's approval, and in 6D the partner they chose.
- `link.handoff` parameters gain engine-set `alternatives` (6D): at most three `{ skill, partner, fields }`.
- `ChatRequest.linkCode` also redeems an A2A agent's code (6E), read from a `#psq-agent=` fragment. The A2A endpoint itself is plain A2A 1.0 JSON-RPC, outside the PageSquire protocol.
- New built-in capabilities `link.handoff` and, in 6C, `link.return`. Both run in the browser and their calls are signed. They are offered only when an active link allows them.
- Declaration `features: ["link"]` and a `link` object (endpoint, name, skills).
- A server-to-server envelope versioned on its own (`v: 1`), with shared Node and PHP test vectors in `tests/fixtures/link.json`.

## Implementation map

| Piece                         | Node (`@pagesquire/server`)                                               | PHP (`pagesquire/server`) | Laravel                                                                                            | WordPress                                   |
| ----------------------------- | ------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Envelopes, invitations, store | `link.ts`: `LinkManager`, `LinkStore`, `MemoryLinkStore`, `FileLinkStore` | `Link\\*` classes         | Uses the PHP package                                                                               | Uses the PHP package                        |
| Link endpoint                 | `createLinkHandler()` for Next.js or Node routes                          | `LinkEndpoint`            | `POST /pagesquire/link` route                                                                      | REST route `pagesquire/v1/link`             |
| Owner controls                | `LinkManager` methods, `overview()`                                       | Same                      | Artisan: `link-invite`, `link-accept`, `link-list`, `link-overview`, `link-approve`, `link-revoke` | Step 6, **Partner sites**, with an overview |
| Engine                        | `EngineOptions.links`: partner skills, handoff checks, `untrustedHandoff` | Same                      | Config `pagesquire.link`                                                                           | Settings                                    |
| Browser                       | —                                                                         | —                         | —                                                                                                  | —                                           |

Browser pieces live in core, the client and the embed:

- the consent prompt (`createLinkPrompt`, English and Indonesian);
- the `link.handoff` handler and verifier;
- reading the fragment, the banner and `linkCode` in the client;
- embed attribute `data-link="true"`.

## A2A interface (Phase 6E)

Partner skills use A2A 1.0's `AgentSkill` shape. A site can also open some of its skills to any A2A agent, such as a person's own AI assistant. This is off by default, and the owner picks the skills.

**What an agent gets.** An agent sends a request into an open skill and receives a single-use link, never an action. The person opens the link, sees a "Continue a request from an AI agent" banner, and continues with one click. The site's assistant then acts with the site's own capabilities and approvals, like any other visitor request. The agent never gets a session, a conversation or data from the site.

**Agent Card.** The site publishes `/.well-known/agent-card.json`. The card lists:

- the open skills;
- one interface, `{ "url": "https://resto.test/pagesquire/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" }`;
- `capabilities` with streaming and push notifications off;
- an extension with each open skill's fields (the `uri` is this section).

The card is signed with the site key as A2A section 8.4 describes:

1. The card without `signatures` is canonicalized with RFC 8785 (JCS).
2. A JWS is made with the protected header `{ "alg": "EdDSA", "typ": "JOSE", "kid": …, "jku": "https://resto.test/.well-known/pagesquire-keys.json" }`. `kid` is the RFC 7638 thumbprint of the key.
3. `/.well-known/pagesquire-keys.json` serves the JWK Set with the Ed25519 key. It is the same key as the `publicKey` in `/.well-known/pagesquire.json`.

Node and PHP sign the shared vector in `tests/fixtures/a2a.json` byte for byte the same.

**The endpoint.** It speaks JSON-RPC 2.0 and needs `A2A-Version: 1.0`, as a header or a query parameter.

- **`SendMessage`** takes one `ROLE_USER` message whose parts are text and at most one data part `{ "skill": "book_table", "goal": "A table for 4 on 29 October", "fields": { "date": "2026-10-29", "people": 4 } }`. Text alone is enough when one skill is open; it becomes the goal.
- **Checks.** The site checks the request like a partner's handoff: the skill must be open, the goal one line of at most 300 characters, and every field declared and valid. A goal with a link is refused, because the visitor reads it as their own request.
- **The answer** is a `message` with a text part and a data part `{ "url": "https://resto.test/reservations#psq-agent=…", "expiresAt": "…" }`. The code works once, for 10 minutes, and only while the A2A interface stays on.
- **No tasks.** The site keeps no tasks, so `GetTask`, `CancelTask` and `SubscribeToTask` answer `TaskNotFoundError` (-32001). Streaming, task lists and push notifications answer with their unsupported errors. Files and URLs in parts answer `ContentTypeNotSupportedError` (-32005), and other A2A versions answer `VersionNotSupportedError` (-32009).

**Arrival.** The `#psq-agent=` fragment works like `#psq-link=`: it leaves the address bar at once, and only Continue redeems it. The first message is "Request from an AI agent: …". The fields arrive as `untrustedHandoff` with `from: "an AI agent (A2A)"` instead of a partner, and there is nothing to return to.

**Owner controls.** The endpoint is public, so rate-limit it per address. Laravel allows 30 requests per minute by default, and WordPress 30. The overview counts the requests agents sent (`agents.received`).

| Stack     | Setup                                                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node      | `new LinkManager({ …, a2a: { endpoint: '/pagesquire/a2a', skills: ['book_table'] } })`. Serve `manager.agentCard()` and `manager.agentKeys()` at the two well-known paths, and route `createA2AHandler(manager)` at the endpoint. |
| PHP       | Pass `a2a: ['endpoint' => '/pagesquire/a2a', 'skills' => ['book_table']]` to `LinkManager`. Serve `agentCard()` and `agentKeys()`, and `A2AEndpoint::handle()` with the `A2A-Version` header at the endpoint.                     |
| Laravel   | `PAGESQUIRE_A2A=true` and `pagesquire.link.a2a.skills`. The package serves the card, the key set and `POST /pagesquire/a2a` (throttled).                                                                                          |
| WordPress | In step 6, tick **Let AI agents send requests (A2A)** and list the skill IDs. The plugin serves the card, the key set and the REST route `pagesquire/v1/a2a`.                                                                     |

## Testing

- **Unit (Node and PHP):**
  - envelope signing against a shared vector;
  - invitation lifecycle, including expiry, reuse and a wrong secret;
  - scope enforcement per direction;
  - typed-data screening of carried fields;
  - code expiry and single use;
  - revocation;
  - key rotation.
- **Cross-stack integration (Playwright):** a Node site on `127.0.0.1` and a native PHP site on `localhost`, each with its own server, key and store. The test pairs them through the owner functions and runs a full handoff, in which B fills its form by itself after one click. A second fixture pairs Node with WordPress.
- **Hostile cases:**
  - a forged or replayed envelope;
  - an expired or reused code;
  - a field outside the scope;
  - a value the visitor never said;
  - a revoked link;
  - an injected page asking A to hand off to an undeclared partner;
  - a goal containing instructions, which B shows and does not obey;
  - an invitation used twice.

## Phases

| Phase  | Scope                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **6A** | Site key reuse, declaration `link` section, envelopes, invitations, pairing, approval, revocation, link stores, owner controls in every stack |
| **6B** | `link.handoff`, consent prompt, ticket delivery, codes, B's banner and continuation, `linkCode`                                               |
| **6C** | Returns, partner skills in the system prompt per scope, local handoff counts for owners                                                       |
| **6D** | Several partners per skill, choosing between them, owner dashboards                                                                           |
| **6E** | Optional A2A interface and signed Agent Card                                                                                                  |

## Decisions

Taken with the owner on 2026-10-29:

1. **Destination:** a new tab, so the visitor keeps site A.
2. **On arrival:** one confirmation click on B, then B continues on its own.
3. **Data by default:** only the goal summary. Other fields need the link scope and the visitor's approval.
4. **No business layer:** no referral or commission tracking. Owners get local counts only.
5. **Standards:** the catalog uses A2A's skill shape. The A2A interface (6E) is optional, answers only with single-use links, and keeps no tasks.

Open for later:

- whether B may pre-fill fields without its own form (the default is no, so B always acts through its own verified capabilities);
- whether the site key should be split into a signing key and a link key for larger deployments.
