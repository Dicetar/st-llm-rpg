# Companion runtime and module seams

Status: superseded in part by [Final companion architecture and verification seams](./final-companion-architecture-and-verification.md).

Historical seam exploration only where it conflicts with the final architecture. V1 has one deterministic preflight Context Plan and one narrator call; hidden drafts, enrichment revisions, vectors, automatic retries, and automatic model management remain excluded.

## Decision

Build the new companion as one pinned Node 24 process at `:8002`, written in strict TypeScript and compiled to ESM. Fastify 5 is the owned HTTP Adapter. The first persistence Adapter is built-in `node:sqlite`; it sits behind a semantic Campaign Journal seam because the Node interface is still release-candidate and `better-sqlite3` is the measured fallback. The full-page Workspace is a React and TypeScript SPA built with Vite and React Router Data Mode. The new SillyTavern bridge is a separate, small TypeScript browser bundle; the existing `st-rpg-campaign` extension remains untouched as the fallback.

Inside the companion, use a handful of deep capability Modules rather than one universal application dispatcher or a package per domain noun:

- **Campaign Engine** owns accepted Campaign Operations and reads.
- **Workspace** owns task-oriented documents and user-intent orchestration.
- **Context** owns inspectable Context Capsule planning.
- **Narration** owns the OpenAI-compatible linked/unlinked decision and complete generation workflow.
- **Worker Jobs** owns durable model-assisted jobs and non-canonical Proposals.
- **Inference Runtime** is an internal Module owning the single model lane.
- **Companion Host** owns process startup, readiness, HTTP, and shutdown.
- **SillyTavern Bridge** is an Adapter at the pinned SillyTavern seam, not a Campaign Module.

This decision fixes runtime, process ownership, package shape, and Module Interfaces sufficiently for the next design and prototype tickets. It deliberately does not fix the SQLite schema, event/snapshot algorithm, Chat Binding lifecycle, retrieval ranking, final HTTP route set, job persistence model, or frontend information architecture.

Evidence base:

- [Current extension disposition](./current-extension-disposition.md) identifies behavior to preserve and ownership to replace.
- [Local companion technology research](../research/local-companion-technology.md) compares Node, SQLite, HTTP, file watching, Windows startup, and LAN operation.
- [SillyTavern narrator-proxy contract](../research/sillytavern-proxy-contract.md) pins the Custom endpoint, mutable hook, generation modes, SSE, cancellation, and failure traps.
- ADRs [0007](../adr/0007-separate-campaign-authority-from-chat-bindings.md), [0008](../adr/0008-use-sqlite-as-campaign-authority.md), [0009](../adr/0009-require-human-review-for-model-assisted-campaign-changes.md), and [0010](../adr/0010-use-preflight-context-with-bounded-hidden-draft-enrichment.md) supply the accepted domain constraints.

## Requirements that drive the seams

The callers are:

- Workspace browser routes and forms;
- the OpenAI-compatible narrator endpoint used by SillyTavern;
- Story Sync and later bounded worker jobs;
- import, backup, restore, and launcher workflows;
- the thin SillyTavern bridge;
- behavioral, Adapter-contract, failure-injection, and real-runtime tests.

The system must keep these facts out of those callers:

- SQLite tables, migrations, WAL, snapshots, and reconstruction;
- reference validation, Campaign Revision creation, and Campaign Event construction;
- exact/Scene/FTS/vector ranking and Narrator Visibility enforcement;
- LM Studio model swapping, queue priority, SSE parsing, and cancellation;
- file watcher unreliability and addon reconciliation;
- SillyTavern hook ordering and Custom-endpoint reconstruction.

Dependency classification:

- SQLite and the local addon/backup filesystem are **local-substitutable**. Production and test Adapters can exercise the same semantic seam locally.
- LM Studio and SillyTavern are **true external**. Their protocol details are isolated behind production Adapters and tested with scripted fixtures plus real compatibility traces.
- Fastify and React are implementation choices at outer seams. They never become domain vocabulary.

## Designs considered

### Design A: minimal kernel

This design exposed only `campaign()`, `narrate()`, and `changes()` on one Companion Module. It maximized apparent Interface simplicity and hid every queue, retrieval stage, import, backup, binding action, and Proposal behind one large discriminated union.

