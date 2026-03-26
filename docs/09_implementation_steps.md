# 09 — Step-by-Step Implementation Guide

## Phase 0 — Workspace setup
1. Create repository root.
2. Add the folder layout from `02_repository_layout.md`.
3. Copy these docs into `docs/`.
4. Add your current campaign source files into `campaigns/example_campaign/imports/`.

Deliverable:
- clean repository with docs and empty app skeletons

## Phase 1 — Backend skeleton
1. Create FastAPI app structure under `backend/app/`.
2. Add health endpoint.
3. Add SQLite connection layer.
4. Add migration system.
5. Add base models for actor, inventory, quest, relationship, scene, journal, event log.

Deliverable:
- backend boots and connects to SQLite

## Phase 2 — Read-side APIs
1. Implement `GET /state/overview`.
2. Implement `GET /scene/current`.
3. Implement `GET /inventory/{actor_id}`.
4. Implement `GET /quests`.
5. Implement `GET /relationships/{actor_id}`.

Deliverable:
- frontend can render panels from real backend data

## Phase 3 — Command engine v1
1. Create command parser.
2. Implement command registry.
3. Implement `/inventory`.
4. Implement `/use_item`.
5. Implement `/equip` and `/unequip`.
6. Implement `/cast`.
7. Add event logging for each mutation.

Deliverable:
- deterministic command execution against real DB

## Phase 4 — LM Studio turn resolution
1. Add narrator prompt.
2. Add backend client for LM Studio.
3. Build narration context generator.
4. Implement `POST /narration/resolve-turn`.
5. Return prose + applied changes + refresh hints.

Deliverable:
- one endpoint can resolve a full turn

## Phase 5 — Extraction and safe auto-updates
1. Add extractor prompt.
2. Define update schema.
3. Validate extracted updates.
4. Auto-apply only safe categories.
5. Log extracted vs. applied changes separately.

Deliverable:
- narration can add items, facts, or quest progress safely

## Phase 6 — SillyTavern extension v1
1. Create extension shell.
2. Add side panel frame.
3. Add slash commands wired to backend.
4. Add panel refresh after turn commit.
5. Add basic error display.

Deliverable:
- usable end-to-end prototype in ST

## Phase 7 — Journaling and scene archive
1. Add turn journal entries.
2. Add `POST /scene/close`.
3. Add scene archive storage.
4. Add Journal panel.
5. Add scene history retrieval.

Deliverable:
- long-session continuity becomes reliable

## Phase 8 — Quality pass
1. Add tests for command failures.
2. Add tests for resource accounting.
3. Add tests for inventory consistency.
4. Add tests for scene close/open transitions.
5. Add tests for extractor false positives.

Deliverable:
- stable prototype instead of fragile demo

## What to implement first this week
- backend skeleton
- overview + inventory + scene reads
- `/use_item`
- `/cast`
- event log
- single resolve-turn flow
