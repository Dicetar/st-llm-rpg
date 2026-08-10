# Campaign JSON addons

This folder is the external authoring surface for RPG Campaign content.

## Fast workflow

1. Fill one or more `*_addon.json` files. The matching `*_example.json` shows every fallback field.
2. In the production Companion, open `http://127.0.0.1:8002/` → **JSON addon inbox**.
3. Choose the target Campaign and press **Preview import diff**. Review, then explicitly apply.

The Companion watches this directory and also provides manual **Rescan files**. A watcher signal never mutates Campaign truth. Apply rechecks the exact manifest and Campaign revision, creates a verified pre-import SQLite backup, then accepts one atomic Campaign event. Missing file rows never delete accepted records.

The current Companion slice imports Actors (`people`), Items, Quests with `active`/`completed` status, Places, and its simplified current Scene. Richer fallback-only fields and collections are shown as warnings; they are never silently claimed as imported.

For the fallback extension, double-click `Sync-JSON-Addons.bat`, refresh SillyTavern, then press **Sync JSON Addons** in Campaign Workspace.

The batch file validates and installs the files for the fallback. The Companion reads this directory directly; it does not require the batch file.

## Supported content

| File | Campaign content |
|---|---|
| `character_addon.json` | The existing Player Character, including conditions and meters |
| `items_addon.json` | Item definitions and their Player Character Possessions |
| `abilities_addon.json` | Spells, skills, feats, powers, and Learned Ability state |
| `people_addon.json` | NPC Actors |
| `relationships_addon.json` | Directed Relationships between NPCs and/or `$player` |
| `quests_addon.json` | Quests/Objectives and ordered steps |
| `facts_addon.json` | Canonical campaign and world facts |
| `places_addon.json` | Places, containment, and durable connections |
| `world_objects_addon.json` | Persistent non-portable objects and their durable state |
| `scene_addon.json` | One Current Scene with presences, exits, obstacles, countdowns, and threads |

Events, accepted history, closed Scene Archives, Story Sync Proposals, and journal material are intentionally not addon-authored. They are lifecycle/audit data rather than editable source content.

- `*_example.json` files document the supported fields and are never imported.
- Every other `.json` file is included when `extension/st-rpg-campaign/install.ps1` runs.
- Fill the provided `*_addon.json` files or add more files such as `items_house-harcourt.json`.
- Keep each `id` stable. Sync uses it to update an existing imported entry instead of creating a duplicate.
- IDs are unique per collection across all addon files.
- Relationship `source` and `target` use a People addon ID or the special value `$player`.
- Typed references use stable addon IDs and must point to entries included in the same installed bundle.
- At most one non-null `character` and one non-null `scene` may exist across all addon files.
- A Scene addon can update the same open Scene but cannot replace a different open Scene.
- Removing an entry from a file does not delete it from SillyTavern. Archive or delete it in the Workspace.

The files are ordinary valid JSON. Since JSON does not support comments, documentation is stored in ignored `_comment` and `_field_help` properties.

Command-line alternative to the batch file:

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-campaign/install.ps1
```

Refresh SillyTavern, open the Campaign Workspace, and press **Sync JSON Addons**.