Its strength was Depth for HTTP callers. Its weakness was Locality inside the implementation: the `campaign()` union already needed reads, accepted Operations, Chat Binding reconciliation, branches, Story Sync requests, import previews, backups, and restore. That shape would recreate the current `campaign-session.js` dispatcher under a cleaner type name. It also made it hard to express structurally that Worker Jobs may read Campaign state but can never accept an Operation.

Rejected as the main shape. The selected design keeps its useful lessons: few entry points per Module, invalidation rather than client-side replicated state, and one-method narration.

### Design B: capability Modules with ports and Adapters

This design exposed Campaign Engine, Workspace, Context, Narration, Inference Runtime, and Worker Jobs separately. It placed semantic Adapters only at real seams: Campaign Journal, addon feed, LM Studio, Fastify, and SillyTavern. Worker Jobs received only Campaign read capability.

This produced the strongest structural safety and testability. The risk was shallow Interface proliferation: Context, Inference Runtime, and Workspace could become pass-through layers if they did not each hide a complete policy cluster.

Selected as the base, with two reductions. Inference Runtime remains internal to Narration and Worker Jobs, and the Workspace Interface is explicitly task-oriented rather than a second generic Campaign interface.

### Design C: workflow-first Modules

This design placed seams around Workspace editing, linked narration, unlinked pass-through, and Story Sync. It made common user flows easy to invoke and concentrated ordering, cancellation, and error recovery.

Its strength was excellent workflow Locality. Its weakness was duplication pressure: separate flows would each need Campaign reads, errors, projections, binding checks, and model-lane knowledge. Separate `linked()` and `unlinked()` narration methods also let an HTTP caller choose the unsafe path before the Narration Module validated routing metadata.

Rejected as the overall topology. The selected Workspace Module adopts its task-oriented documents and intents, while Campaign, Context, Narration, and Worker Jobs retain capability seams.

## Why React rather than Preact or vanilla DOM

The fallback extension remains vanilla JavaScript because it is embedded in SillyTavern. The new Workspace is different: it is a full-page editor with routed Collections, dirty forms, Review Inbox, import diffs, context diagnostics, multiple tabs, responsive layouts, and long-lived drafts.

React is selected over vanilla DOM because the current extension already demonstrated the Locality cost of imperative rendering and controller state. React is selected over Preact because bundle size has negligible value on this local LAN application, while React provides the larger compatibility, accessibility, testing, and contributor/agent ecosystem. Avoiding `preact/compat` removes another source of dependency-specific failures.

Use Vite for the browser build and React Router Data Mode for URL-owned navigation, loaders, actions, pending states, and error surfaces while retaining control over the separate Fastify server. React's own from-scratch guidance lists Vite as a supported build path, and React Router recommends Data Mode when an application wants its data features while retaining control over bundling and server abstractions. [React build guidance](https://react.dev/learn/build-a-react-app-from-scratch), [React Router modes](https://reactrouter.com/start/modes), [Vite guide](https://vite.dev/guide/)

Do not add SSR, React Server Components, Redux, a generic form-builder, or a large UI kit in v1. Server data remains canonical; browser state is limited to editor drafts, navigation, Context Tray choices, and harmless view preferences.

## Runtime and process ownership

```text
phone / desktop browser
    |                           SillyTavern :8001
    | Workspace HTTP/SSE             |
    v                                | Custom OpenAI-compatible HTTP
+------------------------------------------------------------------+
| Companion Node process :8002                                     |
|                                                                  |
| Fastify Adapter                                                   |
|   -> Workspace routes/static assets                              |
|   -> /v1/models and /v1/chat/completions                         |
|                                                                  |
| Workspace -> Campaign Engine / Context / Worker Jobs             |
| Narration -> Context -> Inference Runtime                         |
| Worker Jobs -----------------> Inference Runtime                  |
|                                                                  |
| Campaign Journal Adapter -> SQLite                               |
| Addon Feed Adapter       -> local JSON files                     |
| LM Studio Adapter        -> 127.0.0.1:1234                       |
+------------------------------------------------------------------+
```

The companion process alone owns:

- the SQLite connection and all Campaign writes;
- migrations, integrity checks, WAL policy, backup, and restore;
- addon scanning, hashes, and import candidates;
- Workspace assets and owned HTTP routes;
- Chat Binding resolution;
- Context Capsule planning and Context Focus diagnostics;
- Narration Draft and Narration Enrichment orchestration;
- persisted worker-job state and Proposal output;
- one inference lane shared by narrator and worker work.

