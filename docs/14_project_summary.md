# 14 - Project Summary So Far

## Current shape

The project is now a working command-first narrative RPG prototype with three stable roles:

- the FastAPI backend owns canonical state, mutation rules, turn records, journals, events, extraction validation, and scene lifecycle
- the SillyTavern extension remains a thin client that renders state and calls backend endpoints
- LM Studio generates narration and structured proposals only after the backend has already validated or simulated state changes

## What is working

The repository is no longer in a planning-only state.

- runtime persistence now defaults to SQLite under `backend/runtime/storage/state.sqlite3`
- tracked seed data remains in `backend/data/seed/`
- the JSON repository still exists as a reference implementation and parity target
- `POST /commands/execute` returns `turn_id`, `mode`, `state_changes`, `refresh_hints`, and committed event records
- multi-command turns can now use best-effort execution or rollback-on-failure execution
- `POST /narration/resolve-turn` can execute commands, build narration context, call LM Studio, and optionally run safe extraction
- `POST /scene/open` and `POST /scene/close` now cover active scene replacement, archiving, summary journaling, and durable fact promotion
- `POST /scene/draft-close-summary` can produce advisory LM close-summary drafts without mutating canonical state
- the extension can still dispatch slash commands directly, and it can also resolve normal non-slash turns through the backend when enabled
- the extension exposes scene lifecycle forms and `/scene_draft_close`, `/scene_open`, and `/scene_close` endpoint commands

## What is still rough

The architecture is in the right place, but continuation work remains.

- the broadened contract has backend test coverage, but not yet a live SillyTavern smoke run in this repo state
- the scene and campaign command surface is broader now, but still intentionally narrower than a full GM toolset
- extraction rules are intentionally conservative and should stay that way until more real play traces exist
- there is no live sync layer yet; refresh remains request/response driven

## Why this matters

The important change is not just that more endpoints exist. The project now has a real authoritative turn boundary:

1. parse or accept commands
2. validate and mutate backend state
3. record events and journal/lore side effects
4. build narration context from authoritative state
5. call the model only after the backend truth is known
6. optionally apply safe extracted facts back through backend rules

That makes the repository substantially easier to continue without collapsing back into prompt-only state management.

## Next continuation targets

The next work should stay additive:

1. run a live frontend smoke pass against the split bridge, rollback selector, scene panel, and resolve-turn flow
2. harden failure-path behavior around extraction edge cases from real model output
3. refine prompts and UX while keeping the backend as the only owner of canonical state
4. keep future command additions additive and continuation-safe
