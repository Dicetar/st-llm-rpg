# SillyTavern bridge and narrator proxy

Status: accepted as the provisional interface design for Wayfinder issue #19. Wayfinder #20 must prove it against the pinned SillyTavern build and real LM Studio before implementation depends on it.

## Decision

Use one versioned request envelope and one deep `Narration.respond` Interface.

The SillyTavern Bridge reads the current chat's binding marker and locator for every generation, validates the pinned Custom Chat Completions configuration, and writes exactly one reserved header. The companion rejects a missing or invalid envelope; it never interprets missing bridge metadata as an unlinked request. Narration alone decides linked versus unlinked behavior. Fastify does not orchestrate binding checks, Context, inference stages, recovery, or retry.

Linked narration fails closed, pins the verified Campaign and Binding Revisions, performs all Context and model work before committing successful response headers, and exposes only one final complete response. Explicit unlinked narration bypasses Campaign and Context and transparently forwards one request to LM Studio. Narration never mutates Campaign or Chat Binding state and never automatically retries a model call.

This design fixes:

- the browser-to-companion wire contract;
- chat locator evidence and generation-mode metadata;
- bridge guard behavior;
- route admission and fail-closed rules;
- linked and unlinked delivery semantics;
- cancellation, retry, recovery, diagnostics, and error shapes;
- the public test seams and the obligations for the real compatibility prototype.

It does not fix retrieval scoring, Context Capsule rendering, enrichment prompts, model profiles, or the final number of useful enrichment revisions. Those remain inside Context and Narration and are decided by Wayfinder #21 and #22, subject to the two-revision cap in ADR 0010.

Evidence:

- [SillyTavern narrator-proxy contract](../research/sillytavern-proxy-contract.md)
- [Companion runtime and module seams](./companion-runtime-and-module-seams.md)
- [Campaign authority, history, and Chat Binding lifecycle](./campaign-authority-history-and-bindings.md)
- ADR [0010](../adr/0010-use-preflight-context-with-bounded-hidden-draft-enrichment.md), [0011](../adr/0011-use-a-single-process-typescript-companion-with-capability-modules.md), and [0012](../adr/0012-separate-campaign-and-binding-history-with-replayable-events.md)

## Designs considered

### Design A: minimal transaction facade

This design used one encoded header and one `Narration.respond(exchange, signal)` method. All ordering remained private. Fastify received either a transparent upstream response, an atomic linked completion, or a typed Problem.

Its strength is Depth and misuse resistance. A caller cannot select a direct path, skip binding verification, deliver a hidden draft, or retry a stage. Its weakness is that tests need scripted dependencies and diagnostics to observe private phases rather than invoking phases directly.

Selected as the public shape.

### Design B: explicit stage graph

This design exposed `admit`, `classify`, `verifyRoute`, `prepareLinked`, `generateDraft`, `planEnrichment`, `produceCandidate`, `seal`, and `encodeSuccess` with opaque one-use handles.

It offered excellent fault injection and made the state machine visible. It also made the Fastify Adapter coordinate ten methods, required a session registry merely to reject skipped or replayed handles, and invited future HTTP code to own workflow policy. It buffered unlinked replies, which conflicts with direct LM Studio streaming and Stop behavior.

Rejected as a public Interface. Its stage vocabulary and failure-injection cases are retained privately and in #20's fixtures.

### Design C: transaction with reply port

This design kept one `transact` method but passed a one-shot delivery port into Narration. It made exactly-once delivery explicit and kept route ordering private.

It was safer than the stage graph, but it coupled Narration to HTTP delivery lifetime and made transport commit part of the capability Interface. Atomicity can be proven at the Fastify Adapter seam without importing a reply port into Narration.

Rejected as the public shape. Its separate `complete-message` and `continuation-suffix` result types are retained.

### Selected synthesis

The public Interface is Design A. The Implementation uses Design B's private state machine. The result union uses Design C's semantic content distinction. Scripted Campaign, Context, LM Studio, cancellation, clock, and HTTP Adapters expose behavioral evidence without letting production callers control stages.

