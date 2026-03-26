# 16 — Local Windows Workflow

## Sync the SillyTavern extension

A helper script is provided for keeping the runtime extension folder in sync with the repo copy.

### Script
`tools/scripts/sync_st_extension.ps1`

### Default source
`D:\Projects\st-llm-rpg\frontend-extension\llm-rpg-bridge`

### Default destination
`D:\Ollama\STavern\SillyTavern\data\default-user\extensions\llm-rpg-bridge`

### Usage
```powershell
powershell -ExecutionPolicy Bypass -File .\tools\scripts\sync_st_extension.ps1
```

This mirrors the repo extension folder into the active SillyTavern extension folder.

## Reset tracked runtime state

A helper script is provided to restore the tracked backend runtime files back to the current Git HEAD.

### Script
`tools/scripts/reset_runtime_state.ps1`

### Usage
```powershell
powershell -ExecutionPolicy Bypass -File .\tools\scripts\reset_runtime_state.ps1
```

This resets:
- `backend/data/character_state.safe.json`
- `backend/data/item_registry.json`
- `backend/data/spell_registry.json`
- `backend/storage/event_log.jsonl`
- `backend/storage/journal_entries.jsonl`

## Manual equivalents

### Reset only runtime files
```powershell
git restore backend/data/character_state.safe.json
git restore backend/data/item_registry.json
git restore backend/data/spell_registry.json
git restore backend/storage/event_log.jsonl
git restore backend/storage/journal_entries.jsonl
```

### Sync extension manually
```powershell
robocopy D:\Projects\st-llm-rpg\frontend-extension\llm-rpg-bridge D:\Ollama\STavern\SillyTavern\data\default-user\extensions\llm-rpg-bridge /MIR
```
