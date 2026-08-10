# Wayfinder playable preview

Version `0.3.0-preview.15` is a daily-use preview of the campaign-independent companion. It is deliberately not the final cutover: the working fallback remains preserved. The real pinned-SillyTavern desktop browser/chat-history narration trace passes. The product owner deferred the additional physical-phone rerun rather than blocking feature work; that rerun is not represented as passed.

## Start

1. Start LM Studio and expose the narrator model through its OpenAI-compatible server on port `1234`.
2. Double-click `Wayfinder.cmd` in the project root.
3. Keep the visible Wayfinder console open when it started SillyTavern. Open SillyTavern at `http://localhost:8001` and Campaign Book at `http://localhost:8002`.
4. On another LAN/VPN device, use the PC address with the same ports, for example `http://10.8.1.2:8001` and `http://10.8.1.2:8002`.

The launcher builds stale or missing production assets, refreshes the production bridge, starts only missing owned processes, waits for Campaign readiness, and refuses unknown port owners. LM Studio absence is non-blocking: editing still works, while the status panel explains why narration cannot run.

Run `Wayfinder.cmd status` for a read-only stack report. `Wayfinder.cmd stop` drains only the identity-matched Companion/SillyTavern processes recorded by this supervisor; unknown port owners and LM Studio are never stopped. `Wayfinder.cmd backup [label]` creates a verified backup. `Wayfinder.cmd restore [backup-id]` previews and confirms exact recovery. `Wayfinder.cmd update-compatibility` backs up Campaign truth, stages the reviewed ST pin beside the active runtime, and smoke-checks it before any switch. Run `npm run smoke:playable` for the release check covering pinned ST, the compatibility lock, companion, Workspace, SQLite, model profiles, installed bridge, fallback presence, and retired prototypes.

## Play path

Create or open a Campaign, then make its chat link explicit:

1. In Campaign Book, select the Campaign. Expand **Linked SillyTavern chats**, choose a saved chat without fallback Campaign metadata, and press **Link chat**. SQLite accepts one Binding Event first; the companion then writes and reads back only the small SillyTavern Binding marker. Chats with fallback RPG data stay in the separate reviewed import path.
2. Edit Actors, Items, Abilities, directed Relationships, Quests, Places, and the Current Scene. An Ability page keeps its reusable definition and every Actor's learned/prepared/enabled/use state together. An Actor page creates and edits incoming or outgoing Relationships in the same block. Each accepted edit advances immutable Campaign history; stale tabs cannot overwrite a newer revision.
3. Open Context Tray. If this chat is behind Campaign head after an edit, narration stays blocked until you explicitly choose **Follow current Campaign**; the choice advances only that chat's Campaign Anchor and creates a Binding Event. Confirm the exact narrator model profile, automatic budget, and any manual pins. Use **Build Context Plan** for an inspectable dry run with no model call.
4. In SillyTavern, select the same exact model ID as the saved narrator profile and chat normally. The bridge routes linked generations through one deterministic Context Plan and one LM Studio call. The complete answer is withheld until accepted, so Stop cannot leave partial companion text.
5. Open **Narration status** in Campaign Book when a reply fails. It shows active requests and only the latest outcome, elapsed time, a safe error message, and concrete recovery guidance. It never stores prompts, generated prose, or request history and resets when the Companion restarts.
6. Open **Review Inbox** and save the separate Campaign Worker model ID. In a linked SillyTavern chat, choose **Sync Story** from the extensions menu. The Companion analyzes only the bounded unseen range and opens editable, evidence-linked proposals. Accept or reject every Proposal, then choose **Finalize review**. Accepted changes become one Campaign revision and the same SQLite transaction advances only that chat's Sync Boundary.
7. Use **Stop analysis** when a worker must yield. Resume/retry rechecks the Campaign head, Binding, and Sync Boundary before using retained source. **Discard review** removes unresolved source/proposals and changes neither Campaign truth nor the Sync Boundary.
8. Open **Backups and Restore** in Campaign Book. Today’s verified daily backup appears automatically. Create labelled backups before risky edits; **Preview restore** verifies file identity, hash, and Campaign history before the destructive restore action becomes available. Restore creates another verified safety backup first.
9. To bulk-author outside the browser, edit `campaign-content/*.json`, open **JSON addon inbox**, choose the target Campaign, and preview. Apply is enabled only for a blocker-free exact manifest diff; it creates a verified pre-import backup and one Campaign revision.

An existing fallback chat can be imported through **Import a fallback chat**. Import is previewed, backed up, and explicit; legacy metadata stays intact. A fresh saved chat is linked directly inside the selected Campaign's **Linked SillyTavern chats** block. Linking is never automatic.

## What is usable now

