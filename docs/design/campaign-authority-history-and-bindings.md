# Campaign authority, history, and Chat Binding lifecycle

Status: semantics proven by the persistence prototype in Wayfinder #18. The prototype revised snapshot trust and triggered the synchronous SQLite worker-thread review described below. Wayfinder #26 will confirm the final architecture and measured execution boundary.

## Decision

Campaign Engine remains the sole accepted-mutation authority behind `read`, `execute`, and `changes`. SQLite stores three related but distinct histories:

1. an append-only Campaign Event stream for Campaign truth;
2. an append-only Binding Event stream for chat-specific state;
3. one durable ordered change feed indexing committed changes from both streams.

Every accepted Campaign Operation creates exactly one next Campaign Revision and one Campaign Event. Every accepted Binding Operation creates exactly one next Binding Revision and one Binding Event, but no Campaign Revision. A transaction may create one of each when a Campaign edit explicitly advances its originating Chat Binding's Campaign Anchor or when branching and binding are accepted together.

Current normalized projections make ordinary Workspace, Context, and reference queries fast. Campaign Events store schema-versioned normalized before/after subject images, so historical reconstruction applies accepted results without rerunning old validation or command code. A self-contained revision-zero Campaign Base plus periodic full snapshots bound state-application work; snapshots do not bypass Event-prefix integrity verification. Current projections and periodic snapshots are rebuildable; the Campaign Base and Campaign Events are authority.

Chat Bindings use one ordered Binding Revision plus four fixed facet counters—identity, anchor, sync, and pins. A Binding Operation checks only the facets it changes. This prevents a pin toggle, Sync Boundary update, locator reconciliation, and Campaign Anchor acknowledgement from creating unrelated conflicts while retaining one comprehensible binding history.

No model, narration request, file watcher, or background observation advances either history. Accepted human actions do.

## Evidence and constraints

This decision refines:

- [ADR 0007](../adr/0007-separate-campaign-authority-from-chat-bindings.md): Campaign and Chat Binding ownership are separate and mismatches require a person;
- [ADR 0008](../adr/0008-use-sqlite-as-campaign-authority.md): SQLite is canonical and every accepted Campaign Operation has one revision/event;
- [ADR 0011](../adr/0011-use-a-single-process-typescript-companion-with-capability-modules.md): Campaign Engine and Campaign Journal hide persistence and history behind a small Interface;
- [the proxy contract](../research/sillytavern-proxy-contract.md): pinned SillyTavern supplies a binding ID plus a mutable diagnostic chat locator, not a stable chat UUID;
- [the fallback Campaign model](./campaign-model-v1.md): typed Operations, stable IDs, atomic batches, archive-first lifecycle, reference blockers, immutable Scene Archives, and revision-safe Undo are proven behavior worth preserving;
- [the current-extension disposition](./current-extension-disposition.md): extract Campaign invariants and tests, not the browser-owned implementation.

The pinned SillyTavern `chatId` is a character chat name or group chat ID rather than a guaranteed immutable UUID. Branch and JSONL workflows copy chat metadata. A locator difference therefore proves a collision but cannot prove whether the user renamed a chat or copied it. The authority must ask instead of guessing.

## Stress-tested outcomes

The selected rules resolve the important failure scenarios as follows.

### Two tabs edit the same Campaign Revision

Both tabs edit revision 40. The first accepted Operation creates revision 41. The second receives `campaign_revision_conflict`; it creates no Event or partial projection change. The Workspace retains the draft and may show changes since revision 40. V1 does not silently rebase or merge fields.

### A pin changes while Story Sync advances

Both actions share a Chat Binding but affect different facets. The pin Operation checks the pins facet; the Sync Boundary Operation checks the sync facet. Both may be accepted in either order, each creating a Binding Revision and Event. If both change the same facet, optimistic concurrency rejects the stale one.

### Campaign truth advances from another chat

Binding B is anchored at Campaign Revision 18 while the Campaign head is 23. Linked narration, Story Sync, and Campaign edits from B pause before model work or mutation. The user may inspect revisions 19–23 and explicitly:

- follow revision 23, advancing only B's Campaign Anchor;
- branch a new Campaign from revision 18 and bind the chat to it;
- rebind to another Campaign;
- unlink or remain blocked.

The source Campaign is never rewound.

### A copied or renamed chat presents the same binding ID

Binding B is registered to locator A, but locator B presents its ID. The companion returns `binding_collision` and contacts neither Campaign Context nor LM Studio. Since rename and copy are indistinguishable, the available accepted choices are:

- move the existing binding to locator B, making locator A collide later;
- create a distinct binding at an explicitly chosen Campaign Revision;
- create a new Campaign branch and a distinct binding;
- leave this chat unlinked.

