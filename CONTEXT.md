# RPG Campaign

This context describes durable game state shared deliberately with SillyTavern chats. It separates Campaign authority, chat-specific bindings, reusable descriptions, and live state so editing, narration, branching, and recovery remain predictable.

## Campaign and history

**Campaign**:
The authoritative RPG state for one solo-player game, independent from any SillyTavern chat. A SillyTavern chat may use it only through an explicit Chat Binding, and a Campaign may have lineage from another Campaign Revision.
_Avoid_: Save, world state, database

**Chat Binding**:
The explicit association of one SillyTavern chat with one Campaign, including chat-specific narration state such as its Sync Boundary and Context Focus. A binding is never inferred from a copied chat or applied automatically.
_Avoid_: Campaign, chat metadata, active save

**Chat Locator**:
Mutable SillyTavern evidence describing which chat currently presents a Chat Binding. It helps detect copies and renames but is never Campaign or Chat Binding identity.
_Avoid_: Chat Binding ID, Campaign ID, stable chat UUID

**Campaign Anchor**:
The Campaign Revision a Chat Binding has explicitly accepted as the truth for that chat. If the Campaign advances elsewhere, the binding remains anchored until a person follows the new head or branches.
_Avoid_: Last seen revision, automatic sync point, current revision cache

**Binding Revision**:
An immutable numbered version of one Chat Binding's accepted chat-specific state. It is independent from Campaign Revision so locator, Sync Boundary, Context Focus, and Campaign Anchor changes do not create false Campaign conflicts.
_Avoid_: Campaign Revision, metadata version

**Binding Operation**:
A typed human-approved request to change one Chat Binding that is accepted atomically or rejected without mutation.
_Avoid_: Campaign Operation, metadata patch, automatic sync

**Binding Event**:
An immutable account of one accepted Binding Operation. It records chat-specific history without pretending that the Campaign's RPG truth changed.
_Avoid_: Campaign Event, UI event, diagnostic log

**Binding Mismatch**:
A detected disagreement between a Chat Binding's Campaign Anchor and current Campaign truth. It requires an explicit user reconciliation choice; the system never silently follows, overwrites, or branches.
_Avoid_: Stale Campaign, sync error, automatic branch

**Binding Collision**:
A Chat Binding presented from a Chat Locator different from its accepted locator, as happens after a copy, import, rename, or move. The cause is never guessed; a person must move the binding, create a separate binding, branch, or remain unlinked.
_Avoid_: Duplicate Campaign, automatic rename, device conflict

**Campaign Revision**:
An immutable numbered version created by one accepted Campaign Operation. It is the concurrency and recovery boundary for Campaign truth, not chat-specific Binding state.
_Avoid_: Record revision, save number

**Campaign Operation**:
A typed request to change Campaign state that is either accepted atomically or rejected without mutation.
_Avoid_: Command string, action string, direct edit

**Campaign Addon**:
A valid external JSON source whose additive creates and updates are reviewed as an import diff before one Campaign Operation applies them.
_Avoid_: Sidecar database, direct save edit, JSON patch

**External ID**:
A stable author-chosen identifier used to match one Campaign Addon entry across repeated imports; it is not the canonical Record ID.
_Avoid_: Record ID, name key

**Campaign Event**:
An immutable account of every accepted Campaign Operation and its affected subjects. Rejected Operations and model drafts do not create Campaign Events.
_Avoid_: Log line, journal entry

**Scene**:
The editable present-tense situation in which play is occurring, including its place, presences, exits, obstacles, countdowns, and open threads.
_Avoid_: Chapter, current location

**Scene Archive**:
An immutable record of a closed Scene, its message range, summary, outcomes, and unresolved threads.
_Avoid_: Old scene, scene history

## Definitions and live state

**Record**:
A stable, independently editable description of a campaign subject such as an Actor, Item, Ability, Quest, Fact, Place, or World Object.
_Avoid_: Entity, content object, card

**Actor**:
A person or creature with a persistent identity. Player Character and NPC are Actor roles rather than unrelated record shapes.
_Avoid_: Cast entry, character blob

**Player Character**:
The Actor directly represented by the solo player in the Campaign.
_Avoid_: User, persona

**NPC**:
An Actor not directly represented by the solo player.
_Avoid_: Cast member

**Item**:
A reusable description of an object that may be possessed, encountered, equipped, stored, or lost.
_Avoid_: Inventory item, stack

**Possession**:
A live ownership entry connecting an Actor to an Item, with quantity, carried state, equipment state, and instance-specific notes.
_Avoid_: Item, inventory record

**Ability**:
A reusable description of something an Actor may know or use, categorized as a spell, skill, feat, or other power.
_Avoid_: Spell record, skill record

