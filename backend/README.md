# ST LLM RPG Backend

This folder is the authoritative backend service for the project.

It currently provides:

- FastAPI endpoints for health, state reads, event history, journal entries, and command execution
- a JSON-backed repository with a clean boundary for future SQLite replacement
- automatic runtime bootstrapping from tracked sample seed files
- command handlers for:
  - `/inventory`
  - `/use_item`
  - `/cast`
  - `/equip`
  - `/quest`
  - `/journal`
  - `/new`
  - `/new_item`
  - `/new_spell`
  - `/new_custom_skill`
- lorebook projection/sync after command execution
- pytest coverage for the current command loop

## Runtime model

Tracked sample state lives in:

- `data/seed/`

Mutable runtime files are created in:

- `runtime/data/`
- `runtime/storage/`

The backend never writes back into `data/seed/`. If runtime files are missing, the repository bootstraps them from the seed set automatically.

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

## Current endpoints

- `GET /health`
- `GET /state/overview`
- `GET /state/inventory?actor_id=player`
- `GET /state/actor/detail?actor_id=player`
- `GET /state/campaign/detail`
- `GET /state/scene/current`
- `GET /state/scene/detail`
- `GET /state/lorebook`
- `GET /state/quests`
- `POST /state/quest-note`
- `GET /events/recent`
- `GET /journal/entries`
- `POST /journal/entries`
- `POST /commands/parse`
- `POST /commands/execute`

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

### Append a journal entry

```bash
curl -X POST http://127.0.0.1:8010/journal/entries -H "Content-Type: application/json" -d "{\"kind\":\"scene_summary\",\"text\":\"Lavitz regained his footing and prepared to confront the next social pressure.\",\"tags\":[\"scene\",\"recovery\"]}"
```

## Next milestone

The backend is ready for the next orchestration slice:

1. add LM Studio turn-resolution on top of `narration_context`
2. add safe post-turn extraction/validation
3. keep the repository contract stable while swapping runtime persistence to SQLite