Narration has priority over queued worker work. A worker may be cancelled or restarted only at a stage defined as safe by the later job design. No SQLite transaction spans an HTTP/model/filesystem wait. Browser tabs and phones never open SQLite or mutate JSON files as authority.

SillyTavern remains a separate pinned process at `:8001` and owns chats, cards, chat rendering, and narrator/chat configuration. LM Studio remains a true external process at `127.0.0.1:1234`. The project launcher supervises or detects these processes later; this ticket does not implement launcher behavior.

## Repository and package shape

Use npm workspaces for deployable/buildable roots and one intentionally shared wire package:

```text
apps/
  companion/
    src/
      main.ts                       # composition root
      host/                         # lifecycle and Fastify Adapter
      modules/
        campaign/
        workspace/
        context/
        narration/
        worker-jobs/
        inference-runtime/          # internal Interface
      adapters/
        sqlite/
        local-files/
        lm-studio/
      migrations/
  workspace/
    src/
      routes/
      features/
      ui/
packages/
  wire/                             # runtime schemas + derived TS types only
extension/
  st-rpg-bridge/                    # new compiled thin Adapter
  st-rpg-campaign/                  # existing working fallback
campaign-content/                   # existing external addon authoring
docs/
prototypes/
tools/
```

`apps/companion/modules/*` are folders for Locality, not npm packages. Do not create packages for Item, Actor, Quest, Campaign Engine, Context, retrieval stages, or Worker Jobs. `packages/wire` exists because the Workspace, companion, and ST bridge genuinely run in different JavaScript contexts. It contains versioned runtime schemas, derived TypeScript types, problem documents, and bridge-header constants; it contains no SQLite rows, React code, or domain implementation.

Owned HTTP request/response schemas are defined once as runtime JSON Schema with TypeScript inference through Fastify's supported TypeBox provider. [Fastify type-provider documentation](https://fastify.dev/docs/latest/Reference/Type-Providers/). Transparent Chat Completions forwarding does not use a restrictive body schema that would discard unknown inference fields.

## Common result and failure shape

Expected domain and external failures are values. Programmer errors, impossible history states, failed migration checksums, and corruption remain loud faults that fail readiness or terminate the affected workflow.

```ts
type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; problem: Problem };

type Problem = {
  code: ProblemCode;
  message: string;
  requestId: string;
  retryable: boolean;
  actions: readonly RecoveryAction[];
  details?: unknown;
};
```

HTTP Adapters map Problems to statuses and OpenAI-compatible error documents. Modules do not throw expected revision, validation, reference, binding, budget, model, or cancellation outcomes across their Interfaces.

## Module Interfaces

The types below fix seam placement and caller obligations. Later tickets refine the closed request unions and wire documents.

### Campaign Engine

```ts
interface CampaignEngine {
  read<Q extends CampaignRead>(request: Q): Promise<Outcome<CampaignReadResult<Q>>>;

  execute(request: {
    campaignId: CampaignId;
    expectedRevision: CampaignRevision;
    operation: CampaignOperation;
    acceptedBy: HumanClient;
    requestId: RequestId;
  }): Promise<Outcome<CampaignCommit>>;

  changes(
    request: { campaignId: CampaignId; after?: ChangeCursor },
    signal: AbortSignal,
  ): AsyncIterable<CampaignInvalidation>;
}
```

The Interface guarantees:

- one accepted Campaign Operation or atomic batch creates exactly one Campaign Revision and one immutable Campaign Event;
- rejection creates neither;
- `expectedRevision` prevents stale-tab last-write-wins;
- `requestId` makes a repeated accepted request idempotent;
- reads can target current or numbered Campaign Revisions without exposing tables;
- archive, restore, reference-safe Delete, Advance Scene, and branch creation remain domain behavior;
- Chat Binding is explicit and Binding Mismatch is a Problem requiring a user choice;
- names never act as references.

The implementation hides normalization, validation, Reference Graph traversal, event construction, snapshot/replay strategy, and persistence.

### Workspace

```ts
interface Workspace {
  load(request: WorkspaceLoad): Promise<Outcome<WorkspaceDocument>>;

  act(request: WorkspaceIntent): Promise<Outcome<WorkspaceTransition>>;

  changes(
    request: { after?: WorkspaceCursor },
    signal: AbortSignal,
  ): AsyncIterable<WorkspaceNotice>;
}
```

