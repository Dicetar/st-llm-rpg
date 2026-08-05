# Story Sync and model-job orchestration

Status: accepted as the provisional design for Wayfinder issue #24. The throwaway prototype proves the selected persistence, review-finalization, restart, cancellation, malformed-output, narrator-priority, and sequential-model-lane transitions. Wayfinder #26 must combine this evidence with live LM Studio measurements before fixing the final execution policy.

## Decision

Story Sync is a durable, user-triggered **Worker Job** attached to one Chat Binding. It analyzes one bounded, fingerprinted chat range after that binding's Sync Boundary and may persist editable Proposals. It never applies a Proposal, advances the Sync Boundary, writes a SillyTavern message, follows a Campaign head, or receives Campaign mutation capability.

A completed review is one explicit human finalization:

1. every Proposal is edited and marked **Accept** or **Reject**;
2. the bound chat supplies a fresh proof that the analyzed message prefix is unchanged;
3. Workspace prepares one stable authority request;
4. accepted Proposal operations are submitted as one atomic Campaign Operation batch;
5. the same authority transaction advances only that Chat Binding's Sync Boundary;
6. Worker Jobs records the returned authority receipt idempotently and marks the review complete.

If there are no accepted Proposals, finalization contains only the explicit Binding Operation advancing the Sync Boundary. If Campaign revision, Campaign Anchor, Binding identity, Sync facet, source proof, Proposal revision, or validation is stale, neither Campaign state nor Sync Boundary changes.

The internal inference runtime owns one local model lane. Narration always has priority. A queued worker waits. An active worker generation is aborted and safely requeued when narration arrives. Model load/unload transitions are sequential and allow at most one companion-managed model instance on the constrained 16 GB system. A non-cancellable model-management transition may finish, but worker generation does not start while narration is waiting.

## Accepted boundaries

This design implements and refines:

- [ADR 0009](../adr/0009-require-human-review-for-model-assisted-campaign-changes.md): models create Proposals but cannot apply them or advance a Sync Boundary;
- [Companion runtime and module seams](./companion-runtime-and-module-seams.md): Worker Jobs receives Campaign read capability only, while Inference Runtime remains internal;
- [Campaign authority, history, and Chat Binding lifecycle](./campaign-authority-history-and-bindings.md): Sync Boundary is one Binding facet, Campaign and Binding histories are independent, and explicit workflows may commit both histories atomically;
- [SillyTavern bridge and narrator proxy](./sillytavern-bridge-and-narrator-proxy.md): narration propagates cancellation, fails closed for invalid bindings, and owns the priority inference path;
- [Current extension disposition](./current-extension-disposition.md): retain bounded source capture, conservative parsing, one repair, stale-source rejection, and editable review while retiring browser-owned worker execution.

The fallback applies accepted Proposals one at a time and advances the Sync Boundary when the final Proposal is resolved. The companion replaces that with one explicit final review commit. This prevents partial application, avoids several Campaign Revisions for one analyzed range, and makes boundary advancement atomic with the reviewed Campaign change set.

## Domain terms

**Worker Job** is a durable non-canonical request for model-assisted analysis. It owns its source snapshot, Attempts, profile, status, Problems, and Proposals. It may read pinned Campaign state but never mutate it.

**Job Attempt** is one execution of a Worker Job against one exact source fingerprint and model profile. Retry or Resume creates another Attempt rather than overwriting the previous one.

**Story Sync Source** is a bounded canonical snapshot of contiguous SillyTavern messages immediately after one verified Sync Boundary.

**Source Proof** is bridge-supplied evidence that the bound chat's canonical message prefix still matches the stored source. Message indices alone are insufficient because edits, deletes, regenerations, and swipes may retain or reuse positions.

**Review Finalization** is the explicit human action that converts accepted Proposal drafts into one typed Campaign Operation batch and advances the same binding's Sync Boundary in one authority transaction.

