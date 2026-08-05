# Companion v1 implementation specification

Status: implementation authority for Wayfinder issue #27.

This document consolidates the accepted Wayfinder decisions into one normative specification for implementation. Earlier ADRs, research notes, and prototypes remain rationale and evidence. When they conflict with this document, this document and the final architecture decision in `docs/design/final-companion-architecture-and-verification.md` govern v1.

## 1. Product problem

SillyTavern remains the preferred chat experience, but campaign truth must not live only inside one browser extension or one chat. The system needs campaign-independent state, explicit chat binding, durable history, reliable retrieval, mobile-accessible management, model-assisted Story Sync with human control, and a narrator proxy that preserves native SillyTavern generation behavior.

The implementation must run locally on Windows 11, remain usable from Android through a trusted LAN or VPN, avoid unnecessary background software, and fit a 16 GB NVIDIA GPU workflow with LM Studio.

## 2. Product solution

Build one local companion process at `:8002` beside pinned SillyTavern at `:8001` and external LM Studio at `:1234`.

The companion owns:

- canonical SQLite Campaign and Chat Binding state;
- immutable Campaign and Binding histories;
- full-page Campaign Book Workspace;
- deterministic Context planning;
- OpenAI-compatible narrator proxy;
- durable Story Sync and worker jobs;
- reviewable addon import candidates;
- migration, backup, restore, readiness, and health;
- one inference lane shared by Narration and Worker Jobs.

SillyTavern owns chats, cards, chat rendering, generation controls, and the user’s ordinary model profile. LM Studio owns model serving. The existing `extension/st-rpg-campaign` remains the fallback until the production cutover gate passes.

## 3. Non-negotiable v1 reductions

Version 1 does not implement:

- hidden narration drafts;
- enrichment revisions;
- vector retrieval;
- narrator tools;
- automatic model retries;
- automatic LM Studio model loading, unloading, or swapping;
- browser-side authoritative Campaign state;
- authentication, pairing, public-internet exposure, multiplayer, offline mutation, or native mobile applications.

Narration uses one deterministic preflight Context plan and one model request.

## 4. Primary users and user stories

### 4.1 Campaign owner

As the campaign owner, I can create, import, open, archive, restore, branch, back up, and inspect Campaigns without tying Campaign identity to one SillyTavern chat.

As the campaign owner, I can edit Actors, Items, Abilities, Quests, Facts, Places, World Objects, Scene state, Possessions, Relationships, conditions, and other accepted domain records through task-oriented Workspace forms.

As the campaign owner, I can see when another browser tab changed the Campaign and receive an explicit stale-revision choice rather than losing edits.

As the campaign owner, I can inspect immutable history, reconstruct numbered revisions, and verify backups.

### 4.2 SillyTavern player

As a player, I can explicitly link a saved chat to a Campaign and see the current binding state.

As a player, an unlinked chat behaves like ordinary SillyTavern and remains usable even when Campaign authority is unavailable.

As a player, a linked send, regenerate, continue, swipe, or Stop preserves SillyTavern’s native chat semantics.

As a player, linked narration fails clearly rather than silently bypassing Campaign context.

As a player, I can open Campaign Book from SillyTavern without embedding the whole Workspace inside SillyTavern.

### 4.3 Context Focus user

As a user, I can inspect what deterministic context was selected, omitted, ambiguous, private, or over budget.

As a user, I can pin, unpin, and reorder complete narrator views per Chat Binding.

As a user, pins are never silently truncated, expired, reordered, or removed.

As a user, ambiguous textual identity selects no record and is shown as an ambiguity rather than guessed.

### 4.4 Story Sync reviewer

As a reviewer, I can start a durable Story Sync job from a bounded source snapshot.

As a reviewer, model output produces editable Proposals only.

As a reviewer, I can accept, edit, reject, or defer Proposals.

As a reviewer, finalization applies accepted Proposals as one atomic Campaign batch and advances the Sync Boundary in the same transaction.

As a reviewer, a model or worker can never mutate Campaign truth directly.

### 4.5 Mobile user

As a mobile user, Campaign Book works in portrait on a physical Android browser around 360 CSS pixels without horizontal overflow.

As a mobile user, operational status, jobs, review actions, binding state, errors, and primary editing remain usable with touch targets and visible pending state.

Ledger-style dense collection layouts are optional desktop views and collapse to ordinary routed pages on narrow screens.

## 5. Runtime topology