`WorkspaceLoad` requests task documents: Collection pages, joined Record/live-entry editors, Review Inbox, Context Tray diagnostics, import diffs, backup/settings state, and Binding Mismatch choices. Responses are bounded and paginated.

`WorkspaceIntent` expresses user intent: save a draft through one accepted Campaign Operation, create-and-attach in one batch, accept/reject a Proposal, start/cancel/retry a worker job, preview/apply an addon import, reconcile a binding, pin/unpin/summarize Context Focus, or request maintenance.

The Workspace Module hides orchestration across Campaign Engine, Context, Worker Jobs, addon reconciliation, and maintenance. The HTTP Adapter performs validation and mapping only. The browser never constructs Campaign Events, updates references manually, or calls SQLite-shaped endpoints.

### Context

```ts
interface Context {
  plan(
    request:
      | { phase: "preflight"; bindingId: ChatBindingId; generation: GenerationIntent; chat: ChatExcerpt; budget: ContextBudget }
      | { phase: "enrichment"; base: ContextPlanId; draft: NarrationDraft; budget: ContextBudget },
    signal: AbortSignal,
  ): Promise<Outcome<ContextPlan>>;
}
```

One Context Plan contains the verified Campaign Revision, rendered prompt material, automatic and manual selections, omission reasons, token estimates, visibility decisions, and diagnostics needed by the visible Context Tray.

The implementation hides curated narrator views, exact/Scene/FTS/vector ranking, ambiguity handling, summaries, one-hop expansion, and Narrator Visibility. It never mutates the Campaign. Manual pins are never silently removed; pins exceeding budget produce a Problem before model work begins. Ranking stages are implementation details, not plugin Interfaces.

### Narration

```ts
interface Narration {
  respond(
    request: NarratorExchange,
    signal: AbortSignal,
  ): Promise<Outcome<ProxyDelivery>>;
}
```

`NarratorExchange` contains the raw single `X-ST-RPG-Exchange` value and unknown OpenAI-compatible Chat Completion body. Narration decodes and validates the explicit linked or unlinked route, Chat Binding metadata, Chat Locator, SillyTavern generation type, request ID, bridge compatibility, and body. Missing or unknown routing metadata is rejected; it never defaults to unlinked. Exact wire, recovery, Problems, and delivery rules are fixed provisionally in [SillyTavern bridge and narrator proxy](./sillytavern-bridge-and-narrator-proxy.md).

The Module hides:

- transparent unlinked forwarding;
- linked binding verification and fail-closed behavior;
- deterministic preflight Context Capsule;
- hidden Narration Draft, retrieval, and bounded Narration Enrichment;
- generation-mode preservation (`continue` suffix versus complete replies);
- atomic final delivery and recovery diagnostics;
- cancellation propagation to every model stage.

`ProxyDelivery` is transport-neutral enough for the Fastify Adapter to produce either a transparent upstream byte stream or one atomic OpenAI completion. Atomic content is structurally a complete message for normal/regenerate/swipe or a suffix for continue. No successful linked headers are committed before final text exists. Narration never mutates Campaign state and never automatically retries after output may have been generated. A recoverable unenhanced draft is bounded volatile state behind Narration, not another public stage or a durable record.

### Worker Jobs

```ts
interface WorkerJobs {
  dispatch(command: WorkerCommand): Promise<Outcome<JobReceipt>>;
  read(query: WorkerQuery): Promise<Outcome<JobView>>;
  changes(
    request: { after?: JobCursor },
    signal: AbortSignal,
  ): AsyncIterable<JobNotice>;
}
```

Worker Jobs receives a `CampaignReader` capability containing only `CampaignEngine.read`. It never receives `CampaignEngine.execute`. This structural rule prevents Story Sync or any model result from accepting a Proposal, advancing a Sync Boundary, or changing Campaign truth.

The implementation hides persisted job stages, bounded source snapshots, model-lane participation, cancellation/resume, malformed-output repair, Proposal validation, and restart behavior. Exact Proposal and Sync Boundary persistence belongs to Wayfinder #24.

### Inference Runtime (internal)

