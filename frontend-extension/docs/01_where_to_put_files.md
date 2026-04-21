# 01 - Where to put the files

## Development repo structure

Keep your working source in your normal project repo, for example:

```text
D:\Projects\st-llm-rpg\
  backend\
  frontend-extension\
    llm-rpg-bridge\
```

## Canonical SillyTavern runtime location for this repo

For the local workflow used by this project, sync:

```text
frontend-extension/llm-rpg-bridge/
```

into:

```text
<SILLYTAVERN_ROOT>/public/scripts/extensions/third-party/llm-rpg-bridge/
```

Example:

```text
D:\Ollama\STavern\SillyTavern\public\scripts\extensions\third-party\llm-rpg-bridge\
  manifest.json
  index.js
  style.css
```

This is also the default destination used by `tools/scripts/sync_st_extension.ps1`.

If your local SillyTavern build actively uses a different runtime extension folder, override the sync script destination instead of changing the repo-level default.

## Important note

This extension does not go into the backend folder.
The backend stays outside SillyTavern and runs as its own FastAPI service.
