# 12 - Migration From Current Files

## Historical note

This document is retained as provenance, not as an active migration plan.

The original prototype was seeded from older campaign files such as:

- `campaign_state.json`
- `Core-Cast.md`
- related lore, style, or campaign reference files

That initial migration work is no longer the current source of truth.

## Current source of truth

The repo now treats these as authoritative:

- tracked seed data under `backend/data/seed/`
- runtime state under `backend/runtime/`
- backend contracts and tests under `backend/app/` and `backend/tests/`

## Rule for future imports

If older campaign material needs to be imported again, do it as an explicit seed migration or one-off import script checked into the repo.

Do not treat legacy raw files as live state.
Do not restore them directly over runtime state.