Pins copy only by explicit choice. Sync Boundary adoption additionally requires a verified matching message-prefix fingerprint; otherwise it resets. Proposals and worker jobs never copy.

### A response is lost after commit

The caller retries the identical Request ID and request body. Idempotency lookup runs before revision checks and returns the original receipt, cursor, Campaign Revision, and Binding Revision. Reusing the same Request ID with different canonical input returns `request_id_reused`.

### A Record is permanently deleted

Delete requires prior Archive and a fresh Reference Graph check. A successful Delete removes the subject from current projections and prevents ID reuse. Earlier Campaign Revisions still reconstruct it from immutable history. The UI must say that Delete means permanent removal from current Campaign state, not historical erasure.

### A snapshot or projection is damaged

A corrupt periodic snapshot is discarded and rebuilt from an earlier valid snapshot or the Campaign Base plus Events. A snapshot is never a new trust root: its complete Event-chain prefix is verified from the Campaign Base before its materialized state is accepted. A current projection mismatch enters maintenance and rebuilds from verified history. A broken Campaign Base or Event hash chain fails the affected Campaign closed and requires validated backup restoration; the engine never guesses.

### The database is restored while tabs are open

The restored authority changes its Store Epoch. Old subscription cursors receive `cursor_reset_required`; every tab discards cached documents and refetches. Equal-looking revision numbers from different authority epochs are never trusted.

## Considered interface designs

Three independent designs were compared.

### Alternative A: replay journal behind three methods

This design used an immutable Campaign Base, Campaign Events, current projections, periodic snapshots, separate binding state, and durable invalidations behind `read`, `execute`, and `changes`. It provided the best overall Depth: arbitrary revision reconstruction, branching, idempotency, safe Delete, and collision handling stayed inside Campaign Engine without exposing SQLite.

Its first draft stored normalized Operations as the replay source and used one Binding Revision for all binding state. The selected design improves it by replaying normalized before/after images and adding fixed binding facet counters. Old validators never become replay dependencies, and unrelated chat-specific changes do not conflict.

### Alternative B: append-only temporal subject versions

This design stored a complete immutable version of every changed subject and reference. Historical subject reads were direct indexed queries and needed no Event replay. It also proposed Campaign and Binding histories plus facet-specific concurrency.

It was rejected as the primary v1 authority. Full historical Campaign reads require temporal latest-row joins across every identity; small prose edits duplicate full subjects; branch materialization and indexes are large; and every future schema change must transform all historical subject/reference versions. Those costs grow precisely where a local long-running Campaign needs migrations to remain boring. The selected event-image model keeps its useful separate histories, facet revisions, Store Epoch, and materialized current head without adopting temporal tables as authority.

### Alternative C: guided workflow desks

This design exposed edit, binding, branch, and lifecycle sheets rather than domain reads and Operations. It offered excellent human recovery: conflict diffs, copied-chat choices, branch previews, and guarded Delete were easy to use correctly.

It was rejected as the Campaign Engine Interface because it couples Campaign authority to current Workspace UX and is a poor seam for Context, import, Narration reads, and behavioral tests. Its guided documents belong in the Workspace Module. Campaign Engine returns structured Problems and valid Recovery Actions from which Workspace builds those sheets.

## Public Campaign Engine Interface

The external seam selected in [the runtime decision](./companion-runtime-and-module-seams.md) remains three methods. `execute` has three closed scopes so their guarantees cannot be confused.

```ts
interface CampaignEngine {
  read<Q extends CampaignRead>(
    request: Q,
  ): Promise<Outcome<CampaignReadResult<Q>>>;

  execute<E extends CampaignExecution>(
    request: E,
  ): Promise<Outcome<CampaignExecutionResult<E>>>;

  changes(
    request: ChangeSubscription,
    signal: AbortSignal,
  ): AsyncIterable<CampaignInvalidation>;
}
```

### Reads

```ts
type CampaignRead =
  | {
      kind: "campaign-state";
      campaignId: CampaignId;
      at: "head" | CampaignRevision;
    }
  | {
      kind: "campaign-view";
      campaignId: CampaignId;
      at: "head" | CampaignRevision;
      view: CampaignView;
      page?: PageRequest;
    }
  | {
      kind: "campaign-events";
      campaignId: CampaignId;
      afterRevision?: CampaignRevision;
      limit: number;
    }
  | {
      kind: "campaign-diff";
      campaignId: CampaignId;
      fromRevision: CampaignRevision;
      toRevision: CampaignRevision;
    }
  | {
      kind: "reference-impact";
      campaignId: CampaignId;
      subjectId: SubjectId;
    }
  | {
      kind: "chat-binding";
      bindingId: ChatBindingId;
      presentedLocator?: ChatLocator;
    }
  | {
      kind: "campaign-catalog";
      includeArchived: boolean;
      page: PageRequest;
    };
```

