# 10 — Test Plan

## Goal
Make the backend trustworthy before the frontend becomes fancy.

## Test categories

### Command parsing
- single command
- multiple commands in one input
- bracketed argument parsing
- malformed command text

### Inventory mutation
- consume existing item
- fail when item missing
- fail when quantity zero
- equip valid item
- reject invalid slot/item

### Spell/resource mutation
- cast known spell with slot available
- fail when slot missing
- fail when spell unknown
- cantrip path without slot spend

### State integrity
- event log entry written for every committed command
- journal write path
- no silent mutations
- overview refresh reflects latest state

### Scene lifecycle
- open scene
- close scene
- archive summary written
- next scene becomes active

### Extraction safety
- objective item gain accepted
- ambiguous emotional interpretation rejected
- quest update accepted only when supported

## Frontend tests later
Once backend is stable, test:
- slash command dispatch
- panel refresh
- error display
- duplicate injection prevention
