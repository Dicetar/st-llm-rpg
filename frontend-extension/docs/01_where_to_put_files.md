# 01 — Where to put the files

## Development repo structure
Keep your working source in your normal project repo, for example:

```text
D:\Projects\st-llm-rpg\
  backend\
  frontend-extension\
    llm-rpg-bridge\
```

## SillyTavern runtime location
To actually load the extension in SillyTavern, copy this folder:

```text
frontend-extension/llm-rpg-bridge/
```

into your local ST installation under:

```text
<SILLYTAVERN_ROOT>/data/default-user/extensions/llm-rpg-bridge/
```

If your ST setup uses a different user handle, replace `default-user` with that handle.

## Resulting runtime path
Example:

```text
D:\SillyTavern\data\default-user\extensions\llm-rpg-bridge\
  manifest.json
  index.js
  style.css
```

## Important note
This extension does **not** go into the backend folder.
The backend stays outside ST and runs as its own FastAPI service.