**Inference Lane** is the single serialized lease over local LM Studio model management and inference. Narration has strict priority over workers.

## Source capture and fingerprints

The companion does not read SillyTavern chat JSONL directly. The thin SillyTavern Bridge is the first source adapter because it can observe the current pinned chat through supported browser APIs.

```ts
type StorySyncSource = Readonly<{
  bindingId: ChatBindingId;
  locator: ChatLocatorV1;
  boundary: {
    throughMessageIndex: number;
    prefixHash: Sha256;
  };
  messages: readonly {
    index: number;
    role: "player" | "narrator";
    name: string;
    content: string;
    contentHash: Sha256;
  }[];
  rangeHash: Sha256;
  endPrefixHash: Sha256;
  fingerprint: Sha256;
}>;
```

Rules:

- the first message is exactly the message after the current Sync Boundary;
- indices are contiguous within the range;
- normalized visible role, name, and content participate in hashes;
- hidden DOM/browser state, timestamps, and tab identity do not participate;
- the source is bounded by reviewed message-count and byte limits;
- transcript text is untrusted prompt data;
- the fingerprint includes Binding ID, locator, prior boundary, and ordered message hashes;
- the end-prefix hash chains the old accepted prefix with the new range;
- edit, delete, changed swipe, reorder, locator change, or another Binding changes the proof.

A Job starts only when the binding is active, the locator is accepted, Campaign Anchor equals Campaign head, the supplied Sync Boundary matches current binding state, no unresolved review owns the next range, and the worker profile and source limits validate.

The source snapshot persists because execution may be interrupted and reviewers need stable evidence. It is operational state, not Campaign truth. Successful finalization prunes raw message text and raw model output; fingerprints, range metadata, bounded evidence excerpts, decisions, and authority receipts remain. Failed, cancelled, and interrupted Jobs retain their source until Resume or Discard. Campaign Purge removes Campaign-owned Jobs and Proposals.

## Worker Jobs interface

```ts
interface WorkerJobs {
  dispatch(command: WorkerCommand): Promise<Outcome<JobReceipt>>;
  read(query: WorkerQuery): Promise<Outcome<JobView>>;
  decide(command: WorkerDecision): Promise<Outcome<JobView>>;
  prepareFinalization(
    request: PrepareReviewFinalization,
  ): Promise<Outcome<ReviewFinalizationPlan>>;
  acknowledgeAuthority(
    request: AcknowledgeReviewAuthorityCommit,
  ): Promise<Outcome<JobView>>;
  changes(
    request: { after?: JobCursor; campaignId?: CampaignId; bindingId?: ChatBindingId },
    signal: AbortSignal,
  ): AsyncIterable<JobNotice>;
}
```

Worker Jobs receives only `CampaignEngine.read`. It never receives `CampaignEngine.execute`, a generic SQL connection, an Event appender, a Sync Boundary writer, or a SillyTavern chat writer.

Commands are a closed union:

```ts
type WorkerCommand =
  | {
      kind: "start-story-sync";
      requestId: RequestId;
      campaignId: CampaignId;
      bindingId: ChatBindingId;
      expected: {
        campaignAnchor: CampaignRevision;
        bindingRevision: BindingRevision;
        syncFacetRevision: BindingFacetRevision;
      };
      source: StorySyncSource;
      profileId: WorkerModelProfileId;
    }
  | { kind: "cancel-job"; jobId: WorkerJobId }
  | {
      kind: "resume-job";
      jobId: WorkerJobId;
      sourceProof: StorySyncSourceProof;
    }
  | { kind: "discard-job"; jobId: WorkerJobId };
```

Proposal editing and Accept/Reject decisions change non-canonical Job state only. They create no Campaign or Binding Event.

## Job and Attempt states

Durable Job states:

