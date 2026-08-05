# SillyTavern RPG Campaign

A local-first RPG Campaign system for SillyTavern and LM Studio.

## Project status

There are two deliberately separate product paths in this repository:

- **Working fallback:** `extension/st-rpg-campaign` is implemented, tested, and usable inside SillyTavern today.
- **Companion rebuild:** tracer #32 now contains the production-shaped host, wire contracts, Campaign Book status shell, and non-owning SillyTavern launcher. It does not own Campaign truth yet and is not accepted until the Windows and physical-phone gates pass.

Everything under `prototypes/` is throwaway decision evidence. Prototype success does not mean the production companion feature exists.

Normative companion sources:

- `docs/spec/companion-v1-specification.md`
- `docs/design/final-companion-architecture-and-verification.md`
- `docs/spec/implementation-tracer-plan.md`

V1 companion narration uses one deterministic preflight Context Plan and one narrator model call. Hidden narration drafts, enrichment rewrites, vectors, narrator tools, automatic narrator retries, and automatic model management are not part of v1.

## Tracer #32 companion skeleton

The first production slice adds:

- `apps/companion` — strict TypeScript/Fastify host at port `8002`;
- `apps/workspace` — React/Vite Campaign Book status shell;
- `packages/wire` — versioned runtime schemas and derived TypeScript types;
- `extension/st-rpg-bridge` — a launcher only; it does not intercept generation;
- `/health` — process-alive state independent from external dependencies;
- `/ready` — Workspace, SQLite runtime, SillyTavern, and LM Studio observations;
- actionable startup failures for invalid configuration, missing Workspace assets, and occupied port `8002`.

Install dependencies and build from the repository root:

```powershell
npm install
npm run typecheck
npm test
```

Start the companion:

```powershell
npm run start:companion
```

Open Campaign Book locally at `http://127.0.0.1:8002/`. From Android on the trusted LAN/VPN, use `http://<PC-IP>:8002/`.

Install the launcher into the project-local SillyTavern instance:

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-bridge/install.ps1
```

This tracer deliberately does not introduce Campaign tables, migration, Context retrieval, Story Sync jobs, or narrator proxy routing.

## Working fallback extension

`extension/st-rpg-campaign` currently implements:

- Character, Inventory, Abilities, People, Relationships, Objectives, World, and Current Scene workflows;
- typed revision-checked Campaign Operations with guarded archive, restore, delete, and Undo behavior;
- atomic create-and-attach workflows for Items, Abilities, relationships, Places, and Scene presences;
- Current Scene editing and atomic Advance Scene with immutable Scene history;
- additive external JSON addon synchronization with stable external IDs;
- chat-metadata persistence with server readback, conflict rejection, and browser recovery journaling;
- deterministic Context Capsule compilation, inspection, pins, exclusions, and hard budgets;
- bounded Story Sync analysis through a separate worker profile;
- durable editable Proposals that require explicit human acceptance;
- native SillyTavern Popup ownership for Story Sync while the Workspace remains mounted.

The fallback remains installed and usable through companion tracers #32–#39. It may be retired only after the full real-device cutover in #40 succeeds.

## Install and run the fallback

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-campaign/install.ps1
```

Start SillyTavern with:

```powershell
.\Start-Local-SillyTavern.cmd
```

Refresh the browser, open a character chat, and use the gold **R** launcher.

## External JSON addons

Fill the valid JSON files in `campaign-content`, or add files such as `items_house-harcourt.json`. Files ending in `_example.json` are documentation only; all other `.json` files are bundled during installation.

For the normal Windows workflow, run:

```powershell
.\campaign-content\Sync-JSON-Addons.bat
```

Refresh SillyTavern and press **Sync JSON Addons** in the Workspace. Stable addon IDs are additive upsert keys: repeating sync updates the same imported entries, while removing a row from JSON does not delete it from the Campaign.

## Verification

Runtime baseline:

```powershell
node tools/check-node-version.mjs
```

Full current suite:

```powershell
npm test
```

Focused fallback suite:

```powershell
node --test --test-isolation=none extension/st-rpg-campaign/tests/*.test.mjs
```

Native Popup architecture guard:

```powershell
node prototypes/st-worker-routing-spike/check-native-popup-surface.mjs
```
