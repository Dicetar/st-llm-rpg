# ST LLM RPG Backend

This folder is the authoritative backend service for the project.

It currently provides:

- FastAPI endpoints for health, state reads, event history, journal entries, command execution, turn resolution, and scene lifecycle
- a SQLite-backed runtime repository that bootstraps from tracked seed data
- a JSON reference repository kept for parity tests and migration confidence
- automatic runtime bootstrapping from tracked sample seed files
- command handlers for:
  - `/inventory`
  - `/use_item`
  - `/cast`
  - `/equip`
  - `/quest`
  - `/quest_update`
  - `/condition`
  - `/relationships`
  - `/relationship`
  - `/relationship_note`
  - `/scene_move`
  - `/scene_object`
  - `/scene_clue`
  - `/scene_hazard`
  - `/scene_discovery`
  - `/journal`
  - `/new`
  - `/new_item`
  - `/new_spell`
  - `/new_custom_skill`
- lorebook projection/sync after command execution, journal/session summaries, scene updates, and extraction updates
- keyword insertion entries with a SillyTavern-compatible world-info export shape
- backend-side lore activation during `resolve-turn`, with the activated entry set returned for debugging
- `resolve-turn` continuity now accepts recent chat context so narration stays aligned with the current thread, not just the latest user line
- safe extraction handling that stages unsafe or invalid model proposals with reasons and ignores no-op proposals
- advisory LM Studio scene-close summary drafts that do not mutate canonical state
- pytest coverage for the current command loop, repository parity, dry-run behavior, resolve-turn orchestration, extraction, and scene lifecycle

## Runtime model

Tracked sample state lives in:

- `data/seed/`

Default mutable runtime state lives in:

- `runtime/storage/state.sqlite3`

The backend never writes back into `data/seed/`. If runtime files are missing, the repository bootstraps them from the seed set automatically.
If you need the JSON reference repository for debugging or parity checks, set `ST_LLM_RPG_REPOSITORY=json`.

## Quick start

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

Open:

- `http://127.0.0.1:8010/docs`

## LM Studio settings

`POST /narration/resolve-turn` uses LM Studio's OpenAI-compatible chat-completions endpoint.

Relevant environment variables:

- `LM_STUDIO_BASE_URL`
- `LM_STUDIO_CHAT_COMPLETIONS_PATH`
- `LM_STUDIO_MODEL`
- `LM_STUDIO_EXTRACTOR_MODEL`
- `LM_STUDIO_API_KEY` or `LM_API_TOKEN`
- `LM_STUDIO_TIMEOUT_SECONDS`

## Current endpoints

- `GET /health`
- `GET /state/overview`
- `GET /state/inventory?actor_id=player`
- `GET /state/actor/detail?actor_id=player`
- `GET /state/campaign/detail`
- `GET /state/scene/current`
- `GET /state/scene/detail`
- `GET /state/scene/archive`
- `GET /state/lorebook`
- `GET /state/lorebook/insertion-entries`
- `GET /state/quests`
- `GET /state/relationships`
- `POST /state/lorebook/sync`
- `POST /state/quest-note`
- `GET /events/recent`
- `GET /journal/entries`
- `POST /journal/entries`
- `POST /journal/session-summary`
- `POST /commands/parse`
- `POST /commands/execute`
- `POST /narration/resolve-turn`
- `POST /scene/open`
- `POST /scene/close`
- `POST /scene/draft-close-summary`

Both turn endpoints now return additive execution summary fields:

- `command_count`
- `success_count`
- `failure_count`
- `has_failures`
- `rolled_back`
- `committed`

`POST /narration/resolve-turn` also returns additive `warnings[]` when narration or extraction fails after backend execution. In that case the endpoint still returns the authoritative turn payload, and narration falls back to a backend-generated summary instead of reporting a misleading HTTP failure after state was already committed.

`POST /commands/execute` and `POST /narration/resolve-turn` accept `failure_policy`:

- `best_effort` keeps current behavior and commits successful command mutations even if another command in the turn fails
- `rollback_on_failure` discards all command mutations when any command fails, returns discarded changes for narration/debugging, and commits only a rollback audit event

## Test command

```bash
backend\.venv\Scripts\python.exe -m pytest backend\tests -q
```

## Example requests

### Parse mixed text for slash commands

```bash
curl -X POST http://127.0.0.1:8010/commands/parse -H "Content-Type: application/json" -d "{\"text\":\"I want to /use_item [health potion] and /cast [suggestion]\"}"
```

### Execute against authoritative state

```bash
curl -X POST http://127.0.0.1:8010/commands/execute -H "Content-Type: application/json" -d "{\"actor_id\":\"player\",\"text\":\"I want to /use_item [health potion] and /cast [suggestion]\"}"
```

### Execute atomically with rollback on failure

```bash
curl -X POST http://127.0.0.1:8010/commands/execute -H "Content-Type: application/json" -d "{\"actor_id\":\"player\",\"failure_policy\":\"rollback_on_failure\",\"commands\":[{\"name\":\"cast\",\"argument\":\"suggestion\"},{\"name\":\"unknown_command\",\"argument\":\"anything\"}]}"
```

### Resolve a full turn through LM Studio

```bash
curl -X POST http://127.0.0.1:8010/narration/resolve-turn -H "Content-Type: application/json" -d "{\"actor_id\":\"player\",\"text\":\"I pocket the whistle and ask Lavitz what he saw.\",\"include_extraction\":true}"
```

### Update scene state through the command contract

```bash
curl -X POST http://127.0.0.1:8010/commands/execute -H "Content-Type: application/json" -d "{\"actor_id\":\"player\",\"commands\":[{\"name\":\"scene_move\",\"argument\":\"South Gate Landing | south_gate_landing | dusk | 3\"},{\"name\":\"scene_object\",\"argument\":\"Moonlit Balcony | A narrow balcony open to the night air. | visible | balcony,night | 2 | open\"},{\"name\":\"scene_clue\",\"argument\":\"Wet footprints near the railing\"}]}"
```

### Close the current scene and open the next one

```bash
curl -X POST http://127.0.0.1:8010/scene/close -H "Content-Type: application/json" -d "{\"summary\":\"The square quieted after sunset.\",\"durable_facts\":[\"Lavitz agreed to meet again after dusk.\"],\"next_scene\":{\"scene_id\":\"inn_common_room\",\"location\":\"Common Room\"}}"
```

### Draft a close-scene summary without mutating state

```bash
curl -X POST http://127.0.0.1:8010/scene/draft-close-summary -H "Content-Type: application/json" -d "{\"instructions\":\"Keep only explicit facts.\",\"recent_event_limit\":8,\"recent_journal_limit\":8}"
```

### Append a journal entry

```bash
curl -X POST http://127.0.0.1:8010/journal/entries -H "Content-Type: application/json" -d "{\"kind\":\"scene_summary\",\"text\":\"Lavitz regained his footing and prepared to confront the next social pressure.\",\"tags\":[\"scene\",\"recovery\"]}"
```

### Save a session summary and rebuild lorebook insertions

```bash
curl -X POST "http://127.0.0.1:8010/journal/session-summary?actor_id=player" -H "Content-Type: application/json" -d "{\"summary\":\"Lavitz studied the private chamber before leaving.\",\"durable_facts\":[\"Lavitz found a moon key in the private chamber.\"],\"tags\":[\"moon_key\",\"private_chamber\"]}"
```

### Read keyword insertion entries

```bash
curl "http://127.0.0.1:8010/state/lorebook/insertion-entries?actor_id=player&sync=true"
```

## Continuation focus

The backend contract is now in place. The next work should stay additive:

1. complete a live frontend smoke pass against resolve-turn, rollback mode, and scene refresh behavior
2. refine LM Studio prompts and live integration behavior without changing backend authority rules
3. continue tightening extraction edge cases from real play traces