```text
Desktop / Android browser
        |
        | Workspace HTTP + invalidation stream
        v
+-------------------------------------------------------------+
| Companion Node 24 process :8002                             |
|                                                             |
| Fastify HTTP Adapter                                        |
|   |-- Workspace routes/static assets                        |
|   |-- /v1/models                                            |
|   |-- /v1/chat/completions                                  |
|   `-- health/readiness/maintenance                          |
|                                                             |
| Workspace ----> Campaign Engine ----> Campaign Journal      |
|      |                 |                    |                |
|      |                 |                    `--> SQLite      |
|      |                 `--> Context ----> FTS5               |
|      `--> Worker Jobs ----> Inference Lane ----> LM Studio  |
|                                                             |
| Narration ----> Context ----> Inference Lane ----> LM Studio|
| Addon Reconciler ----> reviewable import candidates         |
| Backup / Migration ----> Campaign Journal                   |
+-------------------------------------------------------------+
        ^
        | versioned exchange envelope + OpenAI-compatible body
        |
Pinned SillyTavern :8001
```

One visible PowerShell supervisor owns project-local SillyTavern and the companion. It observes LM Studio but does not own or kill it.

## 6. Repository shape

```text
apps/
  companion/
    src/
      main.ts
      host/
      modules/
        campaign/
        workspace/
        context/
        narration/
        worker-jobs/
        inference-lane/
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
  wire/
extension/
  st-rpg-bridge/
  st-rpg-campaign/
campaign-content/
docs/
prototypes/
tools/
```

`packages/wire` contains only versioned runtime schemas, derived TypeScript types, Problem documents, and bridge constants shared across JavaScript contexts. Domain implementation remains inside the companion. Do not create npm packages per record kind, table, module, or retrieval stage.

## 7. Dependency direction

Outer adapters depend on deep policy modules. Deep modules depend on domain values and ports. Domain code imports no Fastify, React, SQLite row types, SillyTavern globals, LM Studio response objects, PowerShell, or watcher APIs.

Worker Jobs receives Campaign read capability only. It must not receive Campaign mutation capability.

Narration and Worker Jobs are the only ordinary callers of the Inference Lane.

## 8. Common result and error contract

Expected failures are values:

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

HTTP adapters map Problems to owned JSON responses or OpenAI-compatible errors. Programmer faults, failed migration checksums, impossible Event history, failed integrity verification, and corruption fail readiness or terminate the affected operation loudly.

Every user-visible failure must identify the failed operation and provide a concrete recovery action when one exists. Do not introduce recorder workflows or manual evidence state machines into production UX.

## 9. Campaign authority

### 9.1 Canonical storage

SQLite is canonical. JSON is import, export, addon, and backup representation only.

One companion process owns one SQLite writer. Browser tabs, phones, SillyTavern, addons, and workers never write authoritative files or tables directly.

### 9.2 Operations and Events

Every accepted Campaign Operation or accepted atomic batch creates exactly:

- one new Campaign Revision;
- one immutable Campaign Event containing reconstructable before/after information;
- updated current projections;
- required invalidation records.

A rejected operation creates none of these.

Campaign Events and Chat Binding Events are separate immutable histories. Pinning, unpinning, reordering, and binding reconciliation create Binding Events, not Campaign Events.

### 9.3 Concurrency

Every mutation supplies an expected revision. Stale writes return a typed conflict and never use last-write-wins.

Repeated accepted request IDs are idempotent.

Facet-specific Binding revisions allow unrelated Binding changes to proceed without overwriting each other.

### 9.4 References and lifecycle

Canonical references use IDs, never names.

Delete, archive, restore, branch, Scene advance, relationship changes, and reference updates are domain operations with validation. Reference-safe deletion and explicit collision choices are required.

### 9.5 History, snapshots, and reconstruction

The Journal must reconstruct arbitrary numbered revisions from validated Events and snapshots. Snapshots verify the entire Event prefix they summarize. Corruption or checksum mismatch is a hard readiness or maintenance failure.

## 10. Public module interfaces

### 10.1 Campaign Engine

```ts
interface CampaignEngine {
  read<Q extends CampaignRead>(request: Q): Promise<Outcome<CampaignReadResult<Q>>>;
  execute(request: CampaignExecution): Promise<Outcome<CampaignCommit>>;
  executeBatch(request: CampaignBatchExecution): Promise<Outcome<CampaignCommit>>;
  changes(request: CampaignChangeRequest, signal: AbortSignal): AsyncIterable<CampaignInvalidation>;
}
```

### 10.2 Campaign Journal

