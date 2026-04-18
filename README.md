# st-llm-rpg

`st-llm-rpg` is a working local-first narrative/TTRPG prototype built around three boundaries:

- `backend/`: FastAPI service that owns authoritative state, command execution, journaling, and event history
- `frontend-extension/`: SillyTavern bridge that renders panels, calls the backend, and injects narration context
- `LM Studio`: intended narrator backend, called only after validated state changes

The core rule is unchanged:

**Commands mutate state first. Narration happens after validated state changes.**

## Current prototype status

The repo already includes:

- a runnable FastAPI backend with read endpoints, command parsing, command execution, lorebook sync, event logging, and journal APIs
- a usable SillyTavern extension with backend-driven command dispatch, overview/inventory/quest/event panels, an inspector, and pending narration injection
- tracked sample seed data under `backend/data/seed/`
- ignored runtime state under `backend/runtime/`, bootstrapped automatically from the seed files
- backend regression tests covering the current command loop

## Read first

1. `docs/13_current_repo_status.md`
2. `docs/17_current_dev_workflow.md`
3. `backend/README.md`
4. `frontend-extension/README.md`
5. `docs/01_target_architecture.md`

## Local quick start

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

Then open:

- `http://127.0.0.1:8010/docs`

Runtime files are created automatically in `backend/runtime/` the first time the backend or tests touch the repository layer.

### Frontend extension

See:

- `frontend-extension/docs/01_where_to_put_files.md`
- `frontend-extension/docs/02_install_and_enable.md`

## Near-term milestones

1. add LM Studio turn-resolution orchestration on the backend
2. expand safe post-turn extraction and auto-apply validation
3. mature frontend panels and workflow ergonomics
4. replace the JSON runtime repository with SQLite behind the same backend boundary
