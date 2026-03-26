# ST LLM RPG Backend Skeleton

This is the first runnable backend slice for your SillyTavern + LM Studio narrative/TTRPG project.

It is intentionally narrow and stable:
- authoritative state is stored on the backend
- commands mutate state first
- narration comes after validated state changes
- event history is append-only
- the repository boundary is clean, so JSON storage can be replaced with SQLite later without changing the API surface

## What is included

- FastAPI app skeleton
- file-backed authoritative state repository
- command parser for mixed text such as:
  - `I want to /use_item [health potion] and /cast [suggestion]`
- working handlers for:
  - `/inventory`
  - `/use_item`
  - `/cast`
  - `/equip`
  - `/quest`
  - `/journal`
- recent event and journal endpoints
- sanitized sample data derived from your current files
- pytest coverage for the core command engine

## Important note about the imported character state

The bootstrap actor snapshot in `data/character_state.safe.json` is **sanitized on purpose**.
Only general gameplay-relevant fields were carried forward into this runnable prototype.
This keeps the backend contract focused on inventory, resources, spells, quests, and scenes.

## Where this fits in the full project

This folder is the **backend service**.
It should live outside the SillyTavern extensions folder.

Recommended real project placement:

```text
NovelRPG/
  backend/                <-- put this project here
  sillytavern/
    public/
      scripts/
        extensions/
          third-party/
            st-rpg-ui/    <-- future ST UI extension goes here
```

## Quick start

```bash
cd st_llm_rpg_backend_skeleton
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

Then open:
- `http://127.0.0.1:8010/docs`

## First endpoints

- `GET /health`
- `GET /state/overview`
- `GET /state/inventory?actor_id=player`
- `GET /state/scene/current`
- `GET /state/quests`
- `GET /events/recent`
- `GET /journal/entries`
- `POST /journal/entries`
- `POST /commands/parse`
- `POST /commands/execute`

## Example requests

### Parse commands from mixed player text

```bash
curl -X POST http://127.0.0.1:8010/commands/parse   -H "Content-Type: application/json"   -d '{"text":"I want to /use_item [health potion] and /cast [suggestion]"}'
```

### Execute commands from mixed player text

```bash
curl -X POST http://127.0.0.1:8010/commands/execute   -H "Content-Type: application/json"   -d '{"actor_id":"player","text":"I want to /use_item [health potion] and /cast [suggestion]"}'
```

### Add a journal entry

```bash
curl -X POST http://127.0.0.1:8010/journal/entries   -H "Content-Type: application/json"   -d '{"kind":"scene_summary","text":"Lavitz regained his footing and prepared to confront the next social pressure.","tags":["scene","recovery"]}'
```

## Step-by-step implementation path

1. Run this backend and verify the command loop in the docs UI.
2. Connect SillyTavern to call `POST /commands/execute` for slash-command input.
3. After command execution, send the returned `narration_context` to LM Studio.
4. Render the refreshed inventory / scene / quest panels in ST.
5. Replace the JSON repository with SQLite once the first vertical slice feels correct.
6. Add post-turn extraction later for automatic item/quest/scene updates proposed by the narrator.

## What to build next

The next safe vertical slice is:
- `/use_skill`
- `/rest short`
- `/inspect`
- scene transition endpoint
- post-turn update validator
- SQLite repository implementation behind the same repository interface
