# 03 — Domain Model

## Goal
Keep the domain model simple, explicit, and durable.

## Core entities

### Actor
Represents a player character, NPC, creature, faction agent, or abstract institution used in scenes.

Suggested fields:
- `id`
- `campaign_id`
- `name`
- `kind` (`player`, `npc`, `faction`, `institution`, `creature`)
- `summary`
- `tags`
- `is_active`

### InventoryEntry
Represents ownership of an item by an actor.

Suggested fields:
- `id`
- `campaign_id`
- `owner_actor_id`
- `item_key`
- `display_name`
- `quantity`
- `equipped_slot`
- `container_key`
- `metadata_json`

### ItemDefinition
Stable description of an item type.

Suggested fields:
- `key`
- `display_name`
- `category`
- `stackable`
- `usable`
- `equippable`
- `consumable`
- `metadata_json`

### ResourcePool
For spell slots, charges, stamina, mana, class resources.

Suggested fields:
- `actor_id`
- `resource_key`
- `current_value`
- `max_value`
- `metadata_json`

### SpellbookEntry
Represents spell availability to an actor.

Suggested fields:
- `actor_id`
- `spell_key`
- `display_name`
- `level`
- `source`
- `prepared`
- `known`
- `metadata_json`

### Relationship
Represents directional or paired relationship state.

Suggested fields:
- `source_actor_id`
- `target_actor_id`
- `trust`
- `affection`
- `fear`
- `respect`
- `leverage`
- `summary_note`

### Quest
Suggested fields:
- `id`
- `title`
- `status`
- `priority`
- `summary`
- `current_stage`
- `tags_json`

### SceneState
The single active scene snapshot.

Suggested fields:
- `scene_id`
- `location_key`
- `time_label`
- `participants_json`
- `objects_json`
- `exits_json`
- `hazards_json`
- `pending_checks_json`
- `open_threads_json`

### SceneArchive
A completed scene snapshot.

Suggested fields:
- `scene_id`
- `started_at`
- `ended_at`
- `summary`
- `participant_ids_json`
- `outcome_json`
- `journal_refs_json`

### JournalEntry
Suggested fields:
- `id`
- `campaign_id`
- `entry_type`
- `scene_id`
- `text`
- `importance`
- `created_at`

### EventLogEntry
Append-only operational history.

Suggested fields:
- `id`
- `turn_id`
- `scene_id`
- `event_type`
- `payload_json`
- `created_at`
- `source`

## Important rule
Separate:
- stable definitions
- active mutable state
- append-only history
