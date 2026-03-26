# 02 — Install and enable

## Step 1 — run the backend first
Start the backend service before testing the extension.

Expected local backend URL:

```text
http://127.0.0.1:8010
```

## Step 2 — copy extension files
Copy:

```text
frontend-extension/llm-rpg-bridge/
```

into your SillyTavern extensions folder.

## Step 3 — restart SillyTavern
Restart ST completely so the extension manifest is loaded.

## Step 4 — open Extensions settings
In SillyTavern:
- open Extensions
- enable **LLM RPG Bridge**

## Step 5 — configure the extension
Open the RPG panel and set:

- Backend URL
- Actor ID

Recommended first values:

- Backend URL: `http://127.0.0.1:8010`
- Actor ID: `player`

Then press **Save** and **Refresh**.

## Step 6 — verify state fetch

The panel should populate:

- Overview
- Inventory
- Quests
- Recent Events

If it does not, open your browser dev tools and look for:

- network errors
- backend port mismatch
- CORS or fetch failures
- extension load errors

## Step 7 — test slash commands

Start with:

- `/rpg_refresh`
- `/inventory`
- `/quest`

Then test a mutating command:

- `/use_item health potion`
- `/cast suggestion`

## Step 8 — generate narration

The extension stores a pending narration block in chat metadata.
On the next generation, the interceptor injects that block into the prompt as a system note.

So the expected flow is:

1. run a command
2. let the extension resolve it against backend state
3. generate the AI reply
4. the model narrates the already-resolved result