**Learned Ability**:
A live entry connecting an Actor to an Ability, including learned, prepared, enabled, charge, or use state when applicable.
_Avoid_: Ability, spellbook row

**Relationship**:
A directed live connection from one Actor to another, with kind, status, notes, and optional relationship dimensions.
_Avoid_: NPC note, free-name relationship

**Scene Presence**:
A live attachment placing an Actor, Item, Possession, or World Object into a Scene with a scene-specific role and state.
_Avoid_: Scene object copy, participant name

**Quest**:
A durable objective with status, stakes, steps, and outcomes.
_Avoid_: Task, open thread

**Quest Step**:
An ordered, independently statused part of a Quest that describes progress toward its outcome.
_Avoid_: Open thread, checklist string

**Fact**:
A durable proposition the Campaign treats as true, optionally about a specific Record.
_Avoid_: Lore entry, memory

**Place**:
A persistent location that may be referenced by Scenes, Facts, Quests, and Records.
_Avoid_: Scene, location string

**World Object**:
A persistent non-portable object or feature that can exist in a Place or Scene.
_Avoid_: Item, scene object copy

**Collection**:
A task-oriented Workspace view that combines relevant Records and live entries; it is not a storage category.
_Avoid_: Table, record kind

## Model-assisted workflow

**Context Capsule**:
A hard-budgeted, inspectable narration prompt assembled for one generation from a verified Campaign Revision and Chat Binding. It contains compact canonical state plus ephemeral Context Focus without mutating the Campaign.
_Avoid_: Lorebook, prompt dump, generated memory

**Context Focus**:
The ephemeral detailed Record selection within a Context Capsule. It combines automatic retrieval with persistent manual pins from one Chat Binding, exposes selection and omission reasons, and expires or changes without creating a Campaign Revision.
_Avoid_: Retrieval memory, automatic mutation, model tool call

**Narrator Visibility**:
The policy controlling whether Campaign material may be sent to the narrator and whether the narrator may reveal it: **Known** may be used and revealed, **Narrator Secret** may be used but must not be revealed directly, and **Campaign Private** is never sent.
_Avoid_: Public/private flag, lore visibility

**Narration Draft**:
An ephemeral hidden reply used to identify relevant Campaign material before final delivery. It is never a chat message, Campaign Record, or Campaign Event.
_Avoid_: Unsaved reply, Proposal, hidden memory

**Narration Enrichment**:
The bounded workflow that retrieves Campaign material for a Narration Draft and may rewrite its prose while preserving material actions, dialogue intent, introduced subjects, and outcomes. The final reply is delivered atomically and enrichment never mutates the Campaign.
_Avoid_: Tool call, Story Sync, automatic lore injection

**Story Sync**:
A user-triggered analysis of chat messages after one Chat Binding's Sync Boundary that creates editable Proposals without changing the Campaign.
_Avoid_: Automatic extraction, background sync

**Sync Boundary**:
The verified message prefix through which Story Sync has already considered one bound chat. It belongs to the Chat Binding, not to the Campaign as a whole.
_Avoid_: Last message index, cursor

**Proposal**:
An editable, source-linked candidate Campaign Operation that remains non-canonical until a person accepts it. Models may create Proposals but cannot accept them.
_Avoid_: Mutation, extracted fact

**Review Inbox**:
The Workspace view containing unresolved Proposals that require a user decision.
_Avoid_: Extraction review, change log

**Advance Scene**:
The guarded workflow that closes the current Scene and creates an editable next Scene; model assistance is optional and never blocks completion.
_Avoid_: Generate scene, auto-progress

## Lifecycle

**Archive**:
A reversible state that removes a Record or live entry from normal views and Context Capsule selection without destroying it.
_Avoid_: Delete, hide

**Delete**:
Permanent removal from current Campaign state, allowed only when no surviving reference depends on the target. Earlier Campaign Revisions and immutable history still reconstruct the former subject.
_Avoid_: Archive, remove from collection

**Unlink**:
An accepted Binding Operation that stops a chat from using its Campaign while retaining the Chat Binding's identity and history for collision detection and recovery.
_Avoid_: Delete Campaign, clear chat automatically, unlinked route inference

**Purge**:
Irreversible whole-Campaign erasure after Archive and explicit confirmation. It is destructive maintenance rather than a Campaign Operation and cannot erase separately held copies.
_Avoid_: Delete Record, Archive, reset

**Lineage**:
The explicit parent Campaign and Campaign Revision from which a self-contained new Campaign was branched. The branch remains usable even if its parent later becomes unavailable.
_Avoid_: Copied save, main chat link
