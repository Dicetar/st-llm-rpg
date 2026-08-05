# Migration, launcher, updates, and cutover

Status: accepted provisionally and logic-proven by Wayfinder #25. Production process control, online backup integration, browser marker writes, and the complete real-campaign/device cutover remain implementation and acceptance work for the tracer tickets.

## Decision

The companion is introduced through a **parallel, previewed, reversible cutover**. Nothing converts a SillyTavern chat in place.

- A legacy Campaign is read from the selected chat's verified `chat_metadata.stLlmRpgCampaign` envelope and previewed before any SQLite write.
- Acceptance creates a self-contained SQLite Campaign at Campaign Revision 1 with `legacy_import` provenance plus one explicit Chat Binding at Binding Revision 1.
- The original legacy metadata is never removed or rewritten by migration.
- The new Binding is not usable for linked narration until the thin bridge writes its binding marker to SillyTavern metadata and verifies server readback.
- Exact re-import is idempotent. The same Campaign content presented from another Chat Locator is treated as a copied source and requires an explicit choice.
- External JSON changes are reconciled into a persisted diff and applied only as one accepted Campaign batch after a validated backup.
- One visible Windows supervisor owns project-local SillyTavern and the companion, observes but does not own LM Studio, and stops only processes whose ownership identity still matches.
- Compatibility updates are staged beside the active runtime, tested, switched atomically, and rolled back on failed smoke checks.
- The fallback extension and untouched legacy metadata remain available until the complete real-campaign cutover trace passes. Fallback never deletes or rewinds companion data.

This decision preserves the fallback's useful failure evidence while replacing chat metadata as authority. It also makes a critical limitation explicit: after the user has accepted new companion-only Campaign Events, returning to the fallback resumes from the older legacy metadata. The launcher must export and back up current companion truth before fallback and label continued fallback play as a divergent branch. There is no silent downgrade or reverse migration.

## Locked runtime topology

```text
SillyTavern     0.0.0.0:8001   project-owned, pinned runtime
Companion       0.0.0.0:8002   project-owned Node process
LM Studio       127.0.0.1:1234 user-owned GUI/server
SQLite          host-local fixed disk; never opened by browser clients
Workspace       served by Companion at :8002
```

SillyTavern and Companion are required for normal companion mode. LM Studio is an optional runtime dependency for startup: when it is absent, Workspace, Campaign reads/edits, imports, backups, and review remain available, while Narration and worker inference are visibly unavailable.

The trusted LAN/VPN risk acceptance remains unchanged. The launcher may print LAN and VPN URLs and may offer an explicit firewall helper, but it must never describe the services as safe for public internet exposure.

## One visible launcher

The production command surface is one root entry point:

```text
Wayfinder.cmd                 equivalent to `Wayfinder.cmd start`
Wayfinder.cmd start
Wayfinder.cmd status
Wayfinder.cmd stop
Wayfinder.cmd fallback
Wayfinder.cmd companion
Wayfinder.cmd update-compatibility
Wayfinder.cmd backup
Wayfinder.cmd restore <backup>
```

`Wayfinder.cmd` delegates to `tools/wayfinder.ps1` using `%~dp0`; the PowerShell script derives all paths from `$PSScriptRoot`. Commands therefore work from a path containing spaces and from a non-project working directory.

The console remains visible by default. A tray app, Windows service, Single Executable Application, and hidden background startup are deferred. An optional Task Scheduler `ONLOGON` wrapper may be added only after the same visible launcher is stable and remains the diagnostic path.

### Start algorithm