All three proposals initially discarded a usable hidden draft after enrichment failure. That contradicts the locked recovery requirement. The selected design instead keeps a bounded candidate in volatile memory and supports one explicit user recovery choice. It never silently delivers the candidate and never writes it to SQLite, disk, logs, diagnostics, chat, or Campaign history.

## Owned wire contract

### Endpoint and header

The pinned SillyTavern Custom endpoint is:

```text
http://127.0.0.1:8002/v1
```

The first companion exposes:

```text
GET  /v1/models
POST /v1/chat/completions
```

`GET /v1/models` carries no RPG envelope, performs no Campaign or Binding work, and forwards the LM Studio model catalog.

Every `POST /v1/chat/completions` carries exactly one:

```http
X-ST-RPG-Exchange: v1.<unpadded-base64url-canonical-utf8-json>
```

One envelope prevents partially updated route, binding, locator, generation, and version headers. The bridge removes every existing case-insensitive `X-ST-RPG-Exchange` entry from the per-request Custom-header copy before inserting the current value. Unrelated Custom headers are preserved. Reserved RPG headers are never forwarded to LM Studio.

The decoder inspects raw headers before framework normalization and rejects missing or duplicate logical values. The encoded value must use the `v1.` prefix, unpadded base64url, canonical JSON, exact known fields, and a decoded size no greater than 4 KiB. Malformed encoding, duplicate keys, unknown fields, invalid UUIDs, unsupported versions, and invalid discriminated-union combinations fail before Campaign, Context, or LM Studio work.

### Envelope

```ts
type StRpgExchangeV1 = Readonly<{
  protocol: "st-rpg.narration";
  version: 1;
  requestId: RequestId; // lowercase RFC 4122 UUID v4
  route:
    | { kind: "linked"; bindingId: ChatBindingId }
    | { kind: "unlinked" };
  generation:
    | "normal"
    | "regenerate"
    | "continue"
    | "swipe"
    | "quiet"
    | "impersonate";
  locator: ChatLocatorV1;
  bridge: {
    version: string;
    sillyTavernRevision:
      "380e31e8c58d196969b6a0da74f431ba999c7e0a";
  };
  recovery?: {
    id: RecoveryId;
    action: "retry-enrichment" | "use-unenhanced-draft";
  };
}>;

type ChatLocatorV1 = Readonly<{
  version: 1;
  hostId: string; // UUID persisted once by the bridge installation
  chat:
    | {
        kind: "character";
        ownerId: string; // character avatar filename, never array index
        chatId: string;
      }
    | {
        kind: "group";
        ownerId: string; // SillyTavern group ID
        chatId: string;
      };
}>;
```

For linked requests, only `normal`, `regenerate`, `continue`, and `swipe` are valid. `quiet` and `impersonate` are rejected before model work because they are not ordinary linked narration. Explicit unlinked requests may pass those modes through. `stop` is not a generation value; Stop is a disconnect and cancellation signal.

`recovery` is valid only on a linked request and must match a live volatile recovery entry for the same Binding, locator, generation contract, request-body fingerprint, and pinned authority. A recovery request always has a fresh Request ID. A normal request cannot carry an arbitrary recovery choice.

### Chat metadata and locator meaning

The bridge stores only a small marker in current SillyTavern chat metadata:

```ts
type ChatBindingMarkerV1 = Readonly<{
  version: 1;
  bindingId: ChatBindingId;
}>;
```

The marker contains no Campaign ID, Campaign Revision, player data, or Context. Campaign and Binding authority stays in SQLite.

On every generation:

- a successfully read valid marker becomes an explicit linked route;
- an absent marker becomes an explicit unlinked route;
- an unreadable, malformed, or unsupported marker blocks locally;
- a stale formerly-linked marker remains a linked attempt, allowing the companion to return `binding_unlinked`, `binding_not_found`, or the retained tombstone state;
- failure of the request hook produces no envelope, which the companion rejects rather than treating as unlinked.