```ts
interface CampaignJournal {
  transact<T>(work: (tx: CampaignJournalTransaction) => T): T;
  readAt(request: JournalReadRequest): JournalReadResult;
  verify(request: JournalVerificationRequest): JournalVerificationResult;
  backup(request: JournalBackupRequest): JournalBackupResult;
}
```

The Journal exclusively owns SQLite schema, migrations, WAL, snapshots, replay, verification, and backup primitives.

### 10.3 Workspace

```ts
interface Workspace {
  load(request: WorkspaceLoad): Promise<Outcome<WorkspaceDocument>>;
  act(request: WorkspaceIntent): Promise<Outcome<WorkspaceTransition>>;
  changes(request: WorkspaceChangeRequest, signal: AbortSignal): AsyncIterable<WorkspaceNotice>;
}
```

Workspace documents are bounded, task-oriented, and paginated. Workspace intents express user actions, not generic table CRUD.

### 10.4 Context

```ts
interface Context {
  plan(request: PreflightContextRequest, signal: AbortSignal): Promise<Outcome<ContextPlan>>;
}
```

There is one phase only: deterministic preflight.

### 10.5 Narration

```ts
interface Narration {
  respond(request: NarratorExchange, signal: AbortSignal): Promise<Outcome<ProxyDelivery>>;
}
```

### 10.6 Worker Jobs

```ts
interface WorkerJobs {
  dispatch(command: WorkerCommand): Promise<Outcome<JobReceipt>>;
  read(query: WorkerQuery): Promise<Outcome<JobView>>;
  changes(request: JobChangeRequest, signal: AbortSignal): AsyncIterable<JobNotice>;
}
```

### 10.7 Inference Lane

```ts
interface InferenceLane {
  run(request: InferenceRequest, signal: AbortSignal): Promise<Outcome<InferenceResult>>;
}
```

One inference request may be active at a time.

## 11. Context planning

### 11.1 Authority and inputs

A Context Plan pins exact Campaign Revision, Chat Binding Revision, Context Focus facet revision, model profile, generation intent, and bounded chat excerpt.

Preflight retrieval may use the current user message, up to seven prior non-system user/assistant messages, newest first, capped at 2,000 estimated tokens, plus structural Scene IDs and ordered manual pins.

System messages, reasoning, tools, unrelated extension metadata, and private material are excluded from retrieval evidence.

### 11.2 Retrieval precedence

Use strict tiers:

1. required compact core;
2. ordered per-binding manual pins;
3. unique exact names and aliases;
4. current-Scene structural anchors;
5. lexically qualified FTS5 results;
6. one bounded relation hop.

Lower tiers never outrank higher tiers.

Vectors are disabled in v1.

### 11.3 Ambiguity

Textual identity is selected only when one record remains after visibility and permitted structural scoping. Multiple plausible records create an Ambiguity Set and select nothing. Rank, importance, recency, equipment, FTS5, and relation expansion may not break identity ambiguity.

### 11.4 Visibility

Visibility is applied before indexing, FTS5, relation expansion, rendering, and diagnostics.

- Known material may be selected and revealed.
- Narrator Secret material may influence narration through a separated block but must not be directly exposed.
- Campaign Private material never enters search documents, prompts, embeddings, model requests, relation expansion, or operational diagnostics.

Pins never override visibility.

### 11.5 Budgets

All budgets use tokens.

Required core must fit. Ordered pins are complete and must all fit. They are never sliced or silently dropped. Core overflow and core-plus-pins overflow fail before model work with actionable Problems.

Automatic record details are added only as complete views while budget remains.

## 12. Narration flow

### 12.1 Exchange envelope

The thin SillyTavern bridge adds one versioned exchange envelope to every Chat Completion. It supplies explicit route, Binding metadata, mutable Chat Locator, generation type, request identity, and bridge compatibility version.

Missing, malformed, or unknown routing metadata is rejected. It never defaults to unlinked.

The bridge redirects only the transient request to the companion and does not overwrite the user’s saved LM Studio endpoint/profile.

### 12.2 Unlinked flow

An explicit-unlinked request is transparently forwarded once to LM Studio. It remains usable during Campaign outage when the companion host and LM Studio are healthy.

### 12.3 Linked flow

1. Decode and validate the exchange.
2. Verify Chat Binding, Campaign authority, Chat Locator, generation type, and request identity.
3. Build one deterministic preflight Context Plan.
4. Assemble original SillyTavern messages plus rendered Context blocks according to the exact model profile.
5. Make one LM Studio Chat Completions request.
6. Buffer the complete visible reply.
7. Reject empty or reasoning-only output.
8. Recheck cancellation.
9. Deliver atomically.

