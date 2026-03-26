# 03 — How the bridge works

## Core rule

**SillyTavern does not own canonical mutable state.**

The extension is only the chat/UI shell.

Your backend owns:

- inventory
- spell slots
- HP/resource changes
- quest state
- journal persistence
- event log
- scene state

## Turn flow

### Non-mutating command
Example:

`/inventory`

Flow:

1. extension calls backend read endpoint
2. backend returns authoritative snapshot
3. extension renders panel and returns a prompt-safe summary block

### Mutating command
Example:

`/cast suggestion`

Flow:

1. extension sends raw command text to backend
2. backend validates the command
3. backend mutates state
4. backend returns:
   - parsed commands
   - per-command results
   - mutations
   - post-command overview
   - narration context
5. extension stores a pending narration block in chat metadata
6. on the next generation, the interceptor injects that block
7. the model narrates the consequences

## Why this is the correct split

If the browser extension directly mutates canonical state, swipes, reloads, and prompt-side hallucinations will eventually desync your game.

By keeping the backend authoritative, you get:

- rollback potential
- event history
- deterministic validation
- easier testing
- future SQLite migration without rewriting the UI

## What the interceptor does

The interceptor exists so you do not have to manually copy command results into the prompt each turn.

Its job is tiny:

- look for pending narration data
- inject it before generation
- clear it after injection

That keeps the prompt grounded while avoiding duplicate injections.