`ChatBindingId` remains canonical identity. `ChatLocatorV1` is presented evidence for collision and mismatch detection; the companion never finds a Binding by locator and never silently binds a chat. Renames, copies, imports, and moved chat files may change or preserve this evidence. If two copied chats are indistinguishable in the pinned host fields, the system reports that limitation and does not guess. #20 must measure the exact cases.

## Bridge behavior

The external Interface stays intentionally thin:

```ts
interface SillyTavernBridge {
  mount(context: PinnedSillyTavernContext): () => void;
}
```

`mount` installs the pinned generation interceptor, the awaited `CHAT_COMPLETION_SETTINGS_READY` listener, the native Workspace/recovery surfaces, and clean teardown. The Adapter owns SillyTavern event names, mutable request objects, settings APIs, and `Popup`; none enter companion domain Modules.

The generation interceptor synchronously verifies:

- Custom OpenAI Chat Completions is selected;
- the Custom base URL is exactly the configured companion `/v1` URL;
- the pinned SillyTavern revision and bridge protocol are supported;
- current chat metadata and locator fields are readable;
- linked generation is one of the four supported modes;
- a pending recovery instruction belongs to this chat and mode.

It catches every failure, shows one actionable bridge status, and calls `abort(true)`. Throwing is insufficient because SillyTavern swallows interceptor/listener exceptions.

The awaited settings listener reconstructs the same current description, parses existing Custom-header YAML, removes stale reserved values, merges the one current envelope, validates its own output, and reserializes it. Invalid YAML or a merge failure blocks through the interceptor when observable; the companion's missing/invalid-envelope check is the final guard. No arbitrary delay, cross-extension DOM event, overlay, or `z-index` escalation coordinates navigation.

The pinned SillyTavern server drops arbitrary browser body properties when rebuilding the Custom request, so route metadata is never placed only in the request body. Competing extension ordering and a later listener that removes or changes the header are explicit #20 compatibility failures.

## Narration Interface

```ts
interface Narration {
  respond(
    exchange: NarratorExchangeInput,
    signal: AbortSignal,
  ): Promise<Outcome<ProxyDelivery>>;
}

type NarratorExchangeInput = Readonly<{
  exchangeHeader: string | readonly string[] | undefined;
  completionBody: unknown;
}>;

type ProxyDelivery =
  | {
      kind: "transparent";
      requestId: RequestId;
      upstream: ManagedLmStudioResponse;
    }
  | {
      kind: "atomic";
      requestId: RequestId;
      model: string;
      stream: boolean;
      content:
        | {
            kind: "complete-message";
            generation: "normal" | "regenerate" | "swipe";
            text: string;
          }
        | {
            kind: "continuation-suffix";
            generation: "continue";
            text: string;
          };
      finishReason: "stop" | "length";
    };
```

Fastify passes raw header evidence and an unknown body to `respond`. It does not preselect `linked()` versus `unlinked()`. Only Narration may return a transparent upstream response, and only after validating an explicit unlinked envelope.

Unknown OpenAI-compatible inference fields are retained for transparent unlinked forwarding. Linked requests require Chat Completions, one choice (`n` omitted or `1`), and no operative `tools`, `tool_choice`, or `parallel_tool_calls`. Historical tool-role messages may remain in received chat history, but Narration adds no tools and does not permit a model tool call. Linked request normalization may enforce model/output limits and the accepted stop sequences; it must not silently change narrative sampling controls.

## Private state machine and ordering

The following states are private Implementation detail, not methods available to Fastify:

```text
Received
  -> Admitted
     -> UnlinkedForwarding -> Delivered | Failed | Cancelled
     -> BindingVerified
        -> PreflightReady
        -> DraftReady
        -> EnrichmentPlanned
        -> CandidateReady
        -> FinalBuffered
        -> Delivered

DraftReady | EnrichmentPlanned
  -> Recoverable -> RecoveredCandidate | Failed | Expired
```

Ordering and invariants:

1. Decode the envelope and validate the Chat Completion shape before any dependency call.
2. Reject a Request ID already seen during the current Host epoch. Request IDs correlate attempts; they are not narration idempotency keys and never replay prose.
3. Explicit unlinked route: strip RPG headers, make no Campaign or Context call, start exactly one LM Studio request, and return its status, body, streaming cadence, and cancellation semantics transparently.
4. Linked route: read the Chat Binding by canonical Binding ID and compare its accepted locator with the presented locator.
5. Reject missing, unlinked, collided, mismatched, or purged Binding; archived Campaign; Anchor/head mismatch; or unavailable/corrupt authority before Context or inference.
6. Pin the exact Campaign Revision, Binding Revision, and relevant Binding facet revisions for the entire attempt. A later Campaign change does not alter the attempt; the next request observes it.
7. Ask Context for deterministic preflight material and an inspectable selection/omission plan.
8. Run one hidden Narration Draft inference through the narrator-priority model lane.
9. Ask Context for enrichment material. Run only the bounded, planned enrichment revisions permitted by ADR 0010 and #21; these planned passes are not retries.
10. Validate material-action preservation and generation-mode semantics. `continue` returns suffix bytes only. `normal`, `regenerate`, and `swipe` return a complete reply.
11. Buffer the complete final visible reply and recheck cancellation.
12. Return one atomic delivery. Only then may Fastify commit successful response headers.

No linked stage creates a Campaign Event, Binding Event, accepted Operation, Sync Boundary change, journal entry, or automatic Anchor advancement. Diagnostics and volatile recoveries are operational state, not Campaign history.

## Delivery contract

### Explicit unlinked

Unlinked behavior is deliberately transparent. The companion makes one LM Studio exchange and preserves request fields, status, error body, SSE fragmentation/cadence, non-streaming body, and partial-stream Stop behavior where practical. It performs no Campaign or Context work. The only companion work is envelope admission, stripping reserved headers, cancellation wiring, bounded diagnostics, and forwarding.

This route remains available when Campaign authority is unavailable, provided the bridge has explicitly described the chat as unlinked and LM Studio is healthy. Missing wire metadata still rejects.

### Linked streaming

For `stream: true`, the companion emits no success header, heartbeat, placeholder, draft, or partial content while Context and model work runs. After final buffering it emits exactly:

1. one standard `chat.completion.chunk` containing the complete final text;
2. one finish chunk with `finish_reason`;
3. `data: [DONE]`.

### Linked non-streaming

For `stream: false`, the companion emits one ordinary OpenAI `chat.completion` document containing one choice.

Successful linked completion IDs use `chatcmpl-rpg-<requestId>`. The model field reports the actual narrator model. Usage is omitted unless the proxy can report the multi-stage accounting honestly; full per-stage accounting belongs in redacted diagnostics instead of a misleading aggregate.

Atomic delivery is an application guarantee, not a TCP transaction. Before the first successful header, cancellation commits no assistant bytes. Once final response commit begins, the socket may deliver the complete event or the disconnect may win. The companion never performs a later second write. #20 must characterize this unavoidable final-commit race in real SillyTavern chat JSONL.

## Cancellation and deadlines

Fastify converts request disconnect/abort into one `AbortSignal`. Narration fans that same signal through Binding reads that can cancel, Context, queue wait, every LM Studio fetch/stream, recovery preparation, and final delivery check.

Cancellation is terminal for the Request ID:

- before linked success commit: abort active work, discard all candidates, send no synthetic response after disconnect, and write no delayed result;
- during unlinked streaming: abort LM Studio and preserve ordinary partial-stream Stop behavior;
- during linked final commit: record whether commit began and never retry or write again;
- a late dependency result after cancellation is ignored.

No heartbeat is sent while linked work is buffered. The provisional whole-exchange deadline is 15 minutes, with bounded per-model output and buffer limits; it is not an automatic retry trigger. #20 must measure pinned SillyTavern, browser, reverse-free local HTTP, LM Studio, and real-phone behavior and may lower or replace this deadline from evidence. Cancellation should reach active LM Studio I/O within 250 ms on the local host.

## Retry and recoverable enrichment

There are no automatic retries for connection refusal, reset, timeout, malformed SSE, hidden-reasoning-only output, empty visible output, or failed enrichment. A new ordinary user generation receives a fresh Request ID.

