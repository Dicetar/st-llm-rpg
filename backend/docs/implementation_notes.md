# Implementation Notes

## Why this version uses JSON files instead of SQLite

This is the fastest way to produce a runnable, inspectable backend skeleton without locking you into a premature schema.
The repository boundary is deliberately small:
- load state
- save state
- append event
- append journal

That lets you replace the file repository with SQLite in the next phase while keeping:
- route shapes
- command engine
- response contracts

## Backend responsibilities

The backend is authoritative for:
- inventory quantities
- spell slot spending
- equipment state
- quest reads
- current scene reads
- event log
- journal entries

The backend is not yet authoritative for:
- dice resolution
- initiative/combat turns
- AI-generated post-turn updates
- relationship deltas inferred from prose

## ST integration shape

SillyTavern should not mutate backend state directly in the browser.
The ST extension should:
1. capture slash commands or a player text block
2. call `POST /commands/execute`
3. send `narration_context` to LM Studio
4. render the final narration after the state mutation already succeeded or failed

## Contract rule

No narration should claim a potion was used, a spell was cast, or an item was gained unless the backend already accepted the mutation.
