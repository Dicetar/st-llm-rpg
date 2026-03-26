# 04 — Command Engine

## Goal
Implement slash commands as deterministic operations against the authoritative state.

## Command categories

### Read commands
These do not mutate state.
Examples:
- `/inventory`
- `/quests`
- `/journal`
- `/scene`
- `/sheet`

### Mutation commands
These attempt to change state.
Examples:
- `/use_item health potion`
- `/equip iron sword`
- `/unequip shield`
- `/cast suggestion`
- `/use_skill persuasion`
- `/rest short`
- `/move north`

## Batch command execution
A single player message may include multiple commands.

Recommended policy:
- parse all commands in order
- execute them left to right
- commit each successful command independently
- include failures in the final execution report
- narrate the combined result

## Command lifecycle
1. Parse input into normalized command objects.
2. Validate input shape.
3. Load relevant actor/scene/resource state.
4. Check command-specific preconditions.
5. Build mutation plan.
6. Apply mutation plan in a transaction.
7. Write event log entry.
8. Return command result to caller.
9. Build narration context.

## Example: `/use_item health potion`
Checks:
- item exists in actor inventory
- quantity > 0
- item is usable in current context

Effects:
- subtract 1 quantity
- apply healing or relevant effect
- append event log
- expose result to narration layer

## Example: `/cast suggestion`
Checks:
- spell exists for actor
- actor can currently cast
- appropriate spell slot is available
- scene has a valid target or target-selection step

Effects:
- reserve/spend slot
- record cast event
- attach cast metadata to narration context

## Recommended first command set
Implement only these first:
- `/inventory`
- `/use_item`
- `/equip`
- `/unequip`
- `/cast`
- `/quests`
- `/scene`
- `/journal`

## Failure design
Every failure must be machine-readable.

Examples:
- `ITEM_NOT_FOUND`
- `ITEM_QUANTITY_ZERO`
- `SPELL_UNKNOWN`
- `SPELL_SLOT_UNAVAILABLE`
- `INVALID_TARGET`
- `COMMAND_NOT_ALLOWED_IN_SCENE`

The narrator should receive the failure reason in plain language so it can respond naturally.
