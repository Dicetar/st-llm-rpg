# 12 — Migration From Current Files

## Current authority choices
You decided:
- `campaign_state.json` is the superior live-state source
- `Core-Cast.md` is the superior cast-definition source

## How to migrate them

### 1. `campaign_state.json`
Use as source for:
- active quests
- relationships
- major events
- known facts
- plot flags
- faction standings
- current arc

This should become backend seed data and/or first DB import.

### 2. `Core-Cast.md`
Use as source for:
- machine-readable cast registry
- actor definitions
- narrative pressure metadata
- frontend actor panels
- retrieval identity map

This should become a normalized `cast_registry` file/table.

### 3. style/spec/bible files
Use as source for:
- lorebook/data bank content
- narrator prompt supplements
- retrieval memory
- campaign canon docs

### 4. current scene and character state JSON
Use selectively.
Keep only gameplay-safe and structurally relevant parts for the first backend version.
Do not dump raw messy state directly into the engine without normalization.

## Migration order
1. cast registry
2. campaign state seed
3. item/resource/inventory seed
4. active scene seed
5. journal/event history if needed
