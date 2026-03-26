# st-llm-rpg

A practical project scaffold for building a **SillyTavern-based narrative/TTRPG frontend** with **LM Studio** as the narrator backend and a **separate authoritative state service**.

This repository is intentionally split into three major parts:

- **backend/** — FastAPI state service, command execution, event log, journal, seed data
- **frontend-extension/** — SillyTavern UI bridge and extension notes
- **docs/** — architecture, build plan, migration notes, and implementation guidance

## Current status

This repository already includes:

- architecture and implementation docs
- a runnable backend skeleton
- a SillyTavern bridge extension skeleton
- shared JSON schemas for command requests and post-turn updates
- starter prompts for narration and structured extraction
- example campaign config and migration guidance

## Read first

1. `docs/00_decision.md`
2. `docs/01_target_architecture.md`
3. `docs/09_implementation_steps.md`
4. `backend/README.md`
5. `frontend-extension/README.md`

## Recommended development order

1. run the backend and verify `/commands/execute`
2. connect the ST extension to the backend
3. add LM Studio turn-resolution endpoint
4. replace JSON file storage with SQLite behind the same repository boundary
5. expand commands, journal flow, scene lifecycle, and safe extraction

## Local quick start

### Backend

```bash
cd backend
python -m venv .venv
. .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

Open:

- `http://127.0.0.1:8010/docs`

### Frontend extension

See:

- `frontend-extension/docs/01_where_to_put_files.md`
- `frontend-extension/docs/02_install_and_enable.md`

## Project rule

**Commands mutate state first. Narration happens after validated state changes.**

That is the backbone of the whole project.