```ts
interface InferenceRuntime {
  run(task: InferenceTask, signal: AbortSignal): Promise<Outcome<InferenceResult>>;
}
```

This internal Module owns the one local inference lane, narrator priority, model selection/swap, output ceilings, SSE parsing, and LM Studio error normalization. It is OpenAI Chat Completions-specific and does not pretend to be an all-provider abstraction. Narration and Worker Jobs are its only ordinary callers.

### Companion Host and Workspace server

```ts
interface CompanionHost {
  start(): Promise<Outcome<RunningCompanion>>;
  stop(reason: ShutdownReason): Promise<void>;
}
```

The Host runs migrations and integrity checks before readiness, creates the composition root manually, starts Fastify, serves Workspace assets, registers owned routes and raw proxy handling, starts addon reconciliation and Worker Jobs, and coordinates shutdown. Fastify is an Adapter inside this Module, not an Interface imported by Campaign, Context, Narration, or Worker Jobs.

Adapter tests may use Fastify injection through a private construction seam. Production callers know only lifecycle and health.

### SillyTavern Bridge

```ts
interface SillyTavernBridge {
  mount(context: PinnedSillyTavernContext): () => void;
}
```

The bridge:

- installs the awaited request hook synchronously;
- marks every narrator request explicitly linked or unlinked;
- supplies Chat Binding locator, generation type, request ID, and bridge version;
- validates that Custom Chat Completions still targets the companion;
- explicitly aborts linked requests when metadata or compatibility is invalid;
- opens the separate Workspace and shows actionable status;
- contains no Campaign Records, Context selection, worker execution, or narration logic.

The raw SillyTavern chat ID is diagnostic, not Campaign identity. The exact binding locator and copied-chat protocol belong to Wayfinder #17. The exact request headers and guard behavior belong to #19 and #20.

## Depth and seam audit

- Deleting **Campaign Engine** would scatter revision, validation, reference, event, and reconstruction rules across Workspace, Narration, import, and tests. It is deep.
- Deleting **Workspace** would force the browser and HTTP routes to orchestrate Campaign, Context, Worker Jobs, import, and maintenance. It is deep only while it returns task-oriented documents and accepts user intents; if it becomes a one-to-one route proxy, merge it back into the HTTP Adapter.
- Deleting **Context** would duplicate visibility, budget, retrieval, omission, and diagnostic rules in Narration and Workspace. It is deep.
- Deleting **Narration** would spread linked fail-closed routing, generation-mode semantics, atomic delivery, enrichment, and cancellation into Fastify routes and the ST bridge. It is deep.
- Deleting **Worker Jobs** would spread persisted stages, conservative parsing, cancellation/resume, and Proposal safety into Workspace and model code. It is deep.
- **Inference Runtime** earns its internal seam because Narration and Worker Jobs share one constrained model lane and require different priority/recovery behavior. It is not exported over HTTP or placed in a separate package.
- **SillyTavern Bridge** is intentionally a shallow Adapter at a true-external seam. Do not add another abstraction around every SillyTavern function.
- **Fastify** remains an outer Adapter. There is no generic transport Interface and no route-controller layer whose only work is forwarding parameters.

Every internal seam has demonstrated variation: real versus fault-injected/local test persistence, local filesystem versus controlled test feed, or LM Studio versus scripted protocol fixtures. Validators, rankers, mappers, SQL statements, and queue internals stay private until a second real implementation requires a seam.

## Internal Adapter seams

### Campaign Journal

```ts
interface CampaignJournal {
  read(request: JournalRead): Promise<JournalState>;
  commit(request: ValidatedCommit): Promise<CommitReceipt>;
  maintain(request: JournalMaintenance): Promise<MaintenanceReceipt>;
}
```

The production Adapter uses `node:sqlite`. Contract tests use temporary SQLite files and fault injection; a small in-memory Adapter may test pure Campaign Engine behavior but cannot substitute for SQLite recovery evidence. `better-sqlite3` is implemented only if the persistence prototype exposes a binding/runtime defect.

There is no repository per table or Record kind. Backup consistency, migrations, restore, snapshots, and fork storage remain together for Locality.

### Addon Feed

```ts
interface AddonFeed {
  reconcile(signal: AbortSignal): Promise<AddonSnapshot>;
  changes(signal: AbortSignal): AsyncIterable<AddonSignal>;
}
```

