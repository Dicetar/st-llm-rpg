# 09 - Implementation Status And Next Steps

## Completed prototype work

The following phases are already represented in the repo:

1. backend service bootstraps and runs under `backend/app/`
2. read-side APIs exist for overview, inventory, actor detail, campaign detail, scene detail, quests, lorebook, journal, and recent events
3. command parsing and execution are implemented for the current prototype command set
4. event logging and journal persistence are live
5. lorebook projection updates run after command execution
6. the SillyTavern bridge can dispatch commands, refresh panels, and inject pending narration context
7. regression tests cover the current backend command loop

## Current milestone

The repo is now in a continuation phase, not a scaffold phase.

Current priorities:

1. preserve the command-first architecture
2. keep runtime mutations out of tracked seed files
3. make the frontend extension easier to continue without changing its behavior
4. document the real workflow instead of the original bootstrap sequence

## Next milestone work

The next concrete build target is backend-driven turn orchestration:

1. add an LM Studio client on the backend
2. build a turn-resolution endpoint that consumes `narration_context`
3. return final prose plus refresh hints to the frontend
4. keep command validation and mutation authoritative on the backend

## Deferred work

These are still intended, but not part of the current cleanup pass:

1. swap the JSON runtime repository for SQLite behind the existing repository boundary
2. add safe extractor-driven post-turn updates
3. expand quest, relationship, and scene lifecycle commands
4. add scene close/archive flow and deeper journaling tools
5. broaden test coverage around multi-command turns and rollback/error paths
