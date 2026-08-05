# SillyTavern RPG Campaign

A local-first RPG Campaign workspace built on SillyTavern. The rebuild keeps normal roleplay in SillyTavern while adding verified structured Campaign state, deterministic narration context, editable model-assisted Story Sync, and guarded scene progression.

## Current production slice

`extension/st-rpg-campaign` implements end-to-end Character, Inventory, Abilities, People, Objectives, World, and Current Scene workflows plus the production Story Sync Review Inbox:

- create an Item inside Inventory and add its Possession atomically;
- add a Possession from an existing Item definition in the same editor;
- edit description, quantity, carried state, equipment, condition, and notes;
- immediate quantity changes with revision-safe Undo;
- archive, restore, and guarded permanent deletion;
- create and edit spells, skills, feats, and powers together with learned/prepared state;
- learn an existing Ability definition in the same editor;
- adjust limited Ability uses immediately and inject only available Abilities into narration context;
- create and edit NPC identity, characterization, conditions, and context policy;
- add, edit, archive, restore, and remove directed Relationships inside the NPC editor;
- edit the Player Character, current conditions, and ordered meters without leaving Character;
- create and edit Objectives with status, stakes, outcome, and ordered add/remove/reorder steps;
- archive, restore, and guardedly delete Objectives;
- create and edit Facts, Places, and World Objects from one filtered World collection;
- build Place hierarchies and ordered connections with stable selectors and cycle validation;
- create missing linked records inside a World editor without abandoning its draft;
- archive, restore, and safely delete World records with cross-record and Scene blockers;
- open and edit one live Current Scene with structured presences, exits, obstacles, countdowns, and threads;
- create missing linked Places and presence Records inside the Current Scene editor;
- atomically Advance Scene, carry selected unresolved threads, and preserve the closed Scene as immutable history;
- author bulk content in valid, documented JSON addon files outside SillyTavern;
- revision-safely upsert Player Character, Inventory, Abilities, People, Relationships, Quests, Facts, Places, World Objects, and one Current Scene without duplicating stable external IDs;
- compile a verified compact Core, then retrieve relevant typed Record details from recent chat before narration;
- persist to chat metadata with server readback and browser recovery;
- inject a deterministic Context Capsule only after the Campaign revision is verified;
- inspect the exact injected text, section allocation, and omissions from **Narrator Context**;
- pin or exclude records and immediately recompile a verified, hard-budgeted capsule;
- keep large Collections as compact indexes while an inspectable Focus expands exact mentions, semantic matches, Scene links, pins, and manual next-reply selections;
- route bounded analysis through a separate Campaign Worker profile without changing narration;
- recover one malformed worker response into durable, field-level Proposals;
- edit, accept, or reject each proposal and advance the Sync Boundary only after the range is fully reviewed;
- keep Workspace mounted while Story Sync uses SillyTavern's native Popup.

Install it into the included SillyTavern instance:

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-campaign/install.ps1
```

Start SillyTavern with `Start-Local-SillyTavern.cmd`, refresh the browser, open a character chat, and use the gold **R** launcher.

## External JSON addons

Fill the valid JSON files in `campaign-content`, or add files such as `items_house-harcourt.json`. Files ending in `_example.json` are documentation only; all other `.json` files are bundled during installation. Double-click `campaign-content/Sync-JSON-Addons.bat` for the normal Windows workflow.

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-campaign/install.ps1
```

Refresh SillyTavern and press **Sync JSON Addons** in the Workspace. Stable addon IDs are additive upsert keys: repeating sync updates the same imported entries, while removing a row from JSON does not delete it from the Campaign.

Focused checks:

```powershell
node --test --test-isolation=none extension/st-rpg-campaign/tests/*.test.mjs
```

Architecture and domain decisions live in `CONTEXT.md`, `docs/design`, and `docs/adr`. Throwaway integration laboratories remain under `prototypes`; their runtime launchers are disabled after their verdicts.
