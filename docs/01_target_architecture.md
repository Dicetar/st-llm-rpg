# 01 — Target Architecture

## High-level flow

```text
User in SillyTavern
    -> slash commands / natural language input
    -> ST extension packages request
    -> backend executes commands against DB
    -> backend writes event log
    -> backend builds narration context
    -> LM Studio generates narration
    -> LM Studio optionally emits structured post-turn updates
    -> backend validates safe updates
    -> backend commits accepted updates
    -> ST extension refreshes panels
```

## Main subsystems

### 1. Frontend layer: SillyTavern extension
Responsibilities:
- register slash commands
- show side panels: inventory, scene, quests, relationships, journal
- send command requests to backend
- show success/failure feedback
- inject validated execution summaries into the chat flow
- trigger panel refresh after each turn

### 2. Backend layer: FastAPI service
Responsibilities:
- parse and execute command batches
- validate resources and preconditions
- read/write SQLite
- append event log records
- manage scene lifecycle
- generate compact state views for the frontend
- call LM Studio for narration and extraction

### 3. Model layer: LM Studio
Responsibilities:
- narrative output
- structured extraction of factual changes from narration
- scene summary generation

### 4. Data layer: SQLite + append-only log
Responsibilities:
- canonical entities and state
- durable audit history
- easy querying for panels and debugging

## Non-negotiable boundaries
- the model never directly rewrites full state blobs
- the extension never mutates canonical state locally as source of truth
- every mutation becomes an event
- command failures are explicit and narratable
- scene state is temporary; scene archive is permanent
