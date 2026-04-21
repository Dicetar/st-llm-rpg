# 09 - Implementation Status And Next Steps

## Completed prototype work

The following phases are already represented in the repo:

1. backend service bootstraps and runs under `backend/app/`
2. read-side APIs exist for overview, inventory, actor detail, campaign detail, scene detail, quests, relationships, lorebook, journal, and recent events
3. repository access is abstracted behind a shared interface, with SQLite as the default runtime backend and JSON kept as a parity reference
4. command parsing and execution are implemented for the current backend command set
5. `POST /commands/execute` returns `turn_id`, `mode`, failure summaries, rollback flags, `state_changes`, `refresh_hints`, and stable event records
6. `POST /narration/resolve-turn` executes commands, builds narration context, calls LM Studio, and optionally applies safe extracted updates
7. `resolve-turn` sidecar failures degrade safely: narration falls back to a backend summary, extraction failure becomes advisory `warnings[]`, and already-committed state is still returned
8. `POST /scene/open` and `POST /scene/close` manage active scene replacement, archive writes, summary journaling, durable fact promotion, and scene refresh hints
9. `POST /scene/draft-close-summary` can ask LM Studio for an advisory close-scene draft without mutating canonical state
10. the SillyTavern bridge can dispatch commands, resolve normal turns through the backend, refresh from `refresh_hints`, expose scene lifecycle forms, inspect activated lore, and review extraction proposals
11. regression tests cover command parity, runtime bootstrapping, dry-run behavior, rollback behavior, turn resolution, extraction, scene lifecycle, and draft-summary non-mutation

## Current milestone

The repo is past the scaffold phase. The next milestone is:

**Gameplay Expansion Through Memory And Turn Quality**

## Next milestone work

Sequence the work as:

1. establish a live SillyTavern smoke baseline for the current bridge
2. harden resolve-turn request/reset behavior and context refresh expectations
3. tune lore activation and narration context quality from real play traces
4. deepen extraction-review-to-state workflows for supported categories
5. improve session summary and durable memory quality without changing backend authority rules

## Deferred work

These are still intended, but not part of the current milestone:

1. live sync or WebSocket transport changes
2. non-SillyTavern frontend work
3. heavier analytics, telemetry, or admin tooling
4. any storage redesign beyond the current repository boundary
