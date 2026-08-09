# SillyTavern RPG Campaign

A local-first RPG Campaign system for SillyTavern and LM Studio.

## Status

- **Working product:** `extension/st-rpg-campaign` is the tested SillyTavern fallback used today.
- **Durable companion authority:** issue #33 owns Campaign truth in SQLite, with immutable history, reconstruction, stale-write protection, verified backup/restore, and restart evidence.
- **Context planning milestone:** issue #36 adds revision-pinned Context Plans, visibility, ordered per-chat pins, exact/Scene/FTS5/relation retrieval, token budgets, and the inspectable Context Tray.
- **Narration routing in progress:** issue #37 now has the strict production bridge envelope, fail-closed linked admission, transparent explicit-unlinked forwarding, one serial inference lane, deterministic Context assembly, and atomic buffered delivery. Direct production LM Studio traces pass; real SillyTavern desktop/phone mode traces remain before closure.

The planning phase is complete. Existing files under `prototypes/` are frozen decision evidence: do not extend them or treat them as production code.

The companion v1 contract is defined in `docs/spec/companion-v1-specification.md`. It uses one deterministic Context Plan and one narrator model call; hidden drafts, enrichment rewrites, vectors, narrator tools, automatic narrator retries, and automatic model management are excluded.

## Companion development

Use the recommended Node version from `.node-version`. Other Node releases in the supported `>=24.15.0 <25` range are accepted with a warning.

```powershell
npm ci
npm run typecheck
npm test
npm run start:companion
```

Campaign Book is available locally at `http://127.0.0.1:8002/` and from Android on the trusted LAN/VPN at `http://<PC-IP>:8002/`.

Install the launcher into the project-local SillyTavern instance:

```powershell
npm run install:bridge
```

Before linked narration, save exactly one Narrator Model Profile for the model ID selected in SillyTavern. Use **Campaign Book → Context → Model profile**. Unlinked chats require no Campaign or profile, but still route explicitly through the running companion.

## Working fallback

The fallback currently provides Character, Inventory, Abilities, People, Relationships, Objectives, World, Current Scene, deterministic narration context, JSON addon sync, recovery-aware persistence, and human-reviewed Story Sync.

Install it with:

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-campaign/install.ps1
```

Start SillyTavern with:

```powershell
.\Start-Local-SillyTavern.cmd
```

Refresh the browser, open a character chat, and use the gold **R** launcher.

## External JSON addons

Edit the valid JSON files in `campaign-content`, then run:

```powershell
.\campaign-content\Sync-JSON-Addons.bat
```

Refresh SillyTavern and press **Sync JSON Addons**. Stable addon IDs update existing imported records; removing a JSON row does not delete Campaign state.

## Verification

```powershell
npm run check:runtime
npm run typecheck
npm test
node prototypes/st-worker-routing-spike/check-native-popup-surface.mjs
```
