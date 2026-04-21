# 14 - Project Summary So Far

## Current shape

The project is a working command-first narrative RPG prototype with three stable roles:

- the FastAPI backend owns canonical state, mutation rules, turn records, journals, events, extraction validation, and scene lifecycle
- the SillyTavern extension remains a thin client that renders state and calls backend endpoints
- LM Studio generates narration and structured proposals only after the backend has already validated or simulated state changes

## What is working

- runtime persistence defaults to SQLite under `backend/runtime/storage/state.sqlite3`
- tracked seed data remains in `backend/data/seed/`
- the JSON repository still exists as a reference implementation and parity target
- `POST /commands/execute` returns `turn_id`, `mode`, `state_changes`, `refresh_hints`, and committed event records
- multi-command turns support both best-effort execution and rollback-on-failure execution
- `POST /narration/resolve-turn` can execute commands, build narration context, call LM Studio, activate lore, and optionally run safe extraction
- `POST /scene/open`, `POST /scene/close`, and `POST /scene/draft-close-summary` cover active scene replacement, archiving, summary drafting, summary journaling, and durable fact promotion
- the extension can dispatch slash commands directly, resolve normal non-slash turns through the backend when enabled, and inspect activated lore plus extraction review output
- session summaries and lorebook insertions are already part of the working prototype loop

## What is still rough

- the broader contract has backend test coverage, but still needs consistent live SillyTavern smoke validation in the current repo state
- request-reset expectations between the backend, the bridge, and LM Studio need clearer live behavior under slow or canceled generations
- lore activation and extraction quality still need tuning from real play traces
- refresh remains request and response driven; there is no live sync layer

## Next continuation target

The next milestone is **Gameplay Expansion Through Memory And Turn Quality**:

1. establish a live SillyTavern smoke baseline for the current bridge
2. harden resolve-turn request/reset behavior and context refresh expectations
3. tune lore activation and narration context quality from real play traces
4. deepen extraction-review-to-state workflows for supported categories
5. improve session summary and durable memory quality without changing backend authority rules