Current reads use bounded current projections. Numbered reads use verified Base/snapshot/Event reconstruction. Binding reads return Campaign head, Campaign Anchor, Binding Revision, facet revisions, status, collision assessment, and only the Recovery Actions valid from that state.

### Executions

```ts
type CampaignExecution =
  | CampaignExecutionRequest
  | BindingExecutionRequest
  | CatalogExecutionRequest;

type BindingFacet = "identity" | "anchor" | "sync" | "pins";
type BindingFacetRevisions = Readonly<Record<BindingFacet, BindingFacetRevision>>;

type CampaignExecutionRequest = {
  scope: "campaign";
  requestId: RequestId;
  campaignId: CampaignId;
  expectedRevision: CampaignRevision;
  operation: CampaignOperation;
  acceptedBy: HumanClient;
  anchor?: {
    kind: "follow-resulting-campaign-head";
    bindingId: ChatBindingId;
    expectedIdentityFacetRevision: BindingFacetRevision;
    expectedAnchorFacetRevision: BindingFacetRevision;
  };
};

type BindingExecutionRequest = {
  scope: "binding";
  requestId: RequestId;
  target:
    | {
        kind: "new";
        bindingId: ChatBindingId;
        campaignId: CampaignId;
        campaignRevision: CampaignRevision;
        locator: ChatLocator;
      }
    | {
        kind: "existing";
        bindingId: ChatBindingId;
        expectedFacets: Partial<Record<BindingFacet, BindingFacetRevision>>;
      };
  operation: BindingOperation;
  acceptedBy: HumanClient;
};

type CatalogExecutionRequest = {
  scope: "catalog";
  requestId: RequestId;
  command: CreateCampaign | BranchCampaign | PurgeCampaign;
  acceptedBy: HumanClient;
};
```

The Campaign Operation union remains typed and domain-specific: create/edit/archive/restore/Delete Record or live entry, atomic batch, Advance Scene, Archive Campaign, and Restore Campaign. It never exposes table-shaped CRUD or string commands.

Binding Operations are a separate closed union:

```ts
type BindingOperation =
  | { kind: "create-binding"; label: string }
  | { kind: "move-locator"; locator: ChatLocator; collisionToken: CollisionToken }
  | {
      kind: "create-from-copy";
      sourceBindingId: ChatBindingId;
      sourceExpectedFacets: Partial<Record<BindingFacet, BindingFacetRevision>>;
      copyPins: boolean;
      syncBoundary:
        | { kind: "reset" }
        | { kind: "adopt"; verifiedPrefix: MessagePrefixProof };
    }
  | { kind: "follow-campaign-head"; revision: CampaignRevision }
  | { kind: "rebind"; campaignId: CampaignId; revision: CampaignRevision }
  | { kind: "set-sync-boundary"; boundary: SyncBoundary }
  | { kind: "replace-pins"; pins: readonly ContextPin[] }
  | { kind: "unlink" }
  | { kind: "restore-binding" };
```

The engine derives changed facets from the Operation and requires exact counters for those facets. Supplying expectations for unrelated facets is unnecessary and ignored rather than creating accidental coupling.

Branching is explicit:

```ts
type BranchCampaign = {
  kind: "branch-campaign";
  sourceCampaignId: CampaignId;
  sourceRevision: CampaignRevision;
  campaignId: CampaignId;
  title: string;
  binding?:
    | { kind: "none" }
    | {
        kind: "move";
        bindingId: ChatBindingId;
        expectedIdentityFacetRevision: BindingFacetRevision;
        expectedAnchorFacetRevision: BindingFacetRevision;
      }
    | {
        kind: "create";
        bindingId: ChatBindingId;
        locator: ChatLocator;
        sourceBindingId?: ChatBindingId;
        copyPins: boolean;
        syncBoundary: "reset" | MessagePrefixProof;
      };
};

type CreateCampaign = {
  kind: "create-campaign";
  campaignId: CampaignId;
  title: string;
  initial: InitialCampaignState;
  binding?:
    | { kind: "none" }
    | {
        kind: "create";
        bindingId: ChatBindingId;
        locator: ChatLocator;
        label: string;
      };
};

type PurgeCampaign = {
  kind: "purge-campaign";
  campaignId: CampaignId;
  expectedRevision: CampaignRevision;
  expectedHeadEventHash: EventHash;
  confirmation: {
    campaignTitle: string;
    acknowledgesExternalCopies: true;
  };
};
```

### Results

One accepted SQLite transaction has one durable Change Cursor and may contain one Campaign commit plus one Binding commit.