```text
queued
  -> waiting-for-lane
  -> loading-model
  -> running
  -> parsing
  -> repairing
  -> ready-for-review
  -> awaiting-authority
  -> completed

queued | waiting-for-lane | loading-model | running | parsing | repairing
  -> interrupted | cancelled | failed

interrupted | cancelled | failed
  -> queued                 (explicit evidence-checked Resume)
  -> discarded

ready-for-review
  -> discarded

awaiting-authority
  -> completed              (matching authority receipt)
  -> awaiting-authority     (uncertain result; reconciliation only)
```

`awaiting-authority` cannot be discarded or edited because the authority request may already have committed.

Attempt states are `running -> completed | interrupted | cancelled | failed`. Every retry, user Resume, or narrator-preempted rerun creates the next Attempt number. Previous output hashes, termination reasons, and bounded diagnostics remain inspectable.

At startup, Jobs left in `loading-model`, `running`, `parsing`, or `repairing` become `interrupted`, and their active Attempts become interrupted with `host-restarted`. They do not automatically run after restart. Resume requires fresh Binding, Campaign Anchor, Sync facet, locator, and source-fingerprint validation.

Cancellation rules:

- queued cancellation is immediate;
- active inference cancellation aborts LM Studio and discards partial output;
- cancellation during parsing/repair is checked before the Proposal transaction;
- once the Proposal transaction begins it commits or rolls back synchronously;
- cancelling a ready review does not delete it; the user explicitly Discards;
- once authority finalization begins, cancellation cannot imply rollback;
- user-cancelled Jobs do not auto-resume;
- narrator-preempted workers requeue because they produced no canonical or reviewable side effect.

## Proposal model

```ts
type Proposal = Readonly<{
  proposalId: ProposalId;
  jobId: WorkerJobId;
  ordinal: number;
  revision: ProposalRevision;
  decision: "pending" | "accept" | "reject";
  draft: ProposalDraft;
  sourceLinks: readonly ProposalSourceLink[];
  validationProblems: readonly ProposalProblem[];
  confidence: "high" | "medium" | "low";
  authoritySubject?:
    | { kind: "campaign-event"; eventId: CampaignEventId; revision: CampaignRevision }
    | { kind: "human-rejection" };
}>;
```

A Proposal contains one typed candidate Campaign Operation or one explicitly unresolved operation draft. Names from model output never become references automatically. CampaignReader may resolve a unique stable ID; ambiguous or absent subjects become editable Problems rather than guessed references or silently skipped candidates.

After the outer JSON document parses, every candidate entry remains visible. Unknown fields, invalid operation shapes, ambiguity, stale IDs, and validation failures remain reviewable. No Proposal can call Story Sync, set a Sync Boundary, accept another Proposal, manipulate Job state, or write a chat message.

## Worker output and malformed recovery

The worker receives a conservative system prompt, a bounded revision-pinned Campaign projection, the exact source snapshot as untrusted text, a strict Proposal schema, and no tools or mutation endpoint.

Processing is bounded:

1. run one worker inference;
2. require a visible answer and one JSON object;
3. if malformed, run exactly one repair inference using bounded raw output;
4. parse and validate every candidate;
5. persist Proposals and Problems in one short transaction;
6. discard hidden reasoning and partial streams.

If repair remains unusable, the Job becomes failed and offers **Retry job**, **Add Proposal manually**, and **Discard job**. There is no automatic second repair, hidden retry, partial Campaign application, or automatic empty-review completion.

## Human finalization and authority reconciliation

`prepareFinalization` requires a ready review, an explicit decision for every Proposal, valid accepted operations, matching Proposal revisions, a fresh source proof, accepted locator, Campaign Anchor equal to head, and current Campaign/Sync revisions.

It returns but does not execute:

```ts
type ReviewFinalizationPlan = Readonly<{
  jobId: WorkerJobId;
  requestId: RequestId;
  decisionHash: Sha256;
  campaignId: CampaignId;
  bindingId: ChatBindingId;
  expected: {
    campaignRevision: CampaignRevision;
    bindingRevision: BindingRevision;
    syncFacetRevision: BindingFacetRevision;
  };
  campaignOperation: AtomicCampaignBatch | null;
  bindingOperation: {
    kind: "set-sync-boundary";
    boundary: SyncBoundary;
  };
  acceptedProposalIds: readonly ProposalId[];
  rejectedProposalIds: readonly ProposalId[];
}>;
```