Failures before a usable draft return a Problem with configuration, reconciliation, or manual-retry actions. The same Request ID is never accepted again. Narration does not cache or replay a final assistant reply because it cannot prove whether SillyTavern committed it.

If a valid hidden draft exists but enrichment fails, Narration may create this volatile entry:

```ts
type RecoverableNarration = Readonly<{
  id: RecoveryId;
  originalRequestId: RequestId;
  bindingId: ChatBindingId;
  locator: ChatLocatorV1;
  generationContract:
    | { kind: "complete-message"; source: "normal" | "regenerate" | "swipe" }
    | { kind: "continuation-suffix"; source: "continue"; baseHash: string };
  requestBodyHash: string;
  authority: {
    campaignRevision: CampaignRevision;
    bindingRevision: BindingRevision;
    bindingFacets: BindingFacetRevisions;
  };
  expiresAt: string;
}>;
```

The candidate text is held in a bounded in-memory store for at most ten minutes. It is never written to SQLite, a temp file, backup, log, diagnostic, HTTP Problem, chat, or Campaign history. Restart, expiry, unlink, rebind, locator change, authority change, body-fingerprint change, or cancellation destroys it.

The Problem offers exactly `retry-enrichment`, `use-unenhanced-draft`, and `discard`. A choice is explicit and consumes the recovery entry:

- `retry-enrichment` reuses the same hidden draft and Context evidence, performs no new draft inference, and may perform only a remaining bounded enrichment attempt; if that attempt fails, a replacement Recovery ID may retain the same draft, but once the revision-attempt cap is exhausted it offers only Use unenhanced draft or Discard;
- `use-unenhanced-draft` performs no model call and promotes the candidate to the final visible reply;
- `discard` deletes the entry and performs no generation.

The Bridge owns the native recovery surface and the next pinned-ST generation invocation so SillyTavern, rather than Workspace or the companion, remains responsible for normal/regenerate/continue/swipe chat mutation semantics. The next request carries a fresh Request ID plus the matching `recovery` instruction. It must still pass current Binding, locator, authority, body-fingerprint, mode, and cancellation checks.

This recovery invocation is a design obligation, not yet compatibility evidence. #20 must prove that each generation mode saves exactly one correct assistant result without duplicating the user message or existing continuation. If the pinned API cannot do that safely, #20 must return this decision to Wayfinder rather than writing chat JSONL directly.

## Problems, diagnostics, and status mapping

```ts
type NarrationProblem = Readonly<{
  code: NarrationProblemCode;
  message: string;
  correlationId: RequestId | IncidentId;
  stage:
    | "metadata"
    | "request"
    | "binding"
    | "preflight"
    | "draft"
    | "enrichment"
    | "delivery";
  retryable: boolean;
  automaticRetry: false;
  actions: readonly RecoveryAction[];
  details?: BoundedDiagnosticDetails;
}>;
```

Expected HTTP failures use an OpenAI-shaped body:

```json
{
  "error": {
    "message": "This chat presents a different Chat Locator. [RPG request 6a1b...]",
    "type": "rpg_narration_error",
    "code": "RPG_BINDING_COLLISION",
    "param": null,
    "request_id": "6a1b...",
    "stage": "binding",
    "retryable": false,
    "actions": ["open-binding-resolution"]
  }
}
```

The request/correlation ID appears in the message because pinned non-streaming SillyTavern may discard structured upstream details. Missing metadata receives a companion-generated Incident ID. Do not use HTTP `401`; pinned SillyTavern rewrites it to `400`.

| Problem group | HTTP | Examples | Model calls before failure |
|---|---:|---|---:|
| Invalid wire/body | 400 | missing/duplicate/invalid envelope, unsupported wire version | 0 |
| Unsupported request | 422 | linked quiet/impersonate, `n > 1`, narrator tools, pins exceed budget | 0 |
| Human reconciliation | 409 | Binding not found/unlinked/collision/mismatch, Campaign archived | 0 |
| Upstream protocol | 502 | malformed SSE, empty visible output, invalid narrator result | 1 or more bounded stages |
| Dependency unavailable | 503 | Campaign authority or narrator unavailable | 0 or 1 |
| Deadline | 504 | bounded request deadline exceeded | stage-dependent |
| Internal fault | 500 | violated invariant or unexpected failure | stage-dependent |

Disconnect cancellation normally has no HTTP response. Reused Request IDs return `409` before another model call. Purged Binding tombstones return `409`, not a silent unlinked route.

Diagnostics record only bounded operational facts:

- request/incident ID, route, generation, terminal stage, and outcome;
- pinned Campaign/Binding/facet revisions when linked;
- model purpose, model name, elapsed time, and completed/failed/cancelled outcome;
- Context selection counts, token estimates, and omission codes without private text;
- response-commit state, byte count, cancellation state, and Problem code.

Diagnostics exclude OpenAI messages, rendered Context text, Campaign Private material, prompts, hidden drafts, enrichment candidates, final prose, Custom headers, and secrets. They are not Campaign Events. Retention is finite and implementation-configured; each entry is capped provisionally at 16 KiB.

## Public seams and Adapters

### True external dependencies

**SillyTavern**

- Production: `PinnedSillyTavernBridge` over the exact pinned commit.
- Behavioral counterpart: a scripted pinned-context Adapter reproducing awaited hook order, swallowed errors, `abort(true)`, YAML mutation, generation observations, native Popup ownership, and disconnect.
- Contract evidence: captured browser request, ST server reconstruction, companion request, response, and chat JSONL.

**LM Studio**

```ts
interface LmStudio {
  exchange(request: ModelExchange, signal: AbortSignal): Promise<ModelResult>;
}
```

- Production: native `fetch` and Web Streams against LM Studio Chat Completions.
- Behavioral counterpart: scripted fragmented SSE, delay, cancellation, malformed output, hidden-reasoning-only output, empty output, and call counters.
- No OpenAI SDK, generic provider registry, tools abstraction, or retry layer.

### Owned remote wire

A small wire Module owns the header constant, canonical codec, runtime schemas, derived TypeScript types, OpenAI Problem encoding, and fixtures. Production uses the browser encoder and Fastify decoder. Tests use an in-memory raw-header/body round trip that does not bypass admission.

### Owned in-process Modules

Campaign Engine, Context, Narration, and Inference Runtime remain in-process. Narration receives their Interfaces at composition time. Tests use scripted semantic Adapters at those same seams to assert call order, zero-call fail-closed cases, revisions, cancellation, and recovery without exposing stage methods.

Fastify is a thin outer Adapter. It extracts raw headers and disconnect, calls `Narration.respond` once, and maps exactly one `ProxyDelivery` or Problem. It never selects route, verifies Binding, chooses Context, invokes LM Studio directly for chat completions, retries, or decides whether a hidden draft is deliverable.

`GET /v1/models` is the one deliberate exception: the route calls the LM Studio catalog Adapter directly, requires no RPG envelope, and creates no Campaign or Binding activity.

## Performance and resource assumptions for #20

- bridge observation and encoding are synchronous and should remain below 10 ms;
- envelope admission should remain below 5 ms p95;
- unlinked proxy overhead before first upstream byte should remain below 10 ms p95 on the local host;
- linked Binding verification plus deterministic preflight should remain below 200 ms p95 excluding queue/model time;
- request body cap: provisional 4 MiB and 512 messages;
- final visible content cap: provisional 1 MiB, with a much smaller deployment default derived from model limits;
- linked model calls: one draft plus only the bounded enrichment revisions selected by #21, never automatic retry;
- cancellation reaches active LM Studio I/O within 250 ms locally;
- volatile recovery: at most ten minutes and bounded globally by count and bytes;
- no successful heartbeat while linked work is buffered.

These are prototype hypotheses, not release claims.

## Required prototype evidence for Wayfinder #20