- campaign-independent SQLite authority and immutable revisions;
- create, edit, and archive Actors, Items, Abilities, directed Relationships, Quests, and Places;
- add/remove an Ability for an Actor in the same Ability editor, including prepared/enabled state and optional remaining/maximum uses;
- editable Current Scene and read-only historical revisions;
- explicit legacy import and verified Chat Binding marker;
- explicit fresh-chat linking for blank or existing Campaigns, with collision checks and marker readback;
- visible Binding mismatch detection and explicit per-chat **Follow current Campaign** without automatic anchor movement;
- deterministic exact, Scene, FTS, and relation Context planning with ordered manual pins;
- exact narrator model profiles and token budgets;
- linked normal, regenerate, continue, swipe, and Stop proxy behavior at the server seam;
- content-free Narration status for the current request and latest outcome, with concrete recovery guidance;
- durable bounded Story Sync jobs, a separate Campaign Worker profile, structured editable proposals for Actors, Items, Abilities, Relationships, Quests, Places, and Current Scene, atomic human-only finalization, and explicit stop/resume/discard recovery;
- explicit-unlinked pass-through, including when Campaign SQLite is unavailable;
- separate desktop/mobile Campaign Book page;
- working SillyTavern fallback kept alongside the production bridge.
- verified daily and labelled SQLite backups, deterministic retention, restore preview, safety backup, and verified activation;
- watched JSON addon directory, manual convergence scan, restart-resumable manifest-bound diff, explicit backed-up atomic apply, and additive no-delete behavior;
- visible start/status/stop/companion/backup/restore commands, identity-bound process ownership, graceful Companion drain, and unknown-owner refusal;
- reviewed compatibility lock, verified pre-update backup, staged dependency/extension checks, isolated startup, preserved previous runtime, and automatic post-switch rollback;
- explicit fallback/companion authority modes with verified pre-fallback backup, complete current/history/Binding JSON export, divergence report, verified-Binding admission, and preserved inactive extension copies;

## Recovery and fallback

- If startup fails, read the named component and PID in the Wayfinder console. The launcher never kills an unknown owner.
- Companion logs are under `.runtime/wayfinder/logs/`.
- Campaign truth is `.runtime/companion/campaigns.sqlite`; verified backup files and manifests are under `.runtime/companion/backups/`. Prefer Campaign Book controls over moving these files manually.
- If Campaign authority is unavailable, linked chats fail closed and never silently narrate without Campaign context. Explicit-unlinked chats remain usable while the companion host and LM Studio are healthy.
- Run `Wayfinder.cmd fallback`, read the divergence warning, and type `FALLBACK`. Wayfinder verifies a backup and export before it disables the bridge and stops only its own Companion process. Refresh SillyTavern, select a direct LM Studio endpoint such as `http://127.0.0.1:1234/v1`, then open the gold **R** workspace. After making companion-only edits, fallback and SQLite histories are divergent; there is no silent reverse synchronization.
- Run `Wayfinder.cmd companion` to restore the thin bridge and Companion stack. At least one verified Chat Binding is required. Changes made while using fallback are not imported or merged automatically.

## Preview limits

- The additional physical Android production-bridge rerun was explicitly deferred; do not infer that it passed. Sanitized desktop evidence is in `docs/evidence/production-narration-desktop-2026-08-09.json`.
- The supervisor, backup/restore, and same-pin staged update path have live desktop evidence in `docs/evidence/production-compatibility-stage-desktop-2026-08-10.json`. The isolated actual-host rollback drill in `docs/evidence/production-compatibility-rollback-drill-desktop-2026-08-10.json` switched to a different ST revision, passed post-switch startup, injected failure, restored the original revision and persistent-state sentinel, and left the live runtime unchanged.
- Actual-host authority/resource evidence is in `docs/evidence/production-campaign-authority-desktop-2026-08-10.json` and `docs/evidence/production-cutover-performance-desktop-2026-08-10.json`: 100-sample Campaign commit, Workspace load, Context Plan, and Companion pre-model targets pass; exactly one fake upstream boundary call occurred per measured linked request. The fake boundary deliberately excludes inference and does not replace the separate real-LM narration evidence.
- The fallback-to-companion desktop round-trip, verified backup/export/divergence report, owned shutdown, verified-Binding admission, and preserved inactive extension slots have sanitized evidence in `docs/evidence/production-mode-roundtrip-desktop-2026-08-10.json`.
- Live Story Sync remains model-dependent. A conservative real-model desktop trace passed the human-review safety boundary; sanitized evidence lives in `docs/evidence/production-story-sync-desktop-2026-08-10.json`. Physical Android review remains deferred, not passed.
- The representative saved-chat desktop cutover trace passes in `docs/evidence/production-real-campaign-cutover-desktop-2026-08-10.json`: verified backup, Campaign Book edit and attachment, explicit Binding reconciliation, exact retrieval, real-model linked narration, restart, and continued readback. It contains no prompt or generated prose.
- Rich addon coverage beyond Actors, Items, Abilities, Relationships, active/completed Quests, Places, and the simplified current Scene remains future work. Addon files with unsupported fields show explicit warnings.
- LM Studio model loading and unloading remains manual by design.
