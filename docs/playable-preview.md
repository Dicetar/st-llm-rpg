# Wayfinder playable preview

Version `0.3.0-preview.5` is a daily-use preview of the campaign-independent companion. It is deliberately not the final cutover: the working fallback remains installed. The real pinned-SillyTavern desktop browser/chat-history narration trace passes. The product owner deferred the additional physical-phone rerun rather than blocking feature work; that rerun is not represented as passed.

## Start

1. Start LM Studio and expose the narrator model through its OpenAI-compatible server on port `1234`.
2. Double-click `Wayfinder.cmd` in the project root.
3. Keep the visible Wayfinder console open when it started SillyTavern. Open SillyTavern at `http://localhost:8001` and Campaign Book at `http://localhost:8002`.
4. On another LAN/VPN device, use the PC address with the same ports, for example `http://10.8.1.2:8001` and `http://10.8.1.2:8002`.

The launcher builds stale or missing production assets, refreshes the production bridge, starts only missing owned processes, waits for Campaign readiness, and refuses unknown port owners. LM Studio absence is non-blocking: editing still works, while the status panel explains why narration cannot run.

Run `Wayfinder.cmd status` for a read-only stack report. Run `npm run smoke:playable` for the release check covering pinned ST, the companion, Workspace, SQLite, model profiles, the installed bridge, fallback presence, and retired prototypes.

## Play path

The currently imported and linked Campaign is ready for use:

1. In Campaign Book, select the Campaign.
2. Edit Actors, Items, Quests, Places, and the Current Scene. Each accepted edit advances immutable Campaign history; stale tabs cannot overwrite a newer revision.
3. Open Context Tray. Confirm the linked chat, exact narrator model profile, automatic budget, and any manual pins. Use **Build Context Plan** for an inspectable dry run with no model call.
4. In SillyTavern, select the same exact model ID as the saved narrator profile and chat normally. The bridge routes linked generations through one deterministic Context Plan and one LM Studio call. The complete answer is withheld until accepted, so Stop cannot leave partial companion text.
5. Open **Narration status** in Campaign Book when a reply fails. It shows active requests and only the latest outcome, elapsed time, a safe error message, and concrete recovery guidance. It never stores prompts, generated prose, or request history and resets when the Companion restarts.
6. Open **Review Inbox** and save the separate Campaign Worker model ID. In a linked SillyTavern chat, choose **Sync Story** from the extensions menu. The Companion analyzes only the bounded unseen range and opens editable, evidence-linked proposals. Accept or reject every Proposal, then choose **Finalize review**. Accepted changes become one Campaign revision and the same SQLite transaction advances only that chat's Sync Boundary.
7. Use **Stop analysis** when a worker must yield. Resume/retry rechecks the Campaign head, Binding, and Sync Boundary before using retained source. **Discard review** removes unresolved source/proposals and changes neither Campaign truth nor the Sync Boundary.

An existing fallback chat can be imported through **Import a fallback chat**. Import is previewed, backed up, and explicit; legacy metadata stays intact. Creating a brand-new Campaign works, but creating a brand-new chat binding without legacy import is not yet part of this preview.

## What is usable now

- campaign-independent SQLite authority and immutable revisions;
- create, edit, and archive Actors, Items, Quests, and Places;
- editable Current Scene and read-only historical revisions;
- explicit legacy import and verified Chat Binding marker;
- deterministic exact, Scene, FTS, and relation Context planning with ordered manual pins;
- exact narrator model profiles and token budgets;
- linked normal, regenerate, continue, swipe, and Stop proxy behavior at the server seam;
- content-free Narration status for the current request and latest outcome, with concrete recovery guidance;
- durable bounded Story Sync jobs, a separate Campaign Worker profile, structured editable proposals for Actors, Items, Quests, Places, and Current Scene, atomic human-only finalization, and explicit stop/resume/discard recovery;
- explicit-unlinked pass-through, including when Campaign SQLite is unavailable;
- separate desktop/mobile Campaign Book page;
- working SillyTavern fallback kept alongside the production bridge.

## Recovery and fallback

- If startup fails, read the named component and PID in the Wayfinder console. The launcher never kills an unknown owner.
- Companion logs are under `.runtime/wayfinder/logs/`.
- Campaign truth is `.runtime/companion/campaigns.sqlite`; validated import backups are under `.runtime/companion/backups/`.
- If Campaign authority is unavailable, linked chats fail closed and never silently narrate without Campaign context. Explicit-unlinked chats remain usable while the companion host and LM Studio are healthy.
- To use the old fallback, open the gold **R** workspace in SillyTavern. After making companion-only edits, fallback and SQLite histories are divergent; there is no silent reverse synchronization.

## Preview limits

- The additional physical Android production-bridge rerun was explicitly deferred; do not infer that it passed. Sanitized desktop evidence is in `docs/evidence/production-narration-desktop-2026-08-09.json`.
- This convenience launcher is preview packaging for the active narration tracer, not acceptance of the later supervisor/update tracer. Occupied-port, partial-start, shutdown, update, and rollback failure-injection acceptance remains ahead.
- New blank Campaigns cannot yet create a fresh Chat Binding from Campaign Book; use the already-linked Campaign or import an existing fallback chat.
- Live Story Sync quality remains model-dependent and needs a representative Campaign trace before #38 closes. Addon reconciliation, daily backup automation, staged ST updates, and final rollback UX belong to later tracers.
- LM Studio model loading and unloading remains manual by design.