Normal, regenerate, and swipe produce complete-message candidates. Continue produces a suffix only.

No successful linked content is exposed before the complete response is accepted.

There is no hidden draft, rewrite, recovery prose cache, or automatic retry.

### 12.4 Cancellation

Stop propagates to the active LM Studio request. Cancelled linked narration commits no assistant result and must not deliver a late buffered response.

### 12.5 Outage behavior

Linked Campaign outage fails before any upstream model call while retaining SillyTavern’s submitted user turn. Explicit-unlinked outage bypass remains available.

## 13. Inference scheduling

One inference lane serves Narration and Worker Jobs.

Narration has priority over queued worker work. A new narration request may cancel an active worker HTTP call only when the active worker stage is defined as cancellable; it waits for termination before starting.

Version 1 uses models already exposed by LM Studio. The companion does not load, unload, or swap models automatically.

Every model profile is tied to the exact LM Studio connection and model ID. It owns context capacity, serialization, placement, visible-output readiness, reasoning compatibility, token estimation, and output ceilings.

## 14. Worker Jobs and Story Sync

Worker Jobs are durable state machines with bounded source snapshots, stages, explicit cancellation, restart semantics, and Proposal output.

Workers receive read-only Campaign access.

Story Sync:

1. identifies a bounded source since the current Sync Boundary;
2. fingerprints the source;
3. runs through the inference lane;
4. parses and validates bounded output;
5. creates editable Proposals;
6. waits for human review;
7. applies accepted Proposals as one atomic Campaign batch;
8. advances the Sync Boundary in the same transaction.

Malformed output may enter an explicit repair stage. It must not mutate Campaign state.

Raw source/model output retention follows the accepted job design and must be removed after authority acknowledgement. Operational job records persist without becoming Campaign truth.

## 15. Workspace UX

Campaign Book is the full-page cross-device shell.

Primary areas include:

- Campaign selection and status;
- current Scene and active state;
- Collections and joined Record/live-state editors;
- Chat Binding and mismatch resolution;
- Context Tray with pins, selections, omissions, ambiguity, and budgets;
- Review Inbox and Story Sync Jobs;
- addon import diffs;
- backup, restore, migration, maintenance, and settings;
- history and branch inspection.

The browser keeps only editor drafts, navigation state, Context Tray choices, and harmless preferences. Server data remains canonical.

Every mutation shows pending state, success, or actionable failure. Destructive operations require explicit confirmation and display their scope.

Physical Android acceptance at 360–430 CSS pixels is mandatory for required routes. Desktop emulation alone does not satisfy the gate.

## 16. Addon reconciliation

External JSON files are not authority.

The local-file adapter uses watcher signals only to trigger a stable full-directory rescan and hashing process. It produces a persisted Import Candidate with exact manifest hash, source facts, diff, validation outcome, and target Campaign Revision.

Applying an addon candidate requires human review, validated backup, and one accepted atomic Campaign batch. Missing external rows do not imply deletion of accepted Campaign records.

## 17. Migration

Legacy `chat_metadata.stLlmRpgCampaign` is read from a selected saved chat through the pinned SillyTavern server path.

Migration is previewed and non-destructive:

1. read and validate the selected legacy envelope;
2. fingerprint the source;
3. display the imported Campaign and Binding preview;
4. create a validated backup;
5. import a self-contained revision-1 SQLite Campaign;
6. create an explicit Chat Binding;
7. write and read back the SillyTavern binding marker;
8. preserve the legacy metadata unchanged.

Exact re-import is idempotent. Copied or divergent sources require a human choice.

## 18. Supervisor, startup, and updates

`Wayfinder.cmd` is the one visible launcher.

It owns project-local SillyTavern and the companion. It observes LM Studio.

Startup:

- verifies required runtime and files;
- refuses occupied owned ports and reports the owning process;
- starts only missing owned processes;
- waits for readiness;
- leaves Workspace available in degraded mode when LM Studio is absent.

Shutdown stops only identity-matched children the launcher started.

SillyTavern updates are staged beside the active runtime. Activation requires backup, compatibility tests, smoke tests, atomic switch, and rollback on failure. Project source updates remain user-controlled Git operations.

## 19. Backup, restore, and fallback

Backups are validated online SQLite backups with manifest and verification results. Restore is previewed and verified before activation.

The existing fallback extension remains installed and operational until the full production cutover trace passes.

Returning to fallback after companion-only Campaign Events creates explicitly divergent history. There is no silent reverse migration or claim that the two stores remain synchronized.

