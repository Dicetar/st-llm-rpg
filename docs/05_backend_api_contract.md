# 05 — Backend API Contract

## Style
- JSON only
- clear request/response contracts
- explicit error codes
- do not hide mutation side effects

## First version endpoints

### `GET /health`
Purpose: service heartbeat.

### `GET /state/overview`
Returns a compact dashboard payload for the frontend.

Suggested response:
- active campaign summary
- current scene summary
- actor summary
- quest summary
- relationship summary
- inventory summary counts

### `GET /scene/current`
Returns the active scene snapshot.

### `GET /inventory/{actor_id}`
Returns inventory entries plus equipped items and currency.

### `GET /quests`
Returns active/completed/failed quests.

### `GET /relationships/{actor_id}`
Returns current relationship view for one actor.

### `POST /commands/execute`
Primary mutation endpoint.

Request body:
- `actor_id`
- `scene_id`
- `raw_text`
- `commands[]`
- `mode` (`dry_run` or `commit`)

Response body:
- `results[]`
- `state_changes[]`
- `narration_context`
- `refresh_hints`

### `POST /narration/resolve-turn`
Optional convenience endpoint.
Combines command execution, LM Studio narration, structured extraction, and safe post-turn state updates.

### `POST /scene/close`
Closes current scene, archives it, and optionally creates summary and journal records.

### `POST /scene/open`
Starts a new scene from structured input.

### `GET /journal`
Returns journal entries by type and recency.

### `GET /events`
Returns recent event log entries for debugging and timeline display.

## Response rules
- every mutation endpoint returns a stable `turn_id`
- every successful mutation lists applied changes
- every failed command includes error code and human-readable explanation
- frontend should never infer missing changes by itself
