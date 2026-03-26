# 04 — Step by step realization plan

## Phase 1 — prove the loop

Goal: commands update backend state and narration reflects it.

### Task 1
Get the backend and extension talking.

Done when:
- panel refresh works
- `/inventory` returns backend data

### Task 2
Get one mutating command working reliably.

Recommended first:
- `/use_item`

Done when:
- backend mutation is recorded
- panel refreshes
- narration reflects the changed state

### Task 3
Add `/cast`

Done when:
- spell existence is checked
- spell level is checked
- slot is reduced
- result is narrated correctly

## Phase 2 — tighten prompt flow

### Task 4
Inspect injected narration block in generation requests.

Check:
- is it inserted exactly once
- is it inserted before the last user message
- does the model obey it

### Task 5
Trim the narration block format.

Make it:
- compact
- factual
- hard to misread
- easy for any model to obey

## Phase 3 — improve the player UX

### Task 6
Replace raw JSON return blocks for `/inventory` and `/quest` with nicer formatted text.

### Task 7
Add quick buttons in the panel:
- Inventory
- Refresh
- Quest
- Journal
- Rest
- End Scene

### Task 8
Add an action composer:
- command type dropdown
- target input
- execute button

This helps when slash commands are annoying on mobile or in messy sessions.

## Phase 4 — automatic updates from narration

### Task 9
After every AI reply, run a structured extraction pass in LM Studio or the backend.

Only auto-apply:
- item gain/loss
- gold changes
- location changes
- quest progression
- conditions
- scene object changes

Do not blindly auto-apply:
- emotions
- secrets
- inferred relationship shifts
- symbolic interpretations

## Phase 5 — scene/journal maturity

### Task 10
Add explicit scene lifecycle:

- start scene
- active scene
- close scene
- archive summary

### Task 11
Split journals into:
- raw turn log
- scene summaries
- canon facts

## Phase 6 — decide whether to stay in ST

Stay in ST if:
- chat remains the main experience
- panels are enough
- command UX feels good

Move to a custom frontend later if:
- you want full dashboards
- you need deep drag-and-drop inventory
- you want complex map/combat UX
- you want branch-aware timeline management
