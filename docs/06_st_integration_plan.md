# 06 - SillyTavern Integration Baseline

This doc describes the current bridge baseline, not a future v1 sketch.

## Extension responsibilities

The SillyTavern bridge should:

- register slash commands and endpoint wrappers
- call backend read and mutation endpoints
- render state panels and inspector views
- surface authoritative command results and warnings
- refresh from backend `refresh_hints`
- route normal narrative turns through `POST /narration/resolve-turn` when enabled

The bridge should not:

- own canonical mutable state
- infer inventory, spell slots, quest truth, or scene truth locally
- bypass backend validation with frontend-only game rules

## Current panel surface

The bridge now exposes:

- Overview
- Scene
- Scene Lifecycle
- Inventory
- Builder / Composer
- Quests
- Relationships
- Session Summary
- Lorebook Insertions
- Activated Lore
- Extraction Review
- Journal
- Recent Events
- Last Executions
- Connection & Actor
- Inspector views for actor, scene, and campaign detail

## Current bridge command surface

Read and inspection commands:

- `/inventory`
- `/quest`
- `/journal`
- `/lorebook`
- `/actor`
- `/campaign`
- `/scene`
- `/relationships`
- `/rpg_refresh`

Backend mutation commands:

- `/use_item`
- `/cast`
- `/equip`
- `/condition`
- `/quest_update`
- `/relationship_note`
- `/scene_move`
- `/scene_object`
- `/scene_clue`
- `/scene_hazard`
- `/scene_discovery`
- `/new`
- `/new_item`
- `/new_spell`
- `/new_custom_skill`

Endpoint wrapper commands:

- `/rpg_resolve`
- `/scene_open`
- `/scene_close`
- `/scene_draft_close`
- `/session_summary`

## Next milestone direction

The next milestone is **Gameplay Expansion Through Memory And Turn Quality**:

1. establish a live SillyTavern smoke baseline for the current bridge
2. harden resolve-turn request/reset behavior and context refresh expectations
3. tune lore activation and narration context quality from real play traces
4. deepen extraction-review-to-state workflows for supported categories
5. improve session summary and durable memory quality without changing backend authority rules
