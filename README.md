# SillyTavern RPG Campaign

A local-first RPG Campaign system for SillyTavern and LM Studio.

## Project status

There are two deliberately separate product paths in this repository:

- **Working fallback:** `extension/st-rpg-campaign` is implemented, tested, and usable inside SillyTavern today.
- **Companion rebuild:** the campaign-independent Node/SQLite companion is specified and prototyped, but production implementation has only now begun at GitHub issue #32.

Everything under `prototypes/` is throwaway decision evidence. Prototype success does not mean the production companion feature exists.

Normative companion sources:

- `docs/spec/companion-v1-specification.md`
- `docs/design/final-companion-architecture-and-verification.md`
- `docs/spec/implementation-tracer-plan.md`

V1 companion narration uses one deterministic preflight Context Plan and one narrator model call. Hidden narration drafts, enrichment rewrites, vectors, narrator tools, automatic narrator retries, and automatic model management are not part of v1.

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

Fallback and repository-authority tests:

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

## Next implementation step

Issue #32 builds the smallest production companion slice beside the untouched fallback:

- `apps/companion`;
- `apps/workspace`;
- `packages/wire`;
- `extension/st-rpg-bridge`;
- `/health` and `/ready`;
- a static Campaign Book shell;
- explicit degraded dependency state;
- bounded runtime-validated Problem documents.

It does not introduce Campaign authority, migration, retrieval, Story Sync jobs, or narrator proxy behavior yet.