```ts
type AuthorityCommit = {
  requestId: RequestId;
  commitId: CommitId;
  cursor: ChangeCursor;
  idempotentReplay: boolean;
  campaign?: {
    campaignId: CampaignId;
    revision: CampaignRevision;
    eventId: CampaignEventId;
    affectedSubjects: readonly SubjectRef[];
  };
  binding?: {
    bindingId: ChatBindingId;
    revision: BindingRevision;
    eventId: BindingEventId;
    facetRevisions: BindingFacetRevisions;
  };
  purge?: {
    campaignId: CampaignId;
    finalRevision: CampaignRevision;
    finalEventHash: EventHash;
    backupReceiptId: BackupReceiptId;
  };
  refreshHints: readonly RefreshHint[];
  undo?: {
    eventId: CampaignEventId;
    expectedRevision: CampaignRevision;
  };
};
```

Undo never rewinds history. An eligible Undo is a new Campaign Operation applying the stored inverse images and is accepted only while the returned expected Campaign Revision remains head. Delete, Purge, Advance Scene, branch creation, and other explicitly irreversible workflows are not one-click undoable.

## Campaign and Binding revision rules

### Campaign Revision

- Revision numbers are positive integers scoped to one Campaign.
- Creation and branch genesis produce revision 1 and one Event.
- Every later accepted Campaign Operation or atomic batch increments exactly once.
- Rejected validation, reference, stale, cancellation, and storage outcomes create no Campaign Revision or Event.
- Campaign-wide expected revision is deliberate. V1 has no independent Record revisions and no automatic merge.
- Campaign IDs and subject IDs are never reused within live authority. Subject IDs are interpreted with Campaign ID; branches preserve them.

### Binding Revision and facets

- Binding Revision numbers are positive integers scoped to one Chat Binding.
- Every accepted Binding Operation increments Binding Revision exactly once and appends one Event.
- Fixed facets are `identity`, `anchor`, `sync`, and `pins`.
- A facet counter increments only when its state changes.
- An Operation checks only every facet it changes and rejects if any supplied expectation is stale.
- Binding state never increments Campaign Revision.
- Automatic Context selections, tab presence, health checks, narration attempts, and successful narration do not change binding state.

Creating a Chat Binding starts Binding Revision 1. Its identity and anchor facets start at 1; sync and pins start at 0 until explicitly populated.

### Atomic cross-history commits

A Campaign Operation originating from a verified binding may explicitly include the nested `follow-resulting-campaign-head` Binding Operation. The transaction checks Campaign Revision plus that binding's identity and anchor facets, appends one Campaign Event, advances only that binding's Campaign Anchor to the resulting Campaign Revision, and appends one Binding Event. Unrelated sync or pin changes do not reject the combined action. Other bindings stay anchored.

A branch-and-bind command similarly creates child Campaign Revision/Event 1 and one new or moved Binding Revision/Event in one transaction. The parent has no Event.

A create-and-bind command creates Campaign Revision/Event 1 and Binding Revision/Event 1 together. A Purge command creates neither domain Event because it destroys the target history; it records only the accepted catalog commit, purge receipt, backup receipt, and invalidation.

## Logical SQLite model

Physical columns and indexes belong to #18, but the prototype must preserve these logical relations and constraints.

### Accepted request and change ordering

```text
store_meta
  store_epoch

request_receipts
  request_id PK
  canonical_request_hash
  scope campaign|binding|catalog
  campaign_id nullable
  binding_id nullable
  terminal_kind accepted|rejected
  serialized_outcome
  created_at

accepted_commits
  sequence INTEGER PRIMARY KEY AUTOINCREMENT
  commit_id UNIQUE
  request_id UNIQUE
  accepted_by
  committed_at

change_scopes
  sequence FK accepted_commits
  scope campaign|binding|catalog|purge
  campaign_id nullable
  binding_id nullable
  campaign_revision nullable
  binding_revision nullable
  affected_views
  affected_subjects
```

An accepted request has one sequence even when it advances both histories. A deterministic rejected request may retain an idempotency receipt but has no accepted commit, Event, Revision, or invalidation. Transient infrastructure failures retain no terminal receipt.

### Campaign authority and replay

```text
campaigns
  campaign_id PK
  title
  status active|archived
  current_revision
  head_event_hash
  created_at
  archived_at nullable

campaign_bases
  campaign_id PK
  base_kind blank|branch|legacy_import
  state_schema_version
  canonical_state_blob
  state_hash
  source_campaign_id nullable
  source_revision nullable
  source_event_hash nullable
  source_title nullable

campaign_events
  campaign_id + revision PK
  event_id UNIQUE
  sequence FK accepted_commits
  event_schema_version
  operation_kind
  normalized_operation
  accepted_at
  accepted_by
  affected_subjects
  previous_event_hash
  event_hash

campaign_event_changes
  event_id + ordinal PK
  subject_kind
  subject_id
  before_schema_version nullable
  before_image nullable
  before_hash nullable
  after_schema_version nullable
  after_image nullable
  after_hash nullable

campaign_snapshots
  campaign_id + revision PK
  state_schema_version
  canonical_state_blob
  state_hash
  event_hash
  created_at
```

