# 17 - Current Dev Workflow

## Source of truth

- Tracked sample state lives in `backend/data/seed/`
- Mutable runtime state lives in `backend/runtime/data/`
- Mutable runtime logs live in `backend/runtime/storage/`

The backend repository layer bootstraps missing runtime files from `backend/data/seed/` automatically. Local command execution, journal writes, event logs, and lorebook sync should only touch `backend/runtime/`.

## Local backend loop

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

Docs UI:

- `http://127.0.0.1:8010/docs`

## Test command

From repo root:

```bash
backend\.venv\Scripts\python.exe -m pytest backend\tests -q
```

The tests copy tracked seed data into an isolated temp workspace, bootstrap runtime files there, and assert that command execution mutates runtime copies only.

## Frontend extension workflow

- Keep `frontend-extension/llm-rpg-bridge/manifest.json` pointing at `index.js`
- `index.js` is a thin loader only
- actual bridge logic is split across `frontend-extension/llm-rpg-bridge/scripts/`

If the extension needs a smoke test, verify:

1. the bridge loads without console errors
2. the panel renders
3. inventory and quest sections refresh from the backend
4. a mutating command updates the panel and logs an event

## Intentionally untracked files

These should not be committed during normal local use:

- `backend/runtime/**`
- `backend/.venv/`
