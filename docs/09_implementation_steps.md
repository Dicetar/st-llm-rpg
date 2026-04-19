# 09 - Implementation Status And Next Steps

## Completed prototype work

The following phases are already represented in the repo:

1. backend service bootstraps and runs under `backend/app/`
2. read-side APIs exist for overview, inventory, actor detail, campaign detail, scene detail, quests, lorebook, journal, and recent events
3. repository access is abstracted behind a shared interface, with SQLite as the default runtime backend and JSON kept as a parity reference
4. command parsing and execution are implemented for the current prototype command set
5. `POST /commands/execute` now returns `turn_id`, `mode`, failure summaries, rollback flags, `state_changes`, `refresh_hints`, and stable event records
6. `POST /narration/resolve-turn` executes commands, builds narration context, calls LM Studio, and optionally applies safe extracted updates
7. `resolve-turn` sidecar failures now degrade safely: narration falls back to a backend summary, extraction failure becomes advisory `warnings[]`, and already-committed state is still returned
8. `POST /scene/open` and `POST /scene/close` now manage active scene replacement, archive writes, summary journaling, durable fact promotion, and scene refresh hints
9. `POST /scene/draft-close-summary` can ask LM Studio for an advisory close-scene draft without mutating canonical state
10. the SillyTavern bridge can dispatch commands, resolve normal turns through the backend, refresh from `refresh_hints`, expose scene lifecycle forms, and inject pending narration context
11. regression tests cover command parity, dry-run behavior, turn resolution, extraction, scene lifecycle, and draft-summary non-mutation

## Current milestone

The repo is now in a stabilization phase, not a scaffold phase.

Current priorities:

1. preserve the command-first architecture
2. keep the backend contract stable while broadening command coverage
3. verify the split frontend bridge in a live SillyTavern session
4. keep tests and docs aligned with the real runtime behavior

## Next milestone work

The next concrete build target is hardening and extension validation:

1. complete a live frontend smoke pass against the resolve-turn path, rollback mode, and inspector refresh flow
2. tighten LM Studio prompt behavior without shifting authority away from the backend
3. keep scene and journal affordances continuation-safe as frontend behavior expands
4. continue strengthening extraction edge cases from real model output

## Deferred work

These are still intended, but not part of the current cleanup pass:

1. live sync or WebSocket transport changes
2. non-SillyTavern frontend work
3. heavier analytics, telemetry, or admin tooling
4. any storage redesign beyond the current repository boundary
