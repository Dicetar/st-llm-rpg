# Implementation Notes

## Status

This note records the backend shape that exists in the current prototype.
It is not a proposal for a future scaffold.

The backend now uses:
- SQLite runtime storage under `backend/runtime/storage/state.sqlite3`
- backend-authoritative command execution and turn orchestration
- LM Studio narration, extraction, and draft-scene-summary sidecars
- scene lifecycle, journal/session summaries, and lorebook insertion generation

## Backend responsibilities

The backend is authoritative for:
- inventory quantities and item registry metadata
- spell slot spending and command validation
- equipment state and layer shifting
- quest, relationship, and condition updates
- current scene state and scene archive
- journal entries, session summaries, and event history
- lorebook projection and activated lore selection

The backend is intentionally still not authoritative for:
- dice resolution
- initiative/combat turns
- ambiguous prose-only relationship inference
- freeform world modeling outside validated command or extraction rules

## SillyTavern boundary

SillyTavern remains a thin client.
The bridge should:
1. capture user prose, explicit slash commands, or scene workflow actions
2. call backend endpoints such as `POST /commands/execute`, `POST /narration/resolve-turn`, `POST /scene/open`, and `POST /scene/close`
3. render backend-owned state and refresh only the sections indicated by `refresh_hints`

The browser layer should not mutate canonical state directly.

## Contract rule

No narration should claim a command succeeded, a scene changed, or an item was consumed unless the backend already accepted that mutation or explicitly staged it as a proposal.