1. Acquire a short-lived supervisor lock under `.runtime/wayfinder/`.
2. Read `compatibility.lock.json` and verify Node version, companion schema support, bridge protocol, and pinned SillyTavern commit.
3. Inspect ports 8001, 8002, and 1234 before starting anything.
4. Identify an existing service by health response plus executable path/command identity, never by port or PID alone.
5. Block if 8001 or 8002 is owned by another process. Print PID, image, command line when available, and one corrective action.
6. Treat an absent or unhealthy 1234 as degraded rather than fatal.
7. Start project-local SillyTavern and Companion only when absent. Record PID, process creation time, executable path, normalized command hash, runtime identity, and launcher run ID.
8. Wait for owned readiness endpoints. Do not infer readiness from an open port.
9. Open the Workspace after SillyTavern and Companion are ready. Print the local, LAN, and known VPN URLs.
10. Continue supervising child exit. A child crash is reported and never silently restarted in a loop during v1.

A stale PID file is diagnostic debris, not ownership evidence. It is ignored after the live process identity check and replaced only when the launcher starts a new child.

### Stop algorithm

`Wayfinder.cmd stop` stops only children recorded by this supervisor whose live PID, creation time, executable, and command hash still match. PID reuse or changed identity causes a refusal with a manual diagnostic. User-owned LM Studio is never stopped.

Clean shutdown first asks Companion to enter draining mode, rejects new mutations/model jobs, cancels queued workers, waits for active accepted SQLite transactions to finish, checkpoints as designed, closes the database, then stops owned SillyTavern. A timeout escalates only for the exact still-owned child.

## Health contract

Companion exposes three separate views:

- `/health/live`: process event loop is responding; no dependency claim.
- `/health/ready`: schema is supported, integrity/startup checks passed, no exclusive maintenance operation is active, and owned HTTP routes can serve.
- `/health/dependencies`: SillyTavern compatibility, LM Studio reachability/model readiness, addon watcher state, backup state, and job lane state.

`/version` reports companion build, bridge protocol, database schema range, Node version, and reviewed SillyTavern pin.

Health states:

- **ready** — Workspace and model work are available;
- **degraded** — Workspace/Campaign are available but LM Studio or a non-authoritative subsystem is unavailable;
- **maintenance** — restore/migration/switch is exclusive; reads may be limited and mutations are blocked;
- **unavailable** — database, schema, integrity, bridge compatibility, or required service is not ready.

No health endpoint mutates state or advances a Campaign Anchor, Binding state, Sync Boundary, or job.

## Legacy metadata import

### Source of truth

The migration source is the server-readback value at:

```text
chat_metadata.stLlmRpgCampaign
```

The in-memory `chatMetadata` object is not sufficient. The retained read-only legacy helper uses the current selected character chat and `/api/chats/get`, then verifies that the browser envelope and server envelope identify the same legacy commit before preview.

V1 imports one selected legacy chat at a time. It does not crawl every SillyTavern chat directory, infer Campaign ownership from names, or parse chat files directly from disk.

### Handoff journey

1. Start in fallback or parallel mode and open the legacy character chat.
2. Choose **Move this Campaign to Companion**.
3. The bridge verifies the current chat, server-reads `stLlmRpgCampaign`, creates a Chat Locator and source fingerprint, and submits the envelope to the companion.
4. Workspace opens a migration preview showing legacy revision/commit provenance, Campaign counts, current Scene, archives, invalid/unsupported fields, and proposed Chat Binding.
5. The user chooses **Create Campaign**, **Link existing imported Campaign**, **Create independent import**, or **Cancel**, depending on duplicate evidence.
6. Before acceptance, the companion creates and validates a pre-import database backup.
7. One SQLite transaction creates the self-contained `legacy_import` Campaign Base, Campaign Revision/Event 1, Chat Binding Revision/Event 1, import receipt, and invalidation.
8. The bridge writes the returned Binding ID marker to SillyTavern metadata and verifies server readback.
9. Until marker verification succeeds, the Campaign remains imported but linked generation is blocked with **Retry chat link marker**.
10. The legacy `stLlmRpgCampaign` value remains untouched.

### Revision and provenance rules

Legacy revision numbers are provenance, not companion Campaign Revisions. A legacy Campaign at revision 137 becomes companion Campaign Revision 1. Its Campaign Base contains the validated imported head and records:

```ts
type LegacyImportProvenance = {
  legacyFormat: string;
  legacyCommitId: string;
  legacyRevision: number;
  sourceFingerprint: string;
  contentFingerprint: string;
  chatLocatorAtImport: ChatLocatorV1;
  importedAt: string;
};
```

The companion does not invent 136 prior Campaign Events. One `campaign-imported-from-legacy-metadata` Event records the accepted import summary.

### Duplicate and copied-source behavior

- Same source fingerprint already imported: return the existing Campaign/Binding; create nothing.
- Same content fingerprint and same locator: idempotent existing import.
- Same content fingerprint from another locator: copied source; require **Link existing**, **Create independent import**, or **Cancel**.
- Changed legacy envelope after preview: reject as stale and preview again.
- Unknown or invalid references: show blockers; do not partially import.
- Unsupported legacy fields: show explicit warnings and preserve them only in a bounded migration attachment when the spec marks them recoverable. Never silently discard or reinterpret data.

## Full Campaign JSON import/export

A full companion Campaign export is a portable, schema-versioned JSON document containing canonical Campaign state, lineage/provenance, and optionally accepted history according to the export mode. It is not a live authority and does not include hidden drafts, model reasoning, active jobs, volatile diagnostics, or secrets.

Importing a full Campaign JSON file always previews and creates a new self-contained Campaign at Revision 1 unless a future explicit restore operation is selected. It never overwrites an existing Campaign by ID. Duplicate fingerprints offer open-existing or explicit independent import.

Restore uses validated SQLite backups, not Campaign JSON. JSON is for exchange and reconstruction into new authority; SQLite backup/restore is for exact operational recovery.

## JSON addon reconciliation

The companion watches the repository's existing `campaign-content/` directory by default. Additional local fixed-disk directories may be configured later. Files ending in `_example.json` remain documentation only.

Watcher events are hints. The reconciler:

1. watches the directory, not individual files;
2. debounces bursts;
3. performs a complete sorted rescan;
4. reads each candidate only when size and modification time remain stable across the read;
5. hashes canonical content and persists a source manifest;
6. parses and validates every recognized file;
7. records malformed/unreadable files as visible source Problems;
8. builds one campaign-scoped Import Candidate from the complete manifest;
9. provides a manual **Rescan** and periodic convergence pass.

Temporary-file rename saves, missing watcher filenames, deletion/recreation, and companion restart therefore converge through the same full scan.

### Diff and apply

The Import page shows:

- creates;
- updates with before/after fields;
- unchanged entries;
- warnings and rejected rows;
- source files and hashes;
- reference impact;
- expected Campaign Revision;
- explicit statement that missing addon rows do not delete Campaign subjects.

Stable External IDs are additive upsert keys. Removing a row or file does not archive or delete accepted Campaign state. Destructive lifecycle remains an explicit Campaign Operation in the normal editor.

Acceptance requires the exact manifest hash and Campaign Revision from preview. Before apply, create and validate a pre-import backup. One accepted atomic Campaign batch applies all valid creates/updates and creates one Campaign Revision/Event. Any stale source, stale Campaign, validation, reference, backup, or storage failure applies nothing.

Watcher reconciliation and parsing never mutate Campaign truth.

## Database migrations, backups, and restore

### Startup migrations

Before HTTP readiness:

1. identify the database using `application_id`;
2. verify migration checksums and supported schema range;
3. create a validated online pre-migration backup when migrations are pending;
4. apply ordered migrations with `BEGIN IMMEDIATE` and ledger entries;
5. run `quick_check`, foreign-key checks, head/Event continuity, and required projection checks;
6. rotate Store Epoch after restore or authority replacement;
7. enter unavailable/maintenance state rather than guessing after failure.

A failed migration leaves the old valid database or restores the validated pre-migration backup. Readiness remains false until verification succeeds.

### Backup classes and retention

V1 creates validated SQLite backups for:

- daily startup/timer backup;
- before schema migration;
- before legacy or full-JSON import;
- before accepted addon import;
- before restore;
- before Campaign purge;
- before compatibility runtime switch when schema support may change;
- explicit user request.

