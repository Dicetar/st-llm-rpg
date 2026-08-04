# Campaign persistence and recovery prototype

Research date: 2026-08-05

GitHub issue: #18

## Question

Does the Campaign authority model selected in #17 preserve accepted-event atomicity, arbitrary Revision reconstruction, self-contained branching, multi-tab conflict safety, restart, migrations, daily and pre-maintenance backups, restore, and corruption handling on the actual Windows/Node stack?

## Verdict

**Go with constraints.** The selected semantic model and the local SQLite stack are viable. Keep:

- Node 24 `node:sqlite` behind Campaign Engine and Campaign Journal;
- one SQLite owner, WAL, `synchronous=FULL`, foreign keys, and `BEGIN IMMEDIATE` writes;
- separate Campaign and Chat Binding Event histories;
- immutable Campaign Bases and Events plus rebuildable current projections;
- stable Request IDs, expected Campaign Revisions, Binding facet revisions, and durable change cursors;
- online validated backups, a Store Epoch rotated on restore, and archive-first deletion/purge gates.

Do not put the synchronous persistence adapter on the companion's HTTP/proxy event loop without completing the worker-thread review triggered by these measurements. Normal operations were short, but representative bulk import, verified reconstruction, and self-contained branching exceeded the 50 ms review threshold from #16.

The prototype remains disposable evidence, not production code. Run it with:

```powershell
npm run prototype:persistence
```

The successful run creates real temporary SQLite files, prints 19 evidence stages, and removes them. A failed run preserves its scratch directory. `npm run prototype:persistence -- --interactive` opens the optional throwaway terminal state viewer.

## Environment

| Component | Observed value |
|---|---:|
| Windows project environment | `D:\Projects\st-llm-rpg` |
| Node | 24.15.0 |
| bundled SQLite | 3.51.3 |
| journal mode | WAL |
| synchronous | FULL (`2`) |
| integrity checks | `quick_check=ok`; no foreign-key violations |

The spike uses only Node built-ins. It does not exercise Fastify, HTTP, SillyTavern, LM Studio, React, retrieval, or addon files.

## What passed

### Accepted history and concurrency

- Blank Campaign Revision 1, Campaign Event 1, Chat Binding Revision 1, and Binding Event 1 were created in one accepted commit.
- A Campaign edit and explicit originating-binding Anchor advance committed as one transaction but advanced their separate histories.
- A pin update and Sync Boundary update committed in either order because they checked different Binding facets.
- A stale same-facet Binding edit returned `binding_revision_conflict` with no state change.
- A stale Campaign edit returned `campaign_revision_conflict` with no Event, projection, or accepted-commit residue.
- Retrying an identical Request ID returned its original outcome and cursor without duplicating history. A Request ID is content-bound.
- A thrown infrastructure failure after Event insertion rolled back projection, Event, change scope, receipt, and accepted commit.
- A separately owned SQLite connection was terminated after writes inside `BEGIN IMMEDIATE` but before `COMMIT`. Reopen retained byte-consistent accepted state and clean integrity checks; none of the uncommitted rows appeared.

### Chat Binding behavior

- Campaign truth advanced without silently advancing the chat's Campaign Anchor.
- Reading the linked chat then returned a visible `mismatch` with Anchor and head Revisions.
- An explicit `follow-campaign-head` Binding Operation resolved the mismatch.
- Presenting the same Binding ID from a different mutable chat locator returned `collision`; the prototype never guessed rename versus copy.
- Campaign/Binding changes committed together appeared as one ordered invalidation with two scopes.
- Restart preserved Binding state, all four facet counters, Event history, and Store Epoch.

### Reconstruction, snapshots, branches, and lifecycle

- Revisions 1 through 6 reconstructed exactly from the Base, before/after Event images, and snapshots without rerunning mutation handlers.
- A damaged snapshot was rejected and the target Revision rebuilt from verified earlier history.
- A damaged older Event was detected even when a later valid snapshot existed.
- A corrupted current projection disagreed with verified history, then rebuilt successfully after a validated pre-repair backup.
- Branching Revision 2 produced an independent child Campaign at Revision 1 with lineage bound to the source Event hash. Parent and child then mutated independently.
- Branch-and-bind committed one child Campaign Event and one new Binding Event atomically and copied no pins or Sync Boundary.
- Delete required prior Archive and failed while a current reference remained. One batch removed the reference and Record in one Revision; older Revisions still reconstructed the Record and its stable ID could not be reused.
- Purge required an archived Campaign, exact final Revision and Event hash, and a validated pre-purge backup. A minimal purge receipt made later reads fail as `campaign_purged` rather than `not_found`.

### Migrations, backups, restore, and corruption

- Fresh migration v1 and successful v2 installation updated both immutable migration ledger and `user_version`.
- Every pending migration created a validated online backup first.
- An injected v3 failure after DDL rolled back the table and left schema v2 current.
- Changing the source of an applied migration returned `migration_checksum_mismatch`.
- A pre-import backup captured the exact earlier authority state; import then committed as one accepted batch.
- Daily backup creation coalesced a second request inside 24 hours and produced a new validated file after 25 hours.
- Restore validated a staged copy, replaced the database, preserved the replaced file for rollback, recovered exact pre-import state, and rotated Store Epoch.
- A subscriber cursor from before restore received `resetRequired` rather than replaying against a different database timeline.
- A deliberately corrupted restore candidate was rejected before swap and left the known-good database byte-identical.
- A deliberately modified Event envelope caused `history_corrupt`; the engine did not return a guessed state.

