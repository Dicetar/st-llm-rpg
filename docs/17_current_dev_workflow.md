# 17 - Current Dev Workflow

## Source of truth

- Tracked sample state lives in `backend/data/seed/`
- Default mutable runtime state lives in `backend/runtime/storage/state.sqlite3`
- Runtime artifacts remain under `backend/runtime/`

The backend repository layer bootstraps missing runtime state from `backend/data/seed/` automatically. Local command execution, journal writes, event logs, scene archives, and lorebook sync should only touch `backend/runtime/`.
If you need the JSON reference repository instead of SQLite for debugging or parity work, set `ST_LLM_RPG_REPOSITORY=json`.

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

If you want to use `POST /narration/resolve-turn`, also run LM Studio's OpenAI-compatible server and configure `LM_STUDIO_MODEL` plus any non-default connection settings.

## Test command

From repo root:

```bash
backend\.venv\Scripts\python.exe -m pytest backend\tests -q
```

The tests copy tracked seed data into an isolated temp workspace, bootstrap runtime files there, and assert that command execution mutates runtime copies only.
They now cover both JSON and SQLite repository behavior, dry runs, resolve-turn orchestration, extraction parser/validation edge cases, and scene lifecycle.

## Frontend extension workflow

- Keep `frontend-extension/llm-rpg-bridge/manifest.json` pointing at `index.js`
- `index.js` is a thin loader only
- actual bridge logic is split across `frontend-extension/llm-rpg-bridge/scripts/`
- direct slash commands still go through `/commands/execute`
- normal non-slash turns can go through `/narration/resolve-turn` when the setting is enabled

For a manual frontend sanity pass, use `docs/18_frontend_smoke_checklist.md`.

## Intentionally untracked files

These should not be committed during normal local use:

- `backend/runtime/**`
- `backend/.venv/`