Campaign Event hash covers its immutable envelope and the ordered change-image hashes. Hashes detect corruption; they are not authentication.

The Campaign Base is revision 0 and never appears as an accepted public Campaign Revision. Revision 1's Event binds the Campaign Base state hash into its own immutable envelope. A blank Campaign stores its validated initial state. A branch stores the exact semantic parent state at the selected revision, rewritten only for child Campaign identity and branch-local revision metadata. A legacy import stores the trustworthy imported head and provenance without inventing earlier history.

### Current projections

Current projections include typed Record/live-entry tables, current Reference Graph edges, immutable current Scene Archive rows, subject tombstones, and current FTS material. They update in the same transaction as Events but are derived from the Campaign Base plus Event after-images.

There is no repository per Record kind and no generic public payload. A physical implementation may use typed common columns plus schema-versioned validated JSON for closed kind-specific shapes.

### Chat Binding authority

```text
chat_bindings
  binding_id PK
  campaign_id
  status active|unlinked|campaign_purged
  binding_revision
  identity_facet_revision
  anchor_facet_revision
  sync_facet_revision
  pins_facet_revision
  campaign_anchor
  current_locator
  label
  sync_boundary nullable
  created_at
  updated_at

binding_events
  binding_id + binding_revision PK
  event_id UNIQUE
  sequence FK accepted_commits
  event_schema_version
  event_kind
  changed_facets
  before_state
  after_state
  previous_event_hash
  event_hash

binding_locator_projection
  binding_id
  locator_hash
  locator
  disposition current|replaced
  from_binding_revision
  until_binding_revision nullable

binding_pin_projection
  binding_id + subject_id PK
  position
```

Binding state is small, so each Binding Event stores the complete accepted before and after state. This makes every Binding Revision reconstructable without a separate snapshot subsystem. The current binding, locator, and pin rows are projections used for fast validation, collision detection, and Reference Graph blockers.

## Accepted commit algorithm

Campaign Journal performs an accepted write synchronously inside one short SQLite transaction; no transaction spans an `await`, HTTP wait, model call, backup, or filesystem operation.

1. Canonically encode the request and calculate its hash.
2. Check the Request ID before current revision checks.
3. Return the recorded result for an identical terminal request; reject changed reuse.
4. Begin `IMMEDIATE` and load every aggregate the execution may change.
5. Verify expected Campaign Revision and every changed Binding facet expectation.
6. Validate the typed Operation and current Reference Graph.
7. Produce normalized before/after images and any inverse images.
8. Insert one accepted commit row and obtain its durable sequence.
9. Append one Campaign Event and/or one Binding Event with next revisions and that sequence.
10. Update current projections, head rows, and tombstones.
11. Insert every change scope and the idempotent receipt.
12. Commit, then wake subscribers.

SQLite rollback guarantees that no Event, head, projection, or invalidation can commit alone. Disconnect or cancellation before the transaction aborts the action. Once the transaction begins it completes commit or rollback; a disconnected caller retrieves the terminal result using the same Request ID.

## Reconstruction and snapshots

To read Campaign Revision R:

1. validate `1 <= R <= currentRevision`;
2. load the newest valid periodic snapshot at or before R, otherwise the Campaign Base;
3. verify the snapshot state hash and its complete Event-chain prefix from the Campaign Base through the snapshot's bound Event;
4. accept the snapshot's materialized state only after that prefix verifies;
5. load later Events in Campaign Revision order through R;
6. verify continuous revisions and the remaining Event hash chain;
7. upcast and apply each post-snapshot schema-versioned after-image without mutation validation;
8. produce the requested bounded view.

Old Campaign Operations remain audit evidence but are never executed during replay. Schema evolution supplies explicit image upcasters; immutable Event bytes are not silently rewritten.

V1 snapshot policy is provisional but exact for #18:

- revision-zero Campaign Base is mandatory and retained;
- a full periodic snapshot is due after every 100 accepted Campaign Revisions;
- periodic snapshots are derived accelerators and are created by a restart-safe local maintenance task after commit;
- missing periodic snapshots never block reads or writes;
- retain all created periodic snapshots while the Campaign exists;
- a corrupt periodic snapshot may be discarded and recreated;
- Campaign Events are never compacted or pruned.

The task reconstructs the immutable target revision outside a write transaction, then inserts the snapshot in a short transaction after verifying the target Event hash. The final #18 trace measured a 2,096,620-byte snapshot for 10,000 representative Records; creation took 284.3 ms and verified reconstruction took 188.4 ms. The prototype did not model 100 small Events, so the 100-Revision cadence remains provisional for #26.

