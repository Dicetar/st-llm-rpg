# 06 — SillyTavern Integration Plan

## Recommendation
Build a **thin** ST extension.
Do not put canonical business logic into the extension.

## What the extension should do
- register slash commands
- call backend endpoints
- render side panels
- display command validation results
- submit narration context to the current chat flow
- refresh panels after each committed turn

## Suggested extension panels
### 1. Overview panel
Show:
- current scene title/location
- current actor summary
- active quests count
- key resource pools

### 2. Inventory panel
Show:
- items
- equipment
- currency
- quick actions for use/equip/unequip

### 3. Scene panel
Show:
- participants
- notable objects
- exits
- active hazards
- pending checks

### 4. Quests panel
Show:
- active quests
- current stage
- important notes

### 5. Relationships panel
Show:
- top actors
- trust/affection/fear/respect/leverage
- recent changes

### 6. Journal panel
Show:
- recent turn log
- scene summaries
- major discoveries

## Slash command strategy
Register only a minimal set first:
- `/inventory`
- `/use_item`
- `/equip`
- `/unequip`
- `/cast`
- `/quest`
- `/journal`
- `/scene`
- `/refresh_state`

## Important rule
The extension should **never** decide by itself whether a potion exists, a slot remains, or an item was gained.
It asks the backend.
