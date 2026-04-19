# SillyTavern Extension Notes

This folder contains the SillyTavern-side bridge for the project.

## Responsibility of the extension

- render RPG panels and inspector views
- register slash commands
- call the backend API
- present authoritative command results and errors
- inject pending narration context before generation
- optionally route normal narrative turns through `POST /narration/resolve-turn`
- refresh UI from backend-provided `refresh_hints`
- display backend-built lorebook keyword insertion entries

## Keep out of the extension

- canonical state mutations without backend confirmation
- inventory truth
- spell slot truth
- scene archive truth
- lorebook insertion truth
- repository or persistence rules

## Structure

- `llm-rpg-bridge/manifest.json` keeps the stable extension entrypoint
- `llm-rpg-bridge/index.js` is a thin loader
- `llm-rpg-bridge/scripts/` contains the split bridge implementation

Current bridge behavior:

- direct slash commands still use `POST /commands/execute`
- `/rpg_resolve` calls `POST /narration/resolve-turn`
- normal non-slash user turns can also use `resolve-turn` when the setting is enabled
- resolve-turn requests now include a bounded recent chat excerpt so backend narration can stay attached to the current conversation thread
- resolve-turn warnings are surfaced in the bridge log so LM narration or extraction failures do not look like total turn failures after backend state was already applied
- the panel refresh path now follows backend `refresh_hints` instead of always doing a blind full refresh
- the main panel now includes scene, scene lifecycle, relationship, session summary, lorebook insertion, and journal sections alongside overview, inventory, quests, events, and execution logs
- the panel also keeps the last `resolve-turn` activation set in an `Activated Lore` section so you can inspect what the backend actually fed the narrator
- the panel also keeps the last extraction request/result set in an `Extraction Review` section so you can inspect proposals, applied mutations, staged updates, non-fatal warnings, and handle supported entries as a lightweight review queue
- scene lifecycle upkeep commands such as `/scene_move`, `/scene_object`, `/scene_clue`, `/scene_hazard`, and `/scene_discovery` are registered through the same backend contract
- scene lifecycle endpoint commands `/scene_draft_close`, `/scene_open`, and `/scene_close` call the backend scene APIs directly
- the Scene Lifecycle panel can draft close summaries, open scenes, close/archive scenes, and show recent scene archives
- `/lorebook` reads backend-built keyword insertion entries and `/session_summary` records durable session memory through the journal API
- the Connection & Actor section exposes the backend `failure_policy` as a compact selector for best-effort or rollback-on-failure command turns

## Install and enable

See:

- `docs/01_where_to_put_files.md`
- `docs/02_install_and_enable.md`
- `..\docs\18_frontend_smoke_checklist.md`
