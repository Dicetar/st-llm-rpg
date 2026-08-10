# SillyTavern RPG Campaign

A local-first RPG Campaign system for SillyTavern and LM Studio.

## Status

- **Playable preview:** `0.3.0-preview.10` starts pinned SillyTavern and the production companion through one `Wayfinder.cmd` supervisor. The imported Campaign, linked narration, Campaign Book editing, Context Tray, content-free narration status, recoverable atomic Story Sync Review Inbox, reviewable JSON addon inbox, verified backup/restore catalog, immutable history, staged compatibility verification, and explicit fallback/companion mode switch are available now.
- **Working product:** `extension/st-rpg-campaign` is the tested SillyTavern fallback used today.
- **Durable companion authority:** issue #33 owns Campaign truth in SQLite, with immutable history, reconstruction, stale-write protection, verified backup/restore, and restart evidence.
- **Context planning milestone:** issue #36 adds revision-pinned Context Plans, visibility, ordered per-chat pins, exact/Scene/FTS5/relation retrieval, token budgets, and the inspectable Context Tray.
- **Narration routing:** issue #37 shipped the strict production bridge envelope, fail-closed linked admission, transparent explicit-unlinked forwarding, one serial inference lane, deterministic Context assembly, and atomic buffered delivery. Direct production LM Studio and real pinned-ST desktop browser/chat-history traces pass; the product owner deferred the additional physical-phone rerun.
- **Story Sync:** bounded worker jobs and editable source-linked Proposals persist in SQLite. The worker is configured separately from the narrator and cannot mutate Campaign truth. Only the explicit **Finalize review** action applies accepted Proposals as one Campaign revision while advancing the originating chat's Sync Boundary in the same SQLite transaction. Real LM Studio desktop evidence is recorded in `docs/evidence/production-story-sync-desktop-2026-08-10.json`.
- **Story Sync recovery:** active analysis can be stopped; stopped, interrupted, or failed jobs can resume only after fresh Campaign/Binding/Sync checks; unresolved jobs can be discarded without changing Campaign truth or the Sync Boundary.
- **Backups and restore:** Companion creates one verified daily SQLite backup, supports labelled manual backups, previews and re-verifies restore targets, creates a new safety backup before activation, and reloads restored Campaign truth. Deterministic retention preserves manual backups, recent daily/pre-operation sets, and weekly anchors.
- **JSON addon inbox:** Companion watches `campaign-content`, rescans the complete directory, persists and resumes exact manifest-bound import candidates, displays creates/updates/warnings/blockers, and applies only an explicitly reviewed diff after a verified backup. Missing addon rows never delete accepted Campaign truth.
- **Visible supervisor:** `Wayfinder.cmd` now owns explicit `start`, `status`, `stop`, `companion`, `backup`, and confirmed `restore` commands. Process records bind PID, creation time, executable path, command hash, role, and run identity. Stop drains only an identity-matched Companion and never kills an unknown port owner or user-managed LM Studio.
- **Pinned compatibility updates:** `Wayfinder.cmd update-compatibility` creates a verified Campaign backup, builds the reviewed SillyTavern revision beside the active runtime, installs and checks both RPG extensions, and proves isolated startup before any switch. A needed switch preserves the previous runtime and rolls back automatically if post-switch verification fails.
- **Explicit authority modes:** `Wayfinder.cmd fallback` first creates a verified SQLite backup, full Campaign/history/Binding JSON export, and divergence report, then disables the thin bridge and keeps legacy metadata untouched. `Wayfinder.cmd companion` requires a verified Chat Binding, restores the bridge, and never claims to merge fallback play.

The planning phase is complete. Existing files under `prototypes/` are frozen decision evidence: do not extend them or treat them as production code.

The companion v1 contract is defined in `docs/spec/companion-v1-specification.md`. It uses one deterministic Context Plan and one narrator model call; hidden drafts, enrichment rewrites, vectors, narrator tools, automatic narrator retries, and automatic model management are excluded.

## Companion development

Use the recommended Node version from `.node-version`. Other Node releases in the supported `>=24.15.0 <25` range are accepted with a warning.

Install dependencies once with `npm ci`, then double-click `Wayfinder.cmd`.

It verifies/builds production assets when necessary, refreshes the production bridge, starts or reuses the correct companion on `:8002`, waits for Campaign readiness, and starts or reuses pinned SillyTavern on `:8001`. LM Studio remains externally managed; if it is absent, Campaign editing stays available and narration status is visibly degraded.

Check the running stack without starting anything:

```powershell
.\Wayfinder.cmd status
npm run smoke:playable
```

Operational commands:

```powershell
.\Wayfinder.cmd stop
.\Wayfinder.cmd backup Before-major-edit
.\Wayfinder.cmd restore
.\Wayfinder.cmd restore backup-... --confirm
.\Wayfinder.cmd update-compatibility
.\Wayfinder.cmd fallback
.\Wayfinder.cmd companion
```

`restore` without an ID lists available verified backups. Without `--confirm`, it requires an exact typed confirmation. `update-compatibility` never pulls project source or mutates active SillyTavern in place; it only realizes the versions already reviewed in `compatibility.lock.json`. `fallback` requires typed confirmation; use `--confirm` only for scripted operation. `--emergency` permits fallback after failed backup/export but never deletes SQLite. In fallback mode, select LM Studio directly in SillyTavern and refresh; companion mode uses the proxy again for verified linked chats.

Campaign Book is available locally at `http://127.0.0.1:8002/` and from Android on the trusted LAN/VPN at `http://<PC-IP>:8002/`.

The launcher installs the production bridge automatically. To refresh it manually:

```powershell
npm run install:bridge
```

Before linked narration, save exactly one Narrator Model Profile for the model ID selected in SillyTavern. Use **Campaign Book → Context → Model profile**. Unlinked chats require no Campaign or profile, but still route explicitly through the running companion.

See [`docs/playable-preview.md`](docs/playable-preview.md) for the shortest play path, recovery steps, fallback boundary, and known preview limits.

## Working fallback

The fallback currently provides Character, Inventory, Abilities, People, Relationships, Objectives, World, Current Scene, deterministic narration context, JSON addon sync, recovery-aware persistence, and human-reviewed Story Sync.

Install it with:

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-campaign/install.ps1
```

Start the complete preview stack with:

```powershell
.\Wayfinder.cmd
```

Refresh the browser, open a character chat, and use the gold **R** launcher.

## External JSON addons

For the production Companion, edit valid JSON files in `campaign-content`, open **Campaign Book → JSON addon inbox**, choose a Campaign, and press **Preview import diff**. Review all changes and warnings, then explicitly apply. Companion rechecks the exact file manifest and Campaign revision, creates a verified safety backup, and commits one atomic Campaign event.

The current Companion importer supports Actors (`people`), Items, Quests with `active`/`completed` status, Places, and the simplified current Scene. Unsupported richer fallback fields remain visible as warnings instead of being silently discarded. The remaining collections are part of the continuing companion model expansion.

For the fallback extension only, run:

```powershell
.\campaign-content\Sync-JSON-Addons.bat
```

Refresh SillyTavern and press **Sync JSON Addons**. Stable addon IDs update existing imported records; removing a JSON row does not delete Campaign state in either workflow.

## Verification

```powershell
npm run check:runtime
npm run typecheck
npm test
node prototypes/st-worker-routing-spike/check-native-popup-surface.mjs
npm run smoke:playable
```