## 20. Performance and resource acceptance gates

### Companion

- idle working set target below 250 MiB;
- mandatory investigation at 400 MiB;
- ordinary Workspace document load p95 below 100 ms on host;
- ordinary Campaign commit p95 below 50 ms;
- no normal interactive commit above 200 ms.

### Journal event-loop boundary

Move additional Journal work off the event-loop path when either is observed on the target dataset:

- p95 exceeds 25 ms across 100 consecutive executions;
- one normal interactive execution exceeds 100 ms.

Interactive commits remain in the single writer. Heavy work prepares outside the transaction and commits through that writer.

### Context and Narration

- Context planning p95 below 100 ms;
- companion-added pre-model linked latency p95 below 250 ms;
- exactly one upstream model call for every successful linked generation;
- zero upstream model calls on Binding, authority, budget, or Campaign-unavailable rejection;
- zero visible linked bytes before accepted complete response;
- Stop prevents late delivery.

### Mobile

- no horizontal overflow on required routes at 360–430 CSS px;
- touch targets, keyboard focus, pending state, and error recovery usable on physical Android.

## 21. Testing strategy

### Pure domain tests

Cover Operations, validation, references, revisions, Events, Binding facets, visibility, deterministic ordering, token allocation, ambiguity, Proposal decisions, and Problem mapping without HTTP or SQLite.

### SQLite contract and recovery tests

Run Journal contracts against temporary SQLite databases. Inject crashes before and after commit, stale revisions, duplicate request IDs, replay, reconstruction, branch, snapshot, migration, backup/restore, purge, and corruption.

### Adapter tests

Test LM Studio and SillyTavern adapters against scripted local HTTP fixtures, including SSE fragmentation, empty visible output, reasoning-only output, malformed responses, disconnects, timeouts, cancellation, and outage behavior.

Test addon reconciliation with temporary directories and lost watcher events. Test the supervisor with occupied ports, mismatched processes, partial startup, degraded mode, and shutdown ownership.

### Workspace tests

Test routed documents, intents, stale-tab conflicts, pending/error states, dirty drafts, review workflows, responsive layouts, and accessibility.

### Real-runtime gates

Before cutover, run on the actual Windows host and Android path:

- pinned SillyTavern send/regenerate/continue/swipe/Stop/outage behavior;
- representative migration and backup/restore;
- SQLite latency and companion memory measurement;
- Workspace desktop and physical-phone acceptance;
- real LM Studio Narration and Worker cancellation/preemption;
- supervisor start/stop/occupied-port/degraded-mode trace;
- staged SillyTavern update and rollback;
- fallback switch and divergence warning.

The accepted #20 physical-phone proxy evidence need not be repeated unless the production bridge changes that seam.

## 22. Required failure guarantees

The implementation guarantees:

- no silent linked-to-unlinked fallback;
- no silent Campaign mutation from model output;
- no partial Campaign commit;
- no stale last-write-wins;
- no silent pin truncation;
- no ambiguity guessing;
- no Campaign Private leakage into retrieval or model requests;
- no hidden narrator prose persisted;
- no automatic retry after model work begins;
- no unrelated process termination;
- no destructive migration without preview and validated backup;
- no claim that fallback and companion histories remain synchronized after divergence.

## 23. Explicit exclusions

Do not add during v1 implementation:

- hidden draft or enrichment code paths;
- vector database or embedding service;
- narrator tools or autonomous Campaign mutation;
- generic model-provider registry or OpenAI SDK;
- automatic LM Studio model lifecycle management;
- ORM, generic event-sourcing framework, repository-per-table pattern, generic CRUD API, generic event bus, DI container, plugin framework, or rules engine;
- microservices or multiple companion processes;
- Redux, SSR, React Server Components, Next.js, large UI kit, or browser-side Campaign authority;
- authentication, pairing, public exposure, multiplayer, offline mutation, replicated databases, or native mobile app.

## 24. Implementation completion definition

Companion v1 is implementation-complete only when:

1. all vertical tracer tickets derived from this specification pass;
2. all module and adapter contracts are implemented without violating dependency direction;
3. production bridge behavior passes the pinned SillyTavern compatibility suite;
4. SQLite recovery and performance gates pass on the target machine;
5. required Workspace routes pass physical Android acceptance;
6. Story Sync cannot mutate Campaign truth without human finalization;
7. migration, backup, restore, supervisor, update rollback, and fallback traces pass;
8. the existing fallback remains available until the final cutover decision is explicitly accepted.