The local-file Adapter hides `fs.watch`, debounce, full rescan, stable reads, hashing, malformed JSON, and directory replacement. Watch signals never create Campaign Operations. They produce a reviewable import candidate.

### LM Studio

```ts
interface LmStudio {
  exchange(request: ModelExchange, signal: AbortSignal): Promise<ModelResult>;
}
```

The production Adapter uses native `fetch`, AbortController, and Web Streams against OpenAI Chat Completions. The scripted Adapter covers SSE fragmentation, hidden reasoning, empty visible output, malformed output, timeouts, cancellation, and sequential model swaps. There is no OpenAI SDK, implicit retry, tool interface, or generic provider registry.

## Provisional performance and failure obligations

These targets guide prototypes; #26 confirms or revises them from measurements:

- bounded, paginated Workspace reads: p95 under 100 ms inside the companion for a representative 10,000-Record Campaign;
- accepted mutations outside explicit backup/import maintenance: p95 under 100 ms with short synchronous transactions;
- no SQLite event-loop stall above 50 ms without triggering a binding/worker-thread review;
- Workspace invalidation visible within 250 ms under normal LAN conditions;
- deterministic Context planning before model work: p95 under 100 ms;
- cancellation propagated to the active LM Studio request within a 250 ms target;
- bounded request bodies, model output, SSE buffers, collection pages, and diagnostics;
- no offline mutations, automatic replay, automatic narrative retry, or unbounded `all Records` response;
- linked narration fails closed; explicit unlinked narration can remain available when Campaign data is unavailable if the host and LM Studio are healthy;
- only committed Campaign changes emit invalidations; clients refetch canonical documents rather than applying event payloads as a second authority.

## Rejected shapes and technologies

- One universal Companion command/query union: too close to the current monolithic dispatcher.
- Pure workflow Modules with duplicated Campaign and binding rules: poor invariant Locality.
- Separate processes for Campaign, proxy, retrieval, Workspace, and jobs: operational cost without a solo-local scaling need.
- Package per Module, Record kind, or table: dependency ceremony and shallow Interfaces.
- Repository per SQLite table: leaks storage and makes transactions cross caller code.
- Generic CRUD by Record kind: cannot express live entries, references, guarded lifecycle, and colocated create-and-attach.
- Generic event bus, DI container, plugin registry, or rules engine: no demonstrated variation.
- ORM or generic event-sourcing framework: hides SQLite behavior the recovery prototypes must prove.
- Preact: smaller bundle provides no meaningful local benefit and may add compatibility friction.
- Vanilla DOM Workspace: repeats the current controller/rendering Locality failure.
- SSR, React Server Components, Next.js, or a React Router server: unnecessary second server/runtime model for a local SPA served by Fastify.
- Redux or browser-side Campaign store: creates synchronization work and risks a second authority.
- Direct Campaign Engine access from the browser: leaks domain orchestration into routes and forms.
- Retrieval-stage plugin Interfaces: only one planned implementation; ranking stays inside Context.
- Generic model-provider Interface or OpenAI SDK: first target is deliberately LM Studio Chat Completions and narration must not retry implicitly.
- Worker threads/processes before event-loop measurements require them.
- Patching SillyTavern core or embedding Workspace inside it.

## Downstream decisions now unblocked

- #17 may design Campaign Journal schema, event/snapshot history, revision concurrency, branches, and Chat Binding lifecycle against the Campaign Engine Interface.
- #18 may prototype persistence through Campaign Engine and Campaign Journal without HTTP or Workspace dependencies.
- #19 fixes the provisional bridge/proxy wire, one-method Narration transaction, errors, cancellation, recovery, and atomic delivery contract in [SillyTavern bridge and narrator proxy](./sillytavern-bridge-and-narrator-proxy.md).
- #20 must validate that contract against the pinned SillyTavern build, real LM Studio, captured chat JSONL, and a real phone before it becomes implementation authority.
- #21 may design retrieval stages inside the one-method Context Interface.
- #23 may design Workspace information architecture against task-oriented Workspace documents and intents.
- #24 may design durable Worker Jobs and model scheduling without granting Campaign mutation capability.
- #25 may design launcher, migration, import, update, fallback, and rollback around one Companion Host process.

The final architecture decision in #26 must retain only seams that prototype evidence proves deep. If deleting a Module removes only pass-through mapping, merge it back into its caller.