The stable Request ID is derived from Job ID plus the canonical decision hash. Once prepared, Proposal editing is locked and the Job enters `awaiting-authority`.

Workspace submits the plan to Campaign Engine as one explicit cross-history transaction. This refines #17: the transaction may append one Campaign Event for the atomic accepted batch and one Binding Event for `set-sync-boundary`. Empty reviews append only the Binding Event. Both histories retain ordinary expected revisions, validation, idempotency, and immutable Events.

A crash after authority commit but before Job acknowledgement is safe. Workspace resubmits the identical Request ID, Campaign Engine returns the idempotent receipt, and Worker Jobs records it. Accepted Proposals link to the Campaign Event, rejected Proposals record human rejection, and raw source/output content is pruned. No new Request ID may be generated while authority outcome is uncertain.

## Narrator-priority inference lane

Priority rules:

1. narration sorts before queued workers;
2. only one task owns the lane;
3. a worker starts only when no narration is queued;
4. narration arriving during worker generation aborts it and requeues it from the start;
5. narration arriving during a model-management transition waits for that bounded transition, then runs before worker inference;
6. repeated preemption remains visible as **Paused for narration**;
7. user cancellation removes the worker instead of requeueing it;
8. no SQLite transaction spans queue wait, model management, or inference;
9. no output from a preempted Attempt is parsed or persisted;
10. narrator and worker use separate reviewed profiles even when they target the same model.

Narration priority applies to linked and explicit-unlinked Chat Completion traffic handled by the companion. Transparent unlinked bytes remain transparent; scheduling does not authorize request-body mutation.

## Sequential LM Studio model management

Inference remains OpenAI-compatible Chat Completions at `/v1/chat/completions`. Model management uses LM Studio's native v1 REST API:

- `GET /api/v1/models` for model and instance status;
- `POST /api/v1/models/load` to load an exact model with reviewed configuration;
- `POST /api/v1/models/unload` to unload an exact instance.

Primary references:

- https://lmstudio.ai/docs/developer/rest
- https://lmstudio.ai/docs/developer/rest/load
- https://lmstudio.ai/docs/developer/rest/unload

A reviewed profile includes role, model key, request model ID, management mode, context length, load configuration, output limit, and readiness.

For companion-managed profiles:

- the companion records every instance ID it loaded;
- it unloads only instances it owns or the user explicitly adopted;
- it never silently unloads an unknown manually loaded instance;
- it loads the desired model only after the previous managed instance is gone;
- at most one managed LLM instance is resident;
- load/unload have bounded deadlines and explicit Problems;
- a failed unload or load blocks the task rather than overlapping models or relying on accidental JIT eviction.

Externally managed profiles are verified and used without load/unload control. If the exact model is absent or memory is insufficient, the task fails visibly; another model is never selected silently.

The native API is capability-detected at startup. #25 must pin the minimum LM Studio version and launcher checks. #26 must use target-machine measurements to select load deadlines, quiet-window behavior, preemption auto-resume limits, and the final native REST or official SDK adapter.

## Persistence and retention

Logical non-canonical storage:

```text
worker_jobs
  job identity, Campaign/Binding ownership, status
  source fingerprint/range/snapshot
  Campaign Anchor and Binding/Sync revisions
  worker profile
  finalization Request ID and decision hash
  authority receipt and Problem

worker_attempts
  attempt number, phase, status, termination
  bounded raw/repair output and hash
  profile snapshot and timings

proposals
  proposal identity/revision/decision
  original and edited drafts
  source links and validation Problems
  authority subject after completion
```

