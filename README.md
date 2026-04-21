# st-llm-rpg

`st-llm-rpg` is a working local-first narrative/TTRPG prototype built around three boundaries:

- `backend/`: FastAPI service that owns authoritative state, command execution, journaling, event history, turn resolution, and scene lifecycle
- `frontend-extension/`: SillyTavern bridge that renders panels, calls the backend, and routes normal narrative turns through the backend when enabled
- `LM Studio`: narrator and extractor backend, called only after validated state changes

The core rule is unchanged:

**Commands mutate state first. Narration happens after validated state changes.**

## Current prototype status

The repo already includes:

- a runnable FastAPI backend with read endpoints, command parsing, command execution, resolve-turn orchestration, safe extraction, scene open/close APIs, draft-only scene summaries, lorebook sync, event logging, and journal APIs
- a SQLite-backed runtime repository bootstrapped from tracked seed data, plus a JSON reference repository kept for parity testing
- a usable SillyTavern extension with backend-driven command dispatch, overview/scene/scene-lifecycle/inventory/quest/relationship/journal/event panels, an inspector, pending narration injection, and optional backend-first normal turn resolution
- tracked sample seed data under `backend/data/seed/`
- ignored runtime state under `backend/runtime/`, bootstrapped automatically from the seed files
- backend regression tests covering command parity, dry-run behavior, rollback-on-failure behavior, turn resolution, extraction, and scene lifecycle

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
`/narration/resolve-turn` also requires LM Studio's OpenAI-compatible server plus a usable `LM_STUDIO_MODEL`.

### Frontend extension

See:

- `frontend-extension/docs/01_where_to_put_files.md`
- `frontend-extension/docs/02_install_and_enable.md`
- `docs/18_frontend_smoke_checklist.md`

## Next milestone

The next milestone is **Gameplay Expansion Through Memory And Turn Quality**:

1. establish a live SillyTavern smoke baseline for the current bridge
2. harden resolve-turn request/reset behavior and context refresh expectations
3. tune lore activation and narration context quality from real play traces
4. deepen extraction-review-to-state workflows for supported categories
5. improve session summary and durable memory quality without changing backend authority rules