Snapshots are acceleration data, not authority or independent integrity roots. A process-local verified-prefix cache may avoid repeated prefix work only while the same open database generation is known-good. Restore rotates Store Epoch and invalidates it. Suspected corruption and maintenance scrubs always verify from the Campaign Base.

The same run measured a 6.4 ms page read and 2.0 ms single-Record edit, but a 1,243.2 ms 10,000-Record import and 398.1 ms self-contained branch. Those long synchronous calls exceed #16's 50 ms review threshold. #26 must place Campaign Journal behind an asynchronous worker-thread boundary or prove an equivalent non-blocking ownership design; changing synchronous SQLite bindings alone does not solve the event-loop stall.

Current projections serve head reads. Startup verifies schema, head revision, foreign keys, tombstone constraints, and Event continuity. A projection disagreement triggers a pre-repair backup and deterministic rebuild from history. Campaign Base/Event corruption marks that Campaign unavailable until validated restore.

## Branch-at-revision behavior

Branching is an explicit catalog execution rather than a mutation of the source Campaign.

1. Reconstruct the source at any accepted Campaign Revision.
2. Verify the source Event hash and target Campaign ID/request idempotency.
3. Materialize the state as the child's immutable revision-zero Campaign Base.
4. Preserve subject IDs under the new Campaign ID; reset branch-local created/changed projection revisions to 1.
5. Record source Campaign ID, Revision, Event hash, and title as Lineage.
6. Append child Campaign Revision/Event 1, `campaign-branched`.
7. Optionally create or move one Chat Binding only when explicitly requested and expected.
8. Insert both change scopes and commit atomically.

The parent receives no Event. The child never queries the parent to read or reconstruct itself. It copies canonical Records, live entries, the current Scene, and Scene Archives visible at the source revision. It does not copy Chat Bindings, Campaign Anchors, Context pins, Sync Boundaries, Proposals, jobs, or addon/import candidates.

A source Campaign may later be purged without breaking the child. Lineage retains its opaque source identity, Revision, Event hash, and title, while availability is derived.

## Chat Binding lifecycle

### Identity and resolution

`ChatBindingId` is canonical companion identity. `ChatLocator` is an opaque bridge-supplied SillyTavern locator scoped sufficiently to distinguish the current character/group chat within the pinned host. Exact wire fields belong to #19.

The bridge must present an explicit route plus the binding ID stored in current chat metadata. The companion never finds a binding by locator alone.

- Explicit unlinked route with no binding ID is unlinked.
- Linked route with missing or unknown binding ID is an error, never pass-through.
- Binding ID plus accepted current locator is verified.
- Binding ID plus another locator is a Binding Collision.
- Multiple tabs/devices presenting the same binding ID and locator are intentionally one Chat Binding.
- A copied chat with an exactly indistinguishable locator cannot be detected without stronger host evidence; #19 must document and probe this pinned-ST limitation.

The locator does not contain browser-tab or device identity. Those values may appear in diagnostics but never choose Campaign truth.

### Creation and bridge acknowledgement

Creating a binding is one accepted Binding Operation at the Campaign Revision the user selected. SQLite becomes authoritative first. SillyTavern metadata is only a binding-ID locator hint and is written/read back by the bridge afterward.

If the metadata write fails, the binding remains valid and Workspace exposes **Retry chat link marker**. Linked generation stays blocked until the current chat presents the accepted binding ID. The system neither rolls back Campaign truth nor creates a second pending authority.

### Campaign Anchor

The Campaign Anchor is changed only by:

- explicit **Follow current Campaign**;
- explicit rebind;
- an accepted Campaign Operation whose request includes this verified binding as its anchor context;
- explicit branch-and-bind.

Narration, health checks, reads, and background jobs never advance it. Linked Narration and Story Sync require the Anchor to equal Campaign head. A mismatch returns the accepted choices listed in the stress tests before model work.

### Locator collision

SillyTavern rename and copy are intentionally not inferred. A collision token binds the user's subsequent decision to the inspected identity-facet revision, old locator, and presented locator. Unrelated sync or pin changes do not expire it. If identity changes before acceptance, the choice expires and Workspace reloads the assessment.

Moving a binding changes identity facet and retains the prior locator in Binding history. Creating from a copy gives the new chat a new binding ID. Pins copy only explicitly; Sync Boundary copying requires a verified prefix; unresolved Proposals and jobs do not copy.

### Unlink and restore

Unlink creates a Binding Revision/Event and removes the binding from linked generation. The old binding ID remains a tombstone so copied or stale chat metadata is rejected rather than silently treated as unlinked. Restore is explicit, requires the Campaign to exist and the target locator to be free, and creates another Binding Event.

