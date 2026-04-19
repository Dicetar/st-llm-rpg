# 18 - Frontend Smoke Checklist

Use this when validating the SillyTavern bridge manually after backend or extension changes.

## Preconditions

- backend running at the configured bridge URL
- LM Studio running as well if you want to test `resolve-turn`
- extension installed from `frontend-extension/llm-rpg-bridge/`

## Core load checks

1. open SillyTavern and confirm the bridge loads without console errors
2. open the RPG panel and confirm Overview, Scene, Scene Lifecycle, Inventory, Quests, Session Summary, Lorebook Insertions, Extraction Review, and Recent Events render
3. open the Inspector and confirm actor, scene, and campaign sections load

## Command checks

1. run a read command such as `/inventory` and confirm the panel refreshes without local/frontend-only state drift
2. run a mutating command such as `/cast [suggestion]`, `/equip [ceremonial dagger]`, or `/condition [rattled | add]`
3. confirm the chat receives the action summary and the backend event list updates
4. confirm the relevant panel sections refresh from backend data

## Lorebook and session memory checks

1. open Lorebook Insertions and confirm keyword entries render with keys and content
2. click Sync Lorebook and confirm the entry count/revision refresh without tracked file changes
3. save a Session Summary with at least one durable fact
4. confirm Journal, Recent Events, and Lorebook Insertions refresh
5. run `/lorebook` and confirm it returns backend-built keyword insertion entries
6. run `/session_summary [Short session summary | durable fact one; durable fact two | tag_one,tag_two]` and confirm the new summary appears in the journal and lorebook entries

## Resolve-turn checks

1. enable "Resolve normal turns via backend" in the bridge settings
2. send a normal non-slash user message
3. confirm the extension calls `POST /narration/resolve-turn`
4. confirm backend narration is appended once and local generation is aborted
5. if extraction is enabled, confirm only safe updates are applied and the panel reflects the resulting `refresh_hints`
6. confirm the `Activated Lore` section shows the bounded lore entries selected for that turn
7. if extraction is enabled, confirm `Extraction Review` shows proposed updates, applied mutations, staged items, and any non-fatal warnings
8. if extraction returns supported proposed or staged updates, confirm `Apply` and `Dismiss` work and handled entries disappear from the live queue
9. if the narrator or extractor fails, confirm the turn still appears in `Last Executions` and `Extraction Review` instead of surfacing as a total backend failure

## Scene checks

1. use the Scene Lifecycle panel to draft a close summary and confirm summary/facts fields fill without Events, Journal, Scene Archive, or current scene changing
2. run `/scene_draft_close [keep only explicit facts]` and confirm it returns a draft but does not mutate backend state
3. use the Open Scene form or `/scene_open [market_square_evening | Market Square | Evening | urban,social | 2]`
4. confirm the current scene changes in the panel and inspector
5. use the Close Scene form or `/scene_close [The market quieted. | Lavitz agreed to meet after dusk. | inn_common_room | Common Room | Night]`
6. confirm Journal and Recent Events update, a scene archive appears, and the next scene becomes active

## Cleanliness check

1. inspect git status after normal local use
2. confirm runtime churn stays inside ignored `backend/runtime/`
3. confirm no tracked seed files were mutated
