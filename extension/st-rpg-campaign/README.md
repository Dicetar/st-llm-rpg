# RPG Campaign Workspace

This production slice of the RPG rebuild provides a verified Campaign Session, real Character, Inventory, Abilities, People, Objectives, World, and Current Scene workflows, and an owned Story Sync Review Inbox inside SillyTavern.

Current capabilities:

- create an Item and its Possession in one atomic operation;
- select an existing Item definition and add another Possession without leaving Inventory;
- edit Item description and live Inventory state together;
- immediate quantity changes with revision-safe Undo;
- archive, restore, and guarded permanent deletion of Inventory entries;
- deterministic Context Capsule Core injection from verified Campaign state;
- retrieve kind-specific Record details from recent chat, current Scene membership, typed links, pins, and manual next-reply focus without a model call;
- inspect the exact narrator Context Capsule, Core/Focus usage, selection reasons, and every omitted record;
- pin, automatically select, or exclude records through verified Campaign operations;
- enforce one 8,000-character hard ceiling across the compact Core and retrieved Focus;
- serialize large Collections as compact state indexes while keeping full descriptions in canonical Records until selected;
- chat-metadata persistence with server readback and a recoverable browser journal;
- per-chat form drafts that survive failed saves and browser reloads;
- compact one-row Inventory cards and one-column mobile editing;
- create and edit an Ability and its learned state in one form;
- select an existing Ability definition and learn it without leaving Abilities;
- immediate remaining-use changes with revision-safe Undo;
- archive, restore, guarded deletion, search, and deterministic context injection for Abilities;
- create and edit NPC Actor records without syntax;
- add directed Relationships in the same NPC editor, including status, notes, and bounded relationship dimensions;
- archive/restore Relationships and report reference blockers before permanent Actor deletion;
- edit the singleton Player Character with structured conditions and add/remove/reorder meters;
- create and edit Objectives with structured add/remove/reorder Quest steps;
- archive, restore, and guardedly delete Objectives while preserving typed references;
- filter, create, and edit Facts, Places, and World Objects in one World collection;
- edit typed Fact subjects, Place parents/connections, and World Object homes without IDs or delimiter syntax;
- quick-create missing linked records inside the current World editor and retain the parent draft;
- block unsafe World deletion through Facts, Objectives, Place links, the Current Scene, and Scene Archives;
- open and edit the live Current Scene with structured presences, exits, obstacles, countdowns, and threads;
- create linked Places and presence Records without abandoning the Current Scene draft;
- advance in one guarded operation that archives the old Scene immutably, opens the next Scene, and optionally carries unresolved threads;
- build valid external JSON addon files into the installed extension;
- atomically upsert Player Character, Item/Possession, Ability/Learned Ability, NPC, Relationship, Quest, Fact, Place, World Object, and Current Scene addons by stable external ID;
- resolve typed addon references and preserve stable IDs for Quest steps and every nested Scene entry;
- inject the synced Current Scene, active Objectives, and relevant World records into verified narration context;
- a separate Campaign Worker profile without changing the active narrator;
- bounded Story Sync with one malformed-output repair attempt and stale-result rejection;
- durable, editable field-level proposals in SillyTavern's native Popup;
- accept or reject proposals individually, apply accepted changes through Campaign Operations, and advance the Sync Boundary only when a source range is fully reviewed;
- preserve pending and empty Story Sync reviews across reloads.

Install into the project-local SillyTavern:

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-campaign/install.ps1
```

Restart or refresh SillyTavern, enable **RPG Campaign Workspace**, open a character chat, and use the gold **R** launcher.

External authoring lives in `campaign-content` at the project root. Edit the `*_addon.json` files, double-click `Sync-JSON-Addons.bat`, refresh SillyTavern, and press **Sync JSON Addons**. The `*_example.json` files document all supported fields and are excluded from synchronization.

Story Sync is owned by this production extension; the throwaway Worker extension is no longer required. Character, Objectives, World, Current Scene, Advance Scene, and Story Sync approvals use the same verified Campaign Session and draft conventions.