There is no ordinary hard Delete of an individual Chat Binding in v1. Binding history is small and is necessary to diagnose copies and stale metadata. Whole-Campaign Purge removes its RPG-bearing binding state while retaining minimal non-content tombstones.

## Archive, Delete, and Purge

### Record and live-entry Archive/Delete

- Archive is the default reversible removal and an ordinary Campaign Operation.
- Archived subjects remain referenceable, restorable, and visible in history but leave normal Collections and automatic Context selection.
- Delete requires prior Archive and reruns the Reference Graph check in the commit transaction.
- Surviving current references, including active binding pins, are blockers. The engine returns all blockers and performs no cascade.
- References removed in the same atomic batch do not block.
- Delete writes a permanent subject-ID tombstone and removes current projections/FTS. The ID is never reused.
- Campaign Events and older Revisions retain the subject. Historical Scene Archives are frozen self-contained history, not current reference blockers.

Scene Archives and Campaign Events have no edit or individual Delete Operation. Corrections are later Campaign Operations or a branch from an earlier Revision.

### Whole-Campaign Archive

Archive Campaign and Restore Campaign are ordinary Campaign Operations with expected revision, Event, and revision increment.

While archived:

- current/historical reads, export, backup, branching, and Restore remain available;
- ordinary edits, Narration, Story Sync, import apply, and Advance Scene are blocked;
- existing Chat Bindings remain recorded and return `campaign_archived`.

### Whole-Campaign Purge

Purge is destructive catalog maintenance rather than a Campaign Operation because it destroys the history in which an Event could live. It requires:

- Campaign already archived;
- exact current Campaign Revision and final Event hash;
- no active worker/import/restore operation;
- automatic validated pre-purge SQLite backup;
- typed Campaign-name confirmation and explicit acknowledgement that backups, exports, addons, and ST chats remain separate copies.

Purge deletes current state, Campaign Base, Events, snapshots, Scene Archives, Campaign-scoped request receipts, Proposals/jobs owned by the Campaign, and RPG-bearing binding state in one transaction. It removes prior Campaign change scopes while leaving monotonic sequence gaps valid. It retains a minimal non-content purge receipt and purged-binding tombstones containing opaque IDs, time, final Revision/hash, and backup receipt. Self-contained child branches remain usable.

Purge emits a durable catalog invalidation. It is never bulk, cascaded from Record Delete, or one-click undoable.

## Durable subscriptions

```ts
type ChangeCursor = {
  storeEpoch: StoreEpoch;
  sequence: bigint;
};

type ChangeSubscription = {
  after?: ChangeCursor;
  scopes: readonly (
    | { kind: "campaign"; campaignId: CampaignId }
    | { kind: "binding"; bindingId: ChatBindingId }
    | { kind: "catalog" }
  )[];
};

type CampaignInvalidation = {
  cursor: ChangeCursor;
  changes: readonly (
    | {
        scope: "campaign";
        campaignId: CampaignId;
        revision: CampaignRevision;
        affectedViews: readonly CampaignViewKey[];
        affectedSubjects: readonly SubjectRef[];
      }
    | {
        scope: "binding";
        campaignId: CampaignId;
        bindingId: ChatBindingId;
        revision: BindingRevision;
        changedFacets: readonly BindingFacet[];
      }
    | { scope: "catalog" }
    | { scope: "purge"; campaignId: CampaignId }
  )[];
};
```

One accepted transaction emits one ordered invalidation containing every changed scope. Payloads are hints, never canonical state patches. Clients refetch bounded documents.

On subscribe, Campaign Journal reads durable rows after the cursor, registers an in-process wake signal, rechecks before sleeping, then repeats. This closes the read/wait race. Idempotent retries create no duplicate invalidation.

If no cursor is supplied, the engine emits a current `reset-required` cursor instead of replaying all history. If more than 1,000 accepted commits are pending, it emits `reset-required` rather than flooding a phone. A changed Store Epoch, future sequence after restore, or unknown cursor also requires full refetch.

## Retention

While a Campaign exists, v1 retains without semantic compaction:

- Campaign Base and every Campaign Event/Revision;
- every Campaign Event change image and subject tombstone;
- immutable Scene Archives;
- all created periodic snapshots;
- accepted and deterministic-rejection Request ID receipts;
- every Binding Event/Revision, facet state, locator decision, and binding tombstone;
- current archived Records/live entries until Restore, Delete, or Purge;
- every accepted change-feed commit/scope.

Current projections and FTS are rebuildable and may be replaced after verification. Ephemeral Context selection, active HTTP sessions, tab presence, hidden Narration Drafts, and diagnostics do not enter this history. Worker/Proposal retention belongs to #24; backup-file retention belongs to #25.

No automatic history pruning is allowed in v1. Any compaction that removes Events or makes a numbered Campaign Revision unreconstructable requires a new architectural decision.