Retention is deterministic:

- daily backups: latest 14 plus the newest backup from each of the previous 8 calendar weeks;
- pre-operation backups: latest 20 and every backup younger than 30 days;
- explicit user-labelled backups: never automatically removed;
- the database displaced by restore: retain at least 7 days and until the user completes or rolls back the restore.

Automatic cleanup never deletes the newest validated backup, the only backup compatible with the current schema, or a file involved in an unresolved restore/update. Cleanup reports deletions in System. Low-disk conditions warn and block operations that require a backup if a new validated backup cannot be completed.

Backups use SQLite online backup into a unique `.partial` file, validate application/schema/integrity, then atomically rename. Copying a live main database file is forbidden.

### Restore

Restore is exclusive maintenance:

1. block new mutations and model work;
2. wait for current accepted transaction completion;
3. create a validated backup of the current database;
4. close the authority connection;
5. install the selected validated backup;
6. open and verify it;
7. rotate Store Epoch and invalidate all client cursors;
8. resume only after checks pass.

If verification fails, reinstall the displaced database and remain in maintenance with diagnostics. Open browser drafts survive only as non-canonical local recovery material and must refetch authority before any subsequent acceptance.

## Compatibility updates

Project source updates remain user-controlled Git operations. The launcher does not run `git pull`, reset, or stash. `Wayfinder.cmd update-compatibility` updates generated/runtime dependencies to the versions already reviewed by the checked-out project.

A versioned `compatibility.lock.json` records:

- supported Node range and preferred exact runtime;
- pinned SillyTavern commit;
- bridge protocol version;
- companion HTTP/API version;
- supported database schema range;
- required extension build/install version;
- compatibility test command set.

Update algorithm:

1. require a clean project tree or stop with commit/stash instructions;
2. create validated database and current-runtime backups;
3. build `.runtime/SillyTavern.next` at the exact reviewed pin;
4. install dependencies and the thin bridge into the staged runtime;
5. run fallback tests, bridge contract tests, companion tests, migration dry-run, and startup smoke checks against unused ports;
6. stop only the currently owned SillyTavern process;
7. atomically switch the active runtime directory, retaining `.previous`;
8. start the new runtime and verify version, bridge protocol, health, and one unlinked smoke request;
9. on failure, stop the new owned process, restore `.previous`, restart it, and keep logs/backups.

The current runtime is never updated in place. A failed pre-switch check leaves it untouched. A failed post-switch check rolls it back automatically.

## Companion and fallback modes

### Parallel mode

Parallel mode is the default migration period:

- legacy metadata remains canonical for fallback use;
- companion imports are independent copies under test;
- no source is silently synchronized in either direction;
- the user may repeat migration for another chat;
- a cutover journal records completed real-campaign checks.

### Companion mode

Companion mode installs/enables the thin bridge and uses the companion proxy for linked chats. The fallback extension source and legacy metadata remain retained but are not the active Campaign authority.

### Fallback command

`Wayfinder.cmd fallback`:

1. creates a validated companion database backup and full Campaign export when the companion is reachable;
2. writes a divergence report containing Campaign Revision, Binding state, export/backup paths, and the legacy import provenance revision;
3. stops only the owned Companion process;
4. switches the project-local SillyTavern extension slot from thin bridge to the tested fallback extension;
5. starts/detects SillyTavern at 8001 and reports LM Studio Direct profile requirements;
6. opens the fallback Workspace/chat.

It never deletes SQLite, companion exports, jobs, backups, or legacy metadata. If backup/export cannot be completed, fallback requires an explicit emergency override and prints the risk.

Fallback resumes from the retained legacy metadata, which may be older than companion Campaign truth. The UI and launcher must say this before the user continues play. Continuing in fallback creates a divergent history. Returning later requires explicit re-import as a new Campaign/branch or a reviewed manual merge; no automatic bidirectional reconciliation exists.

