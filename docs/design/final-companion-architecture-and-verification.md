# Final companion architecture and verification seams

Status: final Wayfinder architecture for issue #26.

## Decision

Build one local companion process at `:8002` beside pinned SillyTavern at `:8001` and LM Studio at `:1234`. The companion owns SQLite Campaign truth, the full-page Workspace, deterministic Context planning, the OpenAI-compatible narrator proxy, durable worker jobs, addon reconciliation, backup/restore, and health/readiness. SillyTavern remains the chat host. LM Studio remains an external model server.

Version 1 deliberately excludes hidden-draft rewriting, enrichment revisions, vector retrieval, automatic LM Studio model loading/unloading, background services, authentication, and public-internet operation.

## Final process and module diagram

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
|   |-- OpenAI-compatible /v1/models and /v1/chat/completions |
|   `-- health/readiness/maintenance routes                   |
|                                                             |
| Workspace ----> Campaign Engine ----> Campaign Journal      |
|      |                 |                    |                |
|      |                 |                    `--> SQLite      |
|      |                 `--> Context ----> FTS5               |
|      `--> Worker Jobs ----> Inference Lane ----> LM Studio  |
|                                                             |
| Narration ----> Context ----> Inference Lane ----> LM Studio|
|                                                             |
| Addon Reconciler ----> Campaign Engine                      |
| Backup / Migration ----> Campaign Journal                   |
+-------------------------------------------------------------+
        ^
        | OpenAI-compatible request with one versioned exchange
        |
Pinned SillyTavern :8001

Visible Wayfinder.cmd supervisor
  owns: project-local SillyTavern + Companion
  observes only: LM Studio
```

## Dependency direction

Dependencies point inward toward policy:

```text
HTTP / browser / filesystem / SQLite / LM Studio / SillyTavern adapters
                              |
                              v
Workspace, Narration, Worker Jobs, Context, Campaign Engine
                              |
                              v
