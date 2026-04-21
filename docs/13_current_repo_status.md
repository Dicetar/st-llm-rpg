# 13 - Current Repository Status

This repository contains a working prototype slice, not a production-complete system.

## Already present

- FastAPI backend with authoritative state reads, command execution, stable turn contracts, lorebook sync, event logging, journal APIs, `resolve-turn`, scene open and close endpoints, and draft-only scene summary support
- SQLite-backed runtime persistence bootstrapped from tracked seed data
- JSON repository retained as a reference implementation for parity testing
- command parser and command handlers for read, mutation, builder, quest, relationship, scene upkeep, and condition commands
- optional rollback-on-failure command policy for atomic multi-command turns
- safe extraction flow that auto-applies only approved categories, skips no-op proposals, and stages unsafe or invalid proposals into events and journal entries with reasons
- non-fatal `resolve-turn` warning handling so narrator or extractor failures no longer hide already-applied backend state behind a hard API failure
- scene archive workflow with summary journaling, durable fact promotion, and LM-drafted close summaries that require user confirmation
- SillyTavern bridge with overview, scene, scene lifecycle controls, inventory, builder tools, quests, relationships, journal, events, lorebook insertions, activated lore, extraction review, inspector views, backend connector, and optional backend-resolved normal turns
- visible-console backend helper scripts, runtime reset helper scripts, and active-extension sync helpers for the local Windows workflow
- regression tests for command parity, dry-run behavior, rollback behavior, turn resolution, extraction, scene lifecycle, draft non-mutation, and mixed-turn failure summaries

## Next milestone

The next milestone is **Gameplay Expansion Through Memory And Turn Quality**:

1. establish a live SillyTavern smoke baseline for the current bridge
2. harden resolve-turn request/reset behavior and context refresh expectations
3. tune lore activation and narration context quality from real play traces
4. deepen extraction-review-to-state workflows for supported categories
5. improve session summary and durable memory quality without changing backend authority rules

## Deferred

- non-SillyTavern frontend work
- live sync or WebSocket transport changes
- storage redesign beyond the current repository boundary