Jobs and Proposals use short SQLite transactions but never enter Campaign or Binding Event history. They emit their own durable cursor and invalidations; Workspace refetches task documents rather than applying patches.

Unresolved source and bounded outputs remain until Resume, completion, or Discard. Successful completion prunes raw chat text and model output. Completed metadata, decisions, evidence excerpts, hashes, and authority receipt remain while the Campaign exists. Discard retains only a minimal terminal receipt. Campaign Purge removes Campaign-owned Jobs and Proposals. Backups include unresolved Jobs and Proposals as user work but never convert them into Campaign truth.

## Required Problems

- `story_sync_already_pending` — open or discard the existing Review Inbox;
- `source_empty` / `source_not_contiguous` — recapture from the bound chat;
- `source_proof_mismatch` — inspect edits and start a new Job;
- `binding_mismatch` / `binding_collision` — use accepted binding reconciliation;
- `campaign_revision_conflict` — retain review and compare current Campaign;
- `sync_facet_conflict` — reload binding and recapture source;
- `worker_model_unavailable` — load/configure the exact profile;
- `model_management_unavailable` — update LM Studio or use external management;
- `worker_cancelled` / `worker_interrupted` — Resume or Discard;
- `worker_output_unusable` — Retry, add manually, or Discard;
- `proposal_revision_conflict` — reload Proposal while retaining local draft;
- `proposal_invalid` — edit the typed operation or reject it;
- `review_incomplete` — decide every Proposal;
- `review_source_stale` — recapture and rerun; never advance the old boundary;
- `authority_outcome_uncertain` — reconcile the stable Request ID only;
- `foreign_model_blocks_load` — unload manually or explicitly adopt management.

## Prototype evidence

`prototypes/story-sync-job-spike/` demonstrates with real temporary SQLite and a fake sequential model host:

1. contiguous source capture and SHA-256 fingerprints;
2. stale Campaign Anchor rejection;
3. durable Job, source, and Attempt state across close/reopen;
4. restart interruption;
5. evidence-checked Resume and stale-source rejection;
6. user cancellation without automatic resume;
7. one malformed-output repair and explicit recovery;
8. editable decisions without Campaign mutation capability;
9. one prepared atomic Campaign batch plus Sync Boundary operation;
10. stale final proof blocking both changes;
11. idempotent authority acknowledgement;
12. raw source pruning only after successful reconciliation;
13. narration preempting worker inference;
14. worker rerun after narration;
15. sequential worker → narrator → worker model transitions with one loaded model.

The fake host does not prove LM Studio cancellation latency, load duration, VRAM release, server queue behavior, or model fidelity. Those remain gates for #20, #22, and #26.

## Rejected alternatives

**Apply Proposals one by one:** rejected because it creates partial review state and several Campaign Revisions.

**Give Worker Jobs Campaign execute capability:** rejected because parser, retry, or restart bugs could cross the human-review boundary.

**Advance Sync Boundary automatically:** rejected because final source proof and authority commit are explicit human work, including empty reviews.

**Persist worker output as Campaign Events:** rejected because Attempts and Proposals are operational review state, not accepted RPG truth.

**Run narrator and worker concurrently:** rejected for the 16 GB target because it risks VRAM exhaustion, opaque queues, and narrator latency.

**Unload any visible LM Studio model:** rejected; only companion-owned or explicitly adopted instances may be unloaded.

**Automatically resume after host restart:** rejected because startup must not unexpectedly load a model. Narrator preemption is the only automatic requeue.

## Consequences

- #25 must define LM Studio minimum-version checks, model-profile configuration, launcher readiness, shutdown, and fallback when native management is unavailable.
- #26 must decide worker-thread boundaries, lane quiet window, load/cancel deadlines, auto-resume limits, and the final LM Studio adapter.
- #27 must include bridge source-proof and atomic finalization wire documents.
- #28 should include a Story Sync tracer covering capture, persistence, Proposal review, one atomic batch with Sync Boundary, restart, and no automatic mutation.