## The snapshot flaw the prototype found

The first trace exposed a real flaw in the provisional reconstruction algorithm. It validated a snapshot's state hash and terminating Event hash, then began replay after the snapshot. Modifying an older Event's operation body therefore escaped detection when reconstruction started from a later snapshot.

The corrected rule is:

1. a snapshot is a state-materialization accelerator, never a trust root;
2. before accepting snapshot state, verify the complete Event hash-chain prefix from the Campaign Base through the snapshot's terminating Event;
3. reject a bad snapshot and replay from an earlier valid snapshot/Base;
4. fail the Campaign closed if the authoritative Base or any Event in the required prefix is corrupt.

This preserves the immutability guarantee but changes the performance interpretation: snapshots bound state application and JSON materialization; they do not by themselves bound integrity-verification work. Production may cache a verified-prefix marker only while the same open database generation remains known-good, and maintenance should scrub full history. Such a cache must never survive restore or substitute for validation after suspected corruption.

## Scale result

The final successful trace used one Campaign containing 10,000 representative Items, NPCs, Spells, Quests, and Facts. Times are single local observations, not statistical service-level guarantees.

| Operation | Observed time |
|---|---:|
| Import 10,000 Records as one accepted batch/Event | 1,243.2 ms |
| Read page of 50 around offset 4,950 | 6.4 ms |
| Edit one existing Record | 2.0 ms |
| Create full snapshot | 284.3 ms |
| Reconstruct/verify snapshot Revision | 188.4 ms |
| Create self-contained 10,000-Record branch | 398.1 ms |

The snapshot was 2,096,620 bytes. The scale database after import, edit, snapshot, and branch was 19,169,280 bytes (about 18.3 MiB).

These results support normalized current projections for ordinary reads and writes. They also trigger #16's explicit worker-thread review:

- page and single-Record edit are comfortably below 50 ms;
- snapshot, verified historical read, large branch, and large import block a synchronous caller too long;
- changing from `node:sqlite` to another synchronous binding would not remove event-loop blocking;
- production should keep one logical SQLite owner but place Campaign Journal work behind an asynchronous worker-thread boundary, or prove an equivalent scheduling design in #26;
- large import, restore, projection rebuild, Purge, and branch should be visible maintenance/jobs with progress and cancellation only before their final short commit phase;
- do not split one accepted import across hidden Campaign Revisions merely to make the event loop look faster.

The 100-Revision snapshot cadence from #17 remains provisional. This spike measured change volume and 10,000 current subjects, not a representative 100-Event long campaign. Final cadence needs a history-shape benchmark through the same Adapter before #26 locks it.

## Production constraints carried forward

1. Only the companion's Campaign Journal opens the canonical database; browsers and SillyTavern never do.
2. Database lives on a local fixed disk, not SMB, VPN-mounted, or cloud-synchronized storage.
3. All accepted mutations use a stable Request ID and expected Campaign/Binding revisions.
4. Transactions contain no HTTP, model, filesystem-watcher, or user wait.
5. Every maintenance mutation creates and validates the required backup before changing authority.
6. Current projections and snapshots are replaceable; Campaign Base, Events, migration ledger, Request receipts, and purge receipts are not.
7. Restore is an exclusive maintenance operation that rotates Store Epoch and makes every client refetch.
8. Event payload and accepted batch sizes need explicit limits; the 10,000-Record batch is recovery/scale evidence, not a normal UI request.
9. Historical reads and branch creation must expose progress if they cross the interactive budget.
10. Better-sqlite3 remains a fallback for API/runtime defects, not a response to synchronous event-loop cost.

## Not proved here

- HTTP request/response and SSE behavior;
- real simultaneous OS processes competing for the file (production deliberately forbids multiple owners);
- proxy streaming while persistence work runs;
- worker-thread message contracts and shutdown handoff;
- hundreds or thousands of small Campaign Events and final snapshot cadence;
- storage growth over a real long-running campaign;
- disk-full, antivirus lock, permission loss, or power-cut hardware fault injection;
- actual backup retention/rotation policy;
- real-phone Workspace recovery UX.

Those are downstream bridge, final-architecture, migration, and Workspace obligations rather than reasons to reject the selected authority model.

## Artifacts

- [`prototypes/campaign-authority-sqlite-spike/authority-spike.mjs`](../../prototypes/campaign-authority-sqlite-spike/authority-spike.mjs) contains the disposable authority/persistence core.
- [`prototypes/campaign-authority-sqlite-spike/run.mjs`](../../prototypes/campaign-authority-sqlite-spike/run.mjs) contains the one-command evidence trace and optional TUI.
- [`docs/design/campaign-authority-history-and-bindings.md`](../design/campaign-authority-history-and-bindings.md) records the selected semantics and the snapshot-integrity correction.
