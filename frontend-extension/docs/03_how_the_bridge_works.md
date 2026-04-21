# 03 - How the bridge works

## Core rule

**SillyTavern does not own canonical mutable state.**

The extension is the chat and UI shell only.
It now binds one backend save namespace per ST chat, using the current chat title as the default save name the first time that chat uses the bridge.

Your backend owns:

- inventory
- equipment
- spell slots and resources
- conditions
- quest state
- relationship state
- journal persistence
- event log
- scene state and scene archive

## Read command flow

Example:

`/inventory`

1. the extension calls a backend read endpoint
2. the backend returns an authoritative snapshot
3. the extension refreshes the relevant panel and returns a prompt-safe summary block

All backend requests include the current chat's `save_id`, so one ST chat no longer leaks scene, journal, event, or inventory state into another unless you intentionally point them at the same save.

## Mutation command flow

Example:

`/cast [suggestion]`

1. the extension sends raw command text to `POST /commands/execute`
2. the backend validates the command and mutates canonical state
3. the backend returns parsed commands, per-command results, mutations, overview, refresh hints, and narration context
4. the extension refreshes affected panels from backend state
5. the extension stores a pending narration block in chat metadata
6. on the next generation, the interceptor injects that block once and clears it

## Resolve-turn flow

Example:

`/rpg_resolve I inspect the desk and watch her reaction.`

1. the extension sends text and recent chat context to `POST /narration/resolve-turn`
2. the backend executes embedded commands first
3. the backend activates bounded lore context and optionally runs safe extraction
4. the extension appends narrated prose from the authoritative turn response
5. the extension updates `Activated Lore`, `Extraction Review`, and affected panels from backend data

## Extraction review flow

When extraction is enabled:

- proposed, applied, staged, and warning entries are stored in chat metadata
- supported review actions create a fresh authoritative backend turn
- handled entries are hidden from the live queue until the next resolved turn

## Session catch-up flow

For older chats that predate backend memory capture:

- use `Summarize & Fill` in `Session Summary` or `/session_summary_draft [optional instructions]`
- the bridge sends a bounded transcript from the current ST chat plus the current chat title
- the backend drafts a summary and durable facts without mutating journal, lorebook, events, or scene state
- you review the filled form and choose whether to commit it with `Save Summary`

This is the safe catch-up path for ongoing roleplay that started before the current memory workflow existed.

## Why this split is correct

Keeping the backend authoritative gives you:

- rollback behavior
- event history
- deterministic validation
- easier tests
- a stable SQLite-backed runtime without moving game rules into the browser

## What the interceptor does

The interceptor has two small jobs:

- inject pending narration context for slash-command turns
- optionally route normal non-slash turns through `POST /narration/resolve-turn`

It is not a local rules engine.