Domain values, Operations, Events, Problems, wire schemas
```

The domain and deep modules never import Fastify, React, SQLite row types, SillyTavern globals, LM Studio response objects, PowerShell, or filesystem watcher APIs.

Only one shared package is justified: `packages/wire`, containing versioned runtime schemas, derived TypeScript types, problem documents, and bridge constants. Domain implementation stays inside the companion application rather than being split into noun-sized packages.

## Final public module interfaces

### Campaign Engine

```ts
interface CampaignEngine {
  read<Q extends CampaignRead>(request: Q): Promise<Outcome<CampaignReadResult<Q>>>;
  execute(request: CampaignExecution): Promise<Outcome<CampaignCommit>>;
  executeBatch(request: CampaignBatchExecution): Promise<Outcome<CampaignCommit>>;
  changes(request: CampaignChangeRequest, signal: AbortSignal): AsyncIterable<CampaignInvalidation>;
}
```

Guarantees:

- one accepted Operation or atomic batch creates one new Campaign Revision and one immutable Campaign Event;
- rejection creates neither;
- expected Revision prevents stale overwrite;
- repeated accepted request IDs are idempotent;
- names never act as references;
- no transaction spans model, HTTP, or filesystem waits.

### Campaign Journal

```ts
interface CampaignJournal {
  transact<T>(work: (tx: CampaignJournalTransaction) => T): T;
  readAt(request: JournalReadRequest): JournalReadResult;
  verify(request: JournalVerificationRequest): JournalVerificationResult;
  backup(request: JournalBackupRequest): JournalBackupResult;
}
```

The Journal is the only owner of SQLite, migrations, WAL policy, snapshots, reconstruction, integrity checks, and backup primitives.

### Workspace

```ts
interface Workspace {
  load(request: WorkspaceLoad): Promise<Outcome<WorkspaceDocument>>;
  act(request: WorkspaceIntent): Promise<Outcome<WorkspaceTransition>>;
  changes(request: WorkspaceChangeRequest, signal: AbortSignal): AsyncIterable<WorkspaceNotice>;
}
```

Workspace exposes task documents and user intents, not generic CRUD rows. Campaign Book is the cross-device shell. Command Deck patterns may appear as operational cards. Ledger is optional wide-desktop Collection mode and collapses to normal routes on narrow screens.

### Context

```ts
interface Context {
  plan(request: PreflightContextRequest, signal: AbortSignal): Promise<Outcome<ContextPlan>>;
}
```

There is one phase only: deterministic preflight. The Context plan pins Campaign, Binding, and Context Focus revisions; applies Narrator Visibility before search; allocates complete required core and ordered pins; then uses unique exact mention, Scene anchors, qualified FTS5, and one relation hop. Ambiguity selects nothing. Vectors are disabled in v1.

### Narration

```ts
interface Narration {
  respond(request: NarratorExchange, signal: AbortSignal): Promise<Outcome<ProxyDelivery>>;
}
```

Linked flow:

1. decode and validate one versioned exchange envelope;
2. verify Chat Binding, locator, authority, generation type, and request identity;
3. build one deterministic preflight Context plan;
4. make one LM Studio Chat Completions request;
5. buffer the complete visible reply;
6. recheck cancellation;
7. deliver atomically.

Unlinked flow remains one transparent upstream call. Missing or malformed routing metadata never defaults to unlinked. There are no hidden drafts, enrichment calls, automatic retries, or hidden-prose recovery entries.

### Worker Jobs

```ts
interface WorkerJobs {
  dispatch(command: WorkerCommand): Promise<Outcome<JobReceipt>>;
  read(query: WorkerQuery): Promise<Outcome<JobView>>;
  changes(request: JobChangeRequest, signal: AbortSignal): AsyncIterable<JobNotice>;
}
```

Worker Jobs receives Campaign read capability only. It cannot call Campaign execute. Accepted Proposals are applied later through one explicit human Workspace intent and one atomic Campaign batch.

### Inference Lane

```ts
interface InferenceLane {
  run(request: InferenceRequest, signal: AbortSignal): Promise<Outcome<InferenceResult>>;
}
```

One call may be active at a time. Narration has priority over queued worker calls. A new narration request cancels an active cancellable worker HTTP request and waits for its termination before starting. V1 uses the model already exposed by LM Studio; it does not load, unload, or swap models automatically.

## Persistence and concurrency boundary

One companion process owns one SQLite writer. Ordinary bounded reads and writes remain in the process. Heavy verification, full replay, snapshot rebuild, FTS rebuild, import analysis, and backup validation run through a worker-thread maintenance adapter or an isolated child process so they cannot stall narrator HTTP handling.

Move any additional Journal operation off the event-loop path when either condition is observed on the target machine and representative campaign dataset:

- p95 duration exceeds 25 ms across 100 consecutive executions; or
- any normal interactive execution exceeds 100 ms.

Interactive Campaign commits must remain atomic and are never moved into a second writer process. Heavy work prepares data outside the write transaction, then commits through the single writer.

## Performance and resource gates

These are implementation acceptance gates, not claims about current production code.

### Companion and Workspace

- idle companion working set: target below 250 MiB; hard investigation gate at 400 MiB;
- ordinary Workspace document load excluding network transfer: p95 below 100 ms on the host;
- ordinary Campaign commit: p95 below 50 ms, no interactive commit above 200 ms;
- no horizontal overflow at 360–430 CSS px on required mobile routes;
- touch targets, keyboard focus, pending state, and error recovery must remain usable on the real Android path.

### Context

- deterministic plan for a representative campaign: p95 below 100 ms;
- no Campaign Private text in FTS, rendered blocks, or diagnostics;
- required core and pins are never truncated;
- ambiguity tests always select zero records;
- vectors remain disabled until a separate measured decision establishes model, dimension, thresholds, winner margin, latency, memory cost, and failure degradation.

### Narration

- companion-added pre-model latency, excluding LM Studio inference: p95 below 250 ms;
- one upstream model call for every successful linked generation;
- zero upstream calls on binding, authority, budget, or Campaign-unavailable rejection;
- zero visible linked bytes before the complete response is accepted;
- Stop must prevent late buffered delivery;
- no automatic retry after model work begins.

### Worker Jobs

- never overlap an inference call with Narration;
- every durable stage survives process restart or becomes explicitly interrupted;
- raw source/model output is removed after authority acknowledgement according to the accepted job design;
- no Proposal can mutate Campaign state without a separate human finalization request.

### Supervisor and updates

- startup refuses occupied owned ports and reports the owner;
- shutdown stops only identity-matched children it started;
- LM Studio absence degrades model features but leaves Workspace and Campaign editing available;
- update activation requires backup, staged runtime, compatibility checks, smoke checks, and rollback.

## Failure guarantees

Expected failures are returned as typed Problems. Programmer faults, migration checksum failures, impossible Event history, failed integrity verification, and corruption fail readiness or terminate the affected operation loudly.

The system guarantees:

- no silent fallback from linked to unlinked;
- no silent Campaign mutation from model output;
- no partial Campaign commit;
- no silent pin truncation or ambiguity guessing;
- no hidden draft or generated prose persisted by Narration;
- no automatic model retry;
- no unrelated-process termination;
- no destructive migration without preview and validated backup;
- no claim that fallback and companion histories remain synchronized after divergent play.

## Verification seams

### Pure domain tests

Exercise Operations, validation, references, revisions, Events, Binding facets, visibility, deterministic ordering, token allocation, ambiguity, Proposal decisions, and Problem mapping without SQLite or HTTP.

### Adapter contract tests

Run the same Journal contract against temporary SQLite databases. Test LM Studio and SillyTavern adapters against scripted local HTTP fixtures. Test addon reconciliation against temporary directories. Test the supervisor against temporary listeners and identity-mismatched processes.

### Failure-injection tests

Inject crash points before and after transaction commit, stale revisions, duplicate request IDs, malformed model responses, empty visible output, disconnects, cancellation, unavailable Campaign, unavailable LM Studio, corrupt backups, watcher event loss, stale import manifests, and failed staged updates.

### Real-runtime gates

Before cutover, run on the actual Windows host and Android path:

- pinned SillyTavern send/regenerate/continue/swipe/Stop/outage trace;
- representative Campaign import and backup/restore;
- real SQLite latency and memory measurements;
- real Workspace desktop and phone acceptance;
- real LM Studio narration and worker cancellation/preemption;
- supervisor start/stop/occupied-port/degraded-mode trace;
- staged SillyTavern update and rollback;
- fallback switch and divergence warning.

The already accepted #20 physical-phone proxy trace remains valid evidence and need not be repeated until production bridge implementation changes the affected seam.

## Migration and fallback boundary

Legacy `chat_metadata.stLlmRpgCampaign` is read from the selected saved chat, previewed, fingerprinted, and imported into a new revision-1 SQLite Campaign plus explicit Chat Binding. Legacy metadata is preserved. Addon files create reviewable import candidates and never mutate truth from watcher events.

The fallback extension remains installed and operational through production cutover. It may be retired only after the complete real-device cutover trace passes and backups are verified. Returning to fallback after companion-only Events creates a divergent branch; there is no silent reverse migration.

## Rejected alternatives

- continuing to extend the browser-only fallback as the production authority;
- one generic dispatcher for every command and query;
- microservices or multiple companion processes;
- domain-noun npm packages;
- browser access to SQLite or authoritative JSON mutation;
- hidden-draft/revision narration;
- vector retrieval without measured thresholds;
- automatic LM Studio load/unload or model swapping in v1;
- concurrent narrator and worker inference;
- tools available to the narrator;
- model-applied Campaign changes;
- authentication, pairing, public exposure, native mobile app, SSR, Redux, or a large UI framework in v1.

## Supersession

This document makes the final #26 decision. It supersedes provisional architecture text in `companion-runtime-and-module-seams.md` where that text describes hidden drafts, enrichment phases, recovery prose, vectors as enabled behavior, or automatic model swapping. The accepted detailed Campaign, Binding, proxy, Workspace, worker-job, migration, and cutover contracts remain authoritative where they do not conflict with this final reduction.