# 04 - Bridge roadmap status

This doc is now a status marker, not a future build recipe.

## Completed bridge phases

The repo has already moved past the original prove-the-loop work:

- backend and extension talk reliably
- read commands refresh backend state into panels
- mutating commands return authoritative action output
- pending narration injection exists for command-only flows
- full-turn narration works through `/rpg_resolve` and optional backend-resolved normal turns
- scene lifecycle controls, lorebook inspection, session summaries, activated lore, and extraction review are all present in the bridge

## Current milestone

The next bridge milestone is **Memory And Turn Quality**:

1. establish a repeatable live SillyTavern smoke baseline
2. harden request reset and context refresh behavior around slow or canceled `resolve-turn` calls
3. tune lore activation and narration quality from real play traces
4. deepen extraction-review-to-state workflows for supported categories
5. improve session summary and durable memory quality without moving authority into the frontend

## Rules for continuation

- keep the bridge thin
- keep backend contracts stable and additive
- avoid local truth drift
- treat new UI affordances as views or command launchers, not as game-rule owners
