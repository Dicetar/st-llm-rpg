# 17 - Current Dev Workflow

## Source of truth

- tracked sample state lives in `backend/data/seed/`
- legacy shared runtime state lives in `backend/runtime/storage/state.sqlite3`
- named-save runtime state lives under `backend/runtime/saves/<save_id>/storage/state.sqlite3`
- runtime artifacts remain under `backend/runtime/`

The backend repository layer bootstraps missing runtime state from `backend/data/seed/` automatically. Local command execution, journal writes, event logs, scene archives, and lorebook sync should only touch `backend/runtime/`.
If you need the JSON reference repository instead of SQLite for debugging or parity work, set `ST_LLM_RPG_REPOSITORY=json`.

## Canonical local backend loop for SillyTavern work

From repo root, prefer the visible-console helper:

```powershell
.\tools\scripts\start_backend_visible.cmd
```

- backend bind URL for the bridge: `http://127.0.0.1:8014`
- stop with `.\tools\scripts\stop_backend.cmd`
- hard reset a stuck request with `.\tools\scripts\reset_backend_visible.cmd`

That clears the in-flight backend request and the next turn pulls fresh chat context again. If LM Studio is still generating after the backend restarts, stop generation there too.

If you want the PowerShell form directly, do not prefix it with `python`:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\scripts\start_backend_visible.ps1
```

If you need a non-default bind address, use `-BindHost`, not `-Host`.

If you do not want to juggle separate scripts, use:

```powershell
.\tools\scripts\control_panel.cmd
```

That panel centralizes backend start/reset/stop, runtime reset, extension sync, SillyTavern start/stop, and LM Studio env-key handling.

## Backend-only loop

If you are working on the backend without SillyTavern, the plain FastAPI loop is still valid:

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
They cover both JSON and SQLite repository behavior, dry runs, resolve-turn orchestration, extraction parser and validation edge cases, scene lifecycle, and draft-summary non-mutation.

## Frontend extension workflow

- canonical active extension copy for this repo is `D:\Ollama\STavern\SillyTavern\public\scripts\extensions\third-party\llm-rpg-bridge`
- sync that copy from repo root with `.\tools\scripts\sync_st_extension.cmd`
- keep `frontend-extension/llm-rpg-bridge/manifest.json` pointing at `index.js`
- `index.js` is a thin loader only
- actual bridge logic is split across `frontend-extension/llm-rpg-bridge/scripts/`
- the bridge now binds a backend `save_id` per ST chat, using the current chat title as the default save name
- direct slash commands still go through `/commands/execute`
- normal non-slash turns can go through `/narration/resolve-turn` when the setting is enabled

For a manual frontend sanity pass, use `docs/18_frontend_smoke_checklist.md`.

## Runtime reset workflow

- reset runtime state with `.\tools\scripts\reset_runtime_state.cmd`
- that clears `backend/runtime/` only, including any named saves under `backend/runtime/saves/`
- the backend then bootstraps a fresh runtime from `backend/data/seed/` on next start

## Intentionally untracked files

These should not be committed during normal local use:

- `backend/runtime/**`
- `backend/.venv/`
