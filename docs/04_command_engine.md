# 04 - Command Engine

## Current role

The command engine is the authoritative slash-command executor behind:

- `POST /commands/execute`
- the command-execution phase inside `POST /narration/resolve-turn`

Its job is to parse or accept explicit commands, validate them against backend state, mutate a working repository, emit stable turn results, and return narration-safe summaries.

## Read commands

These do not mutate canonical state:

- `/inventory`
- `/quest` and `/quests`
- `/journal`
- `/lorebook`
- `/actor`
- `/campaign`
- `/scene`
- `/relationships` and `/relationship`

## Mutation commands

These mutate canonical state through the backend contract:

- `/use_item`
- `/cast`
- `/equip`
- `/condition`
- `/quest_update`
- `/relationship_note`
- `/scene_move`
- `/scene_object`
- `/scene_clue`
- `/scene_hazard`
- `/scene_discovery`
- `/new`
- `/new_item`
- `/new_spell`
- `/new_custom_skill`

Scene lifecycle endpoint wrappers such as `/scene_open`, `/scene_close`, and `/scene_draft_close` are frontend bridge commands. They are not part of the core command-engine mutation surface.

## Execution model

1. parse mixed text or accept explicit command objects
2. execute commands left to right in a working repository
3. record stable event entries for attempted commands
4. build `results[]`, `state_changes[]`, `refresh_hints[]`, and `overview`
5. commit, dry-run, or roll back based on `mode` and `failure_policy`
6. return `narration_context` built from authoritative backend state

## Failure model

- every command result includes `ok`, `message`, and `error_code`
- `best_effort` commits successful mutations even if another command fails
- `rollback_on_failure` discards all mutations if any command in the turn fails
- mixed prose can contain backend commands and ordinary narration, but frontend-only wrapper commands are stripped before backend execution

## Continuation rules

- keep new commands additive to the current contract
- keep backend validation authoritative
- do not move game-rule logic into the extension
