# 02 - Install and enable

## Step 1 - run the backend first

Use the visible-console helper from repo root:

```powershell
.\tools\scripts\start_backend_visible.cmd
```

Recommended bridge URL for the active SillyTavern workflow:

```text
http://127.0.0.1:8014
```

## Step 2 - sync the extension copy that SillyTavern actually loads

Use:

```powershell
.\tools\scripts\sync_st_extension.cmd
```

That syncs `frontend-extension/llm-rpg-bridge/` into the canonical runtime path for this repo:

```text
<SILLYTAVERN_ROOT>/public/scripts/extensions/third-party/llm-rpg-bridge/
```

## Step 3 - restart or hard refresh SillyTavern

After syncing, restart SillyTavern completely or hard refresh the open client so the updated bridge files are reloaded.

## Step 4 - verify the bridge loaded

Open a chat and confirm the RPG panel is present.

If it does not appear, inspect the browser console and network tab for:

- extension load errors
- backend port mismatch
- fetch failures
- stale extension files in the wrong runtime directory

## Step 5 - configure the bridge

Open the RPG panel and set:

- Backend URL: `http://127.0.0.1:8014`
- Actor ID: `player`

Then press `Save` and `Refresh`.

## Step 6 - verify state fetch

The panel should populate at least:

- Overview
- Scene
- Inventory
- Quests
- Recent Events

## Step 7 - test commands

Start with:

- `/rpg_refresh`
- `/inventory`
- `/scene`
- `/lorebook`

Then test mutating commands:

- `/cast [suggestion]`
- `/equip [ceremonial dagger]`
- `/condition [rattled | add]`

## Step 8 - test full-turn narration

Use either a fresh non-slash user turn with backend resolution enabled, or:

```text
/rpg_resolve I inspect the desk and watch her reaction.
```

Expected behavior:

1. backend resolves the turn
2. the bridge appends authoritative action output if commands fired
3. narration is appended from `POST /narration/resolve-turn`
4. `Activated Lore` and `Extraction Review` update when applicable
