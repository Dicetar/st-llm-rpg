# 08 — Journaling and Scene State

## Separate these concerns

### 1. Active scene state
Volatile information needed right now.
Examples:
- current location
- who is present
- what objects are interactable
- exits
- hazards
- pending checks
- current tension

### 2. Scene archive
A closed scene snapshot.
Examples:
- summary
- who was present
- what changed
- what was gained/lost
- what hooks remain open

### 3. Journal
Longer-term memory and retrieval layer.

Split journal into:
- `turn_raw`
- `scene_summary`
- `canon_fact`
- `quest_update`
- `relationship_note`

## Best practice
Only one active scene should exist at a time.
When it ends:
1. archive it
2. summarize it
3. promote durable facts to journal/canon
4. open the next scene

## Auto-update caution
It is usually safe to auto-apply:
- item gain/loss
- quest stage progression
- location changes
- condition changes
- visible object changes

It is not usually safe to auto-apply:
- emotional interpretations
- inferred motives
- subtle relationship drift
- symbolic meaning

Those should be staged as proposals.
