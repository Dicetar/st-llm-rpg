# 16 - Local Windows Workflow

## Canonical local-dev path

For this repo, treat these as the default local workflow targets:

- backend bridge URL: `http://127.0.0.1:8014`
- active SillyTavern extension copy: `D:\Ollama\STavern\SillyTavern\public\scripts\extensions\third-party\llm-rpg-bridge`
- mutable runtime state: `backend/runtime/`

If your local SillyTavern build uses a different extension runtime folder, override the sync script destination explicitly instead of changing repo docs.

## One control surface

Use the control panel if you want backend start/reset/stop, runtime reset, extension sync, SillyTavern start/stop, and LM Studio auth settings in one visible place:

```powershell
.\tools\scripts\control_panel.cmd
```

The panel launches backend and SillyTavern in separate visible consoles.
For LM Studio auth, prefer the panel's `Use environment key` option plus a user-level `LM_STUDIO_API_KEY`.

## Start, stop, and reset the backend visibly

Use the command wrappers from repo root:

```powershell
.\tools\scripts\start_backend_visible.cmd
.\tools\scripts\stop_backend.cmd
.\tools\scripts\reset_backend_visible.cmd
```

- `start_backend_visible.cmd` starts the backend in a visible console on `8014`
- `stop_backend.cmd` clears whatever is listening on `8014`
- `reset_backend_visible.cmd` clears the port and starts a fresh backend in a visible console

If a `resolve-turn` request is stuck, reset the backend first. If LM Studio is still generating, stop generation there too.

## Sync the active extension copy

Default helper:

```powershell
.\tools\scripts\sync_st_extension.cmd
```

PowerShell form:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\scripts\sync_st_extension.ps1
```

Default source:

- `D:\Projects\st-llm-rpg\frontend-extension\llm-rpg-bridge`

Default destination:

- `D:\Ollama\STavern\SillyTavern\public\scripts\extensions\third-party\llm-rpg-bridge`

## Reset runtime state

The runtime reset helper no longer restores tracked JSON files. It deletes `backend/runtime/` so the backend can bootstrap a clean runtime from `backend/data/seed/` on next start.

Wrapper:

```powershell
.\tools\scripts\reset_runtime_state.cmd
```

PowerShell form:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\scripts\reset_runtime_state.ps1
```

Use it only when the backend is stopped, or pair it with `reset_backend_visible.cmd`.

## Manual equivalents

### Reset runtime manually

```powershell
Remove-Item -LiteralPath .\backend\runtime -Recurse -Force
New-Item -ItemType Directory -Path .\backend\runtime\data -Force | Out-Null
New-Item -ItemType Directory -Path .\backend\runtime\storage -Force | Out-Null
```

### Sync extension manually

```powershell
robocopy D:\Projects\st-llm-rpg\frontend-extension\llm-rpg-bridge D:\Ollama\STavern\SillyTavern\public\scripts\extensions\third-party\llm-rpg-bridge /MIR
```