`Wayfinder.cmd companion` reverses only the runtime/extension slot, starts the companion, and requires the chat's accepted Binding marker. It does not auto-merge changes made during fallback.

## Real-campaign cutover trace

The fallback cannot be retired until one real Campaign completes this trace on the target Windows machine and actual phone:

1. create and validate a database backup;
2. server-read the selected legacy metadata and preview all counts/warnings;
3. accept import into Campaign Revision 1 and Chat Binding Revision 1;
4. write/read back the Chat Binding marker;
5. compare representative Records, live entries, Current Scene, Scene Archives, Story Sync state, and addon External IDs against the fallback;
6. edit and accept one Campaign Operation from desktop;
7. provoke and recover one stale-tab conflict;
8. restart SillyTavern and Companion; verify Campaign/Binding persistence;
9. exercise Campaign Book on the actual phone, with Command Deck status cards and normal Collection → Record mobile routes;
10. apply one addon diff after backup and restart;
11. prove unlinked direct behavior and linked send, regenerate, continue, swipe, and stop through the proxy;
12. prove linked Campaign outage fails closed without chat corruption;
13. run one Story Sync job, preempt it with narration, resume, review every Proposal, and atomically advance the Sync Boundary;
14. run backup, restore, Store Epoch reset, and client refetch;
15. execute `Wayfinder.cmd fallback`, verify the old Campaign opens, and confirm companion backup/export remain;
16. return to companion mode without mutation loss;
17. record ports, versions, model IDs, phone viewport/path, timings, logs, and all deviations.

Only after the complete trace passes may the fallback extension cease to be the default emergency path. Its source and migration fixtures remain until the implementation spec explicitly removes them.

## Prototype evidence

`prototypes/migration-cutover-spike/` demonstrates with real temporary SQLite/files:

- revision-1 legacy import and preserved metadata;
- exact re-import and copied-source decisions;
- stale preview rejection;
- addon full-directory convergence and malformed-file recovery;
- additive diff/apply, pre-import backup ordering, one revision/event, and no deletion from missing rows;
- supervisor start/degraded/block decisions and stop-only-owned identity checks;
- staged compatibility switching and post-switch rollback;
- a persisted cutover checklist and fallback preserving both authorities.

The spike intentionally does not start real processes or claim live ST/LM Studio compatibility. Those remain #20, #22, and implementation acceptance evidence.

## Rejected alternatives

### In-place conversion of chat metadata

Rejected because failure would destroy the only working fallback and because chat metadata cannot provide SQLite history, backups, subscriptions, or cross-chat Campaign ownership.

### Automatic deletion of legacy metadata after import

Rejected. It removes rollback evidence without improving companion authority.

### Direct filesystem crawling of SillyTavern chats

Rejected for v1. It couples migration to private storage layout and encourages identity inference. The selected-chat bridge path provides explicit user intent and server verification.

### Watcher events directly applying addon changes

Rejected. Filesystem events are lossy and model-independent external text is still not authority until previewed and accepted.

### Launcher owning LM Studio

Rejected. LM Studio is a user GUI/process with model state and updates outside this project. The launcher observes health and gives an actionable warning.

### Hidden service or auto-restart loop

Rejected for the first implementation because it hides migration, port, schema, and model failures. Visible deterministic startup is more valuable than unattended availability.

### Updating the active SillyTavern directory in place

Rejected because partial installs and failed compatibility tests make rollback unreliable.

### Automatic reverse migration on fallback

Rejected. Mapping later immutable Campaign Events back into the legacy monolithic envelope would invent a second authority and cannot safely preserve all new semantics.

## Remaining implementation gates

- Real bridge implementation for server-read legacy metadata and binding-marker readback.
- Actual online-backup/restore integration with the Campaign Journal worker boundary chosen by #26.
- PowerShell supervisor process ownership and paths-with-spaces tests on Windows.
- Live staged SillyTavern runtime switch and rollback.
- Real `fs.watch` burst/rename/replacement tests on Windows.
- Complete #20 proxy trace, #22 target-model trace, and final real-device cutover.
