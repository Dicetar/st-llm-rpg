# 00 — Architectural Decision

## The decision
Build this project as:
- **SillyTavern UI extension** for user interaction and panels
- **External FastAPI service** for authoritative game state and business logic
- **LM Studio** for narrative generation and structured post-turn extraction

## Why this is the right choice
Your project needs all of the following:
- authoritative inventory and equipment changes
- spell-slot/resource accounting
- command parsing and validation
- scene state updates
- journaling and event history
- automatic factual state updates after narration
- rollback/debug visibility

That is **application logic**, not just prompt engineering.

## What SillyTavern should own
SillyTavern is excellent for:
- chat UX
- slash-command entry points
- side panels
- lorebook / world info / data bank usage
- quick replies
- extension-driven convenience features

## What SillyTavern should not own
Do not make SillyTavern the sole owner of:
- canonical inventory counts
- spell slots
- quest truth
- rollback/audit history
- scene archive truth
- relationship write rules

That belongs in a backend service.

## What the backend should own
- canonical state in SQLite
- command execution
- validation
- event log
- journal and scene archive
- deterministic read APIs
- structured write APIs

## What LM Studio should own
- narrative prose
- structured extraction of proposed updates
- scene summaries
- optional helper reasoning for command explanations

## First principle
**State changes happen first. Narration happens after validated state changes.**