Purge removes Campaign content/history from the live authority but cannot erase external copies. Minimal purge and stale-binding tombstones plus the catalog invalidation remain indefinitely.

## Problems and Recovery Actions

Expected failures cross the Interface as values. Required codes include:

- `campaign_revision_conflict` — reload/compare, retain draft, optionally branch from the expected Revision;
- `binding_revision_conflict` — reload the binding sheet;
- `binding_mismatch` — follow head, branch at Anchor, rebind, unlink, or remain blocked;
- `binding_collision` — move, create a distinct binding, branch, unlink, or remain blocked;
- `request_id_reused` — generate a new Request ID only for a genuinely new action;
- `reference_blocked` — show every current blocker;
- `record_not_archived` — Archive first;
- `campaign_archived` — Restore, export, branch, or rebind;
- `revision_not_found` — choose an accepted Revision;
- `history_corrupt` — restore a validated backup; never retry blindly;
- `cursor_reset_required` — discard cached documents and refetch;
- `purge_precondition_failed` — resolve active work or confirmation/backup requirements.

Every conflict carries actual revisions and bounded affected-subject summaries. Problems may include a short-lived inspection token so a later human choice is bound to the exact state inspected. Tokens are workflow state, not Campaign history.

## Prototype obligations for #18

The persistence prototype is not complete until it proves through the Campaign Engine Interface and real temporary SQLite files:

1. blank Campaign revision 1 and one Event;
2. Campaign and Binding Operations commit atomically with separate revisions/events;
3. stale Campaign and same-facet Binding conflicts reject without partial state;
4. different binding facets can commit in either order;
5. identical Request ID retry returns the original receipt after simulated response loss;
6. current projection, arbitrary Revision reconstruction, Event hash verification, and projection rebuild agree;
7. snapshot creation/restart/corrupt-snapshot fallback work;
8. branch at early/middle/head Revisions is self-contained and parent remains unchanged;
9. branch-and-bind is atomic and copies no chat-specific state by default;
10. copied/renamed locator collision never resolves automatically;
11. Record Archive/Restore/Delete keeps older Revision reconstruction and enforces blockers;
12. Campaign Archive/Restore and pre-backed-up Purge obey their gates;
13. reconnect subscriptions replay one transaction as one invalidation and Store Epoch reset forces refetch;
14. process restart, migration backup, daily backup, restore, WAL interruption, and injected corruption have defined outcomes;
15. 10,000 current subjects and representative history meet or revise #16 latency/event-loop budgets with measured evidence.

No HTTP route, React view, LM Studio call, addon watcher, or SillyTavern dependency belongs in this prototype. #18 tests Campaign Engine and Campaign Journal directly.

## Rejected shortcuts

- One revision counter for Campaign and Chat Binding state: unrelated conflicts and misleading Campaign history.
- Automatic Campaign Anchor advancement on reads or narration: hides divergence and creates Event spam.
- Locator-only binding lookup: silently links imported/copied chats.
- Browser/device ID as binding identity: breaks legitimate multi-device use of one chat.
- Event replay through old validators or Operation handlers: schema evolution can reinterpret history.
- Temporal version table for every subject/reference as v1 authority: migration and schema cost outweigh direct historical-query speed.
- Full Campaign snapshot at every Revision: extreme write and storage amplification.
- Current tables without replayable history: cannot prove arbitrary reconstruction or safe branch behavior.
- Copy-on-write branches depending on parent storage: purge and recovery can break children.
- Silent non-overlapping stale-write merge: Campaign-wide expected revision remains the explicit v1 rule.
- Cascading Record Delete: breaks references and user trust.
- Treating Record Delete as historical erasure: contradicts immutable Events and arbitrary Revision reads.
- Broadcasting Event payloads as client state: creates a second browser authority.
- In-memory-only subscriptions: lose changes across restart or reconnect races.
- Pruning history because snapshots exist: snapshots accelerate history; they do not replace it.

## Downstream decisions unblocked

- #18 proved the persistence/recovery semantics and recorded its measured constraints in `docs/research/campaign-persistence-prototype.md`.
- #19 can define wire headers and bridge behavior around canonical Binding ID, Chat Locator, collision token, and Campaign Anchor Problems.
- #21 can read one verified Campaign Revision plus one verified Binding Revision/facet vector for Context planning.
- #23 can turn structured conflict/collision/lifecycle Problems into guided Workspace sheets without moving authority into React.
- #24 can store Proposals/jobs against a Binding Revision, Sync Boundary fingerprint, Campaign Anchor, and Request ID without receiving Campaign mutation capability.
- #25 can design backup/restore/purge/cutover around Store Epoch, immutable history, self-contained branches, and pre-maintenance backups.