1. Capture exact browser, pinned-ST server, companion, LM Studio, response, and chat JSONL fixtures for normal, regenerate, continue, and swipe.
2. Prove the single header survives YAML merge, Unicode locator values, ST server reconstruction, and forwarding exactly once; prove it is stripped before LM Studio.
3. Prove missing, duplicate, malformed, oversized, noncanonical, unsupported-version, unknown-field, and contradictory envelopes fail before Campaign, Context, or LM Studio.
4. Prove the interceptor catches and calls `abort(true)` for linked wrong source, wrong URL, unsupported mode, unreadable/malformed marker, incompatible revision, and failed header construction.
5. Exercise competing extension ordering. A later mutation must leave correct current metadata or produce a closed failure; it must never silently bypass a linked chat.
6. Probe exact character/group locator fields through rename, copy, import, duplicate, move, and host restart. Record which collisions are observable and which are indistinguishable.
7. Prove Binding not found/unlinked/tombstoned/collision/mismatch, archived Campaign, Anchor mismatch, authority outage, and history corruption contact neither Context nor LM Studio.
8. Prove verified linked attempts pass one exact Campaign Revision, Binding Revision, and facet vector to Context and never advance them.
9. Prove explicit unlinked requests perform no Campaign/Context work and match direct LM Studio request fields, status, errors, SSE cadence, Stop, and visible chat result.
10. Prove linked `n > 1`, tools/tool choice, quiet/impersonate, and legacy Text Completions reject before LM Studio; historical tool messages are characterized rather than silently deleted.
11. Prove normal creates one full assistant message, regenerate replaces once, swipe adds one alternative, and continue appends one suffix exactly once.
12. Prove no linked success header, heartbeat, placeholder, hidden draft, or partial content exists before final buffering; then verify one complete content chunk, one finish chunk, and `[DONE]`, or one complete non-streaming document.
13. Search HTTP fixtures, chat JSONL, logs, diagnostics, SQLite, and backups for hidden draft and Context leakage.
14. Stop during queue wait, preflight, draft, enrichment planning, each revision, and before final commit. Prove active work aborts, no delayed reply appears, and no Campaign/Binding Event is created.
15. Stop during final commit. Document the all-or-nothing event race and prove there is never a later second write.
16. Inject connection refusal, timeout, reset, fragmented/malformed SSE, hidden-reasoning-only output, and empty visible output; assert exact model-call counts and zero automatic retries.
17. Prove Request ID reuse cannot trigger a second model call or replay a possibly committed final reply.
18. With a scripted successful draft and failed enrichment, prove the volatile recovery contains no durable/logged prose, expires, invalidates on authority change, and offers Retry, Use unenhanced draft, and Discard.
19. Prove recovery for all four linked modes through pinned ST: one fresh Request ID, no duplicated user message, one correct complete/suffix result, and normal ST save semantics. If this cannot be proven, reopen the recovery design rather than writing chat JSONL directly.
20. Record exact ST rendering for every typed streaming and non-streaming Problem; prove the visible correlation ID opens the same redacted Workspace diagnostic.
21. Prove `/v1/models` works without the envelope and performs no Campaign/Binding activity.
22. Measure bridge time, unlinked overhead, held-open linked duration, body/buffer ceilings, cancellation propagation, recovery memory, and the provisional deadline.
23. Run send, Stop, regenerate, continue, swipe, outage, mismatch, and recovery on a real phone at roughly 360 CSS pixels through ST `:8001`, companion `:8002`, and LM Studio `:1234`. Emulation alone is not acceptance.

## Downstream obligations

- Wayfinder #20 must produce real compatibility evidence and may revise this provisional contract.
- Wayfinder #21 must keep exact/Scene/FTS/vector ranking, visibility, budgets, summaries, ambiguity, and Context selection inside Context rather than expanding the wire.
- Wayfinder #22 must measure hidden-draft fidelity, latency, recovery, and the two-revision ceiling on the actual 16 GB system and representative models.
- Wayfinder #24 must use the shared Inference Runtime lane without giving Worker Jobs Campaign mutation authority.
- Wayfinder #26 must decide whether prototype evidence supports the one-method Narration facade and the selected runtime limits.
