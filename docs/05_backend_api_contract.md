# 05 - Backend API Contract

## Style

- JSON only
- explicit request and response models
- additive read-side changes only
- mutation responses must expose enough detail for the frontend to stop guessing
- every read and mutation route may take optional `save_id` as a query parameter

`save_id` is the backend runtime namespace.
If omitted, the backend uses the legacy shared `default` runtime.
Named saves are isolated under `backend/runtime/saves/<save_id>/...`.

## Read endpoints

### `GET /health`
Service heartbeat.

### `GET /state/overview`
Compact actor and scene dashboard payload.

### `GET /state/inventory?actor_id=player`
Inventory and item-note view for one actor.

### `GET /state/actor/detail?actor_id=player`
Richer actor detail including custom skills, spells, equipment, conditions, and notes.

### `GET /state/campaign/detail`
Canonical campaign detail.

### `GET /state/scene/current`
### `GET /state/scene/detail`
Current scene snapshot.

### `GET /state/scene/archive`
Recent archived scenes.

### `GET /state/lorebook`
Current lorebook projection.

### `GET /state/lorebook/insertion-entries?actor_id=player&sync=true`
Returns deterministic backend-built keyword insertion entries plus a SillyTavern-compatible `sillytavern_world_info` export shape. `sync=true` bootstraps missing insertion entries from canonical state, but normal rebuilds should use `POST /state/lorebook/sync`.

### `GET /state/quests`
Current active quest payload.

### `GET /state/relationships`
Current relationship records from canonical campaign state.

### `GET /events/recent`
Recent event log records.

### `GET /journal/entries`
Recent journal entries.

## Mutation endpoints

### `POST /commands/parse`
Parses mixed text and returns extracted slash commands.

### `POST /commands/execute`
Primary authoritative command endpoint.

Current command surface includes inventory/equipment/resource commands, builder commands, condition updates, quest and relationship updates, and scene upkeep commands such as `scene_move`, `scene_object`, `scene_clue`, `scene_hazard`, and `scene_discovery`.

Request body:

- `actor_id`
- optional `scene_id`
- optional `text`
- optional `commands[]`
- `mode` (`commit` by default, `dry_run` for non-persisting execution)
- `failure_policy` (`best_effort` by default, `rollback_on_failure` to discard the whole turn if any command fails)

Response body:

- `turn_id`
- `mode`
- `failure_policy`
- `parsed_commands[]`
- `results[]`
- `command_count`
- `success_count`
- `failure_count`
- `has_failures`
- `rolled_back`
- `committed`
- `state_changes[]`
- `discarded_state_changes[]`
- `overview`
- `refresh_hints[]`
- `event_ids[]`
- `narration_context`
- `lore_sync`

### `POST /narration/resolve-turn`
Full-turn orchestration endpoint.

Request body:

- `actor_id`
- optional `scene_id`
- optional `text`
- optional `commands[]`
- optional `recent_chat_messages[]` with recent non-system user/assistant lines for continuity
- `mode`
- `failure_policy`
- `include_extraction`

Response body:

- all `POST /commands/execute` fields
- `prose`
- `activated_lore_entries[]`
- `warnings[]` for non-fatal narration or extraction issues
- `narrator_model`
- `extractor_model`
- `proposed_updates[]`
- `applied_updates[]`
- `staged_updates[]`

### `POST /scene/open`
Replaces the active scene with structured scene input, records a scene-open event, syncs lore, and returns `refresh_hints[]`.

### `POST /scene/close`
Archives the active scene, writes summary journal entries, promotes durable facts, sets the next active scene, syncs lore, and returns `refresh_hints[]`.

### `POST /scene/draft-close-summary?actor_id=player`
Drafts an advisory scene-close summary through LM Studio without mutating canonical state.

Request body:

- optional `instructions`
- `recent_event_limit`
- `recent_journal_limit`

Response body:

- `ok`
- `scene_id`
- `model`
- `summary`
- `durable_facts[]`
- `warnings[]`
- `source_counts`

### `POST /state/quest-note`
Updates an existing quest note and records the change in the event log.

### `POST /state/lorebook/sync?actor_id=player`
Rebuilds lorebook projection and keyword insertion entries from canonical state, journal summaries, scene state, campaign state, and actor state.

### `POST /journal/entries`
Appends an explicit journal entry and rebuilds lorebook insertion entries.

### `POST /journal/session-summary?actor_id=player`
Records a session summary journal entry, emits a session-summary event, and rebuilds lorebook insertion entries.

Request body:

- `summary`
- optional `durable_facts[]`
- optional `tags[]`
- optional `scene_id`
- optional `metadata`

## Response rules

- every committed mutation flow returns a stable `turn_id`
- when `scene_id` is omitted, turn events and extractor events fall back to the current canonical scene
- every command result must include a clear success/failure message
- failed commands should include `error_code`
- turn-level failure metadata is additive and should be trusted over frontend inference
- `best_effort` preserves successful command mutations even when later commands fail
- `rollback_on_failure` commits only a rollback audit event when any command fails; successful attempted mutations are returned as `discarded_state_changes[]`
- `refresh_hints` are authoritative enough for the frontend to decide what to reload
- mutation flows that rebuild keyword insertion entries should include `lorebook` in `refresh_hints`
- `POST /narration/resolve-turn` should expose the bounded activated lore set that was actually supplied to the narrator
- narrator or extractor failures after command execution should return a successful turn payload with `warnings[]` instead of hiding already-applied state behind an HTTP error
- `dry_run` must not persist canonical state, event log entries, or lorebook revisions, and should not report committed lore sync metadata
- extraction auto-applies only validated safe categories; unsafe categories and validation failures are staged into event/journal records with a machine-readable `reason`
- extraction no-op proposals should not create canonical mutations, event records, or lorebook revisions
- scene close summary drafts are advisory only and must not write scene state, archives, journal entries, event records, or lorebook revisions
