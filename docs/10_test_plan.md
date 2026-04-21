# 10 - Test Plan

## Goal

Keep the current prototype trustworthy while the next milestone expands Memory And Turn Quality behavior.

## Current automated backend coverage

The backend regression suite should stay green for every roadmap refresh or gameplay-expansion pass:

- runtime bootstrapping from tracked seed data
- JSON and SQLite repository behavior
- command parsing, including mixed prose slash-command parsing
- inventory, spell, equipment, builder, and condition commands
- best-effort and rollback-on-failure turn behavior
- `resolve-turn` orchestration, warning fallback behavior, and recent-chat continuity
- lorebook sync and lore activation
- extraction parsing, safe auto-apply categories, and staged update behavior
- scene lifecycle open, close, archive, and draft-summary non-mutation

Primary command:

```bash
backend\.venv\Scripts\python.exe -m pytest backend\tests -q
```

## Manual SillyTavern baseline

Use `docs/18_frontend_smoke_checklist.md` to verify:

- bridge load and panel rendering
- slash-command dispatch
- resolve-turn narration flow
- activated lore visibility
- extraction review visibility and action handling
- scene lifecycle flows
- session summary and lorebook refresh behavior

## Next validation focus

The next milestone should add or keep validation around:

- visible backend start, stop, reset, and runtime reset helpers
- active extension sync into the real SillyTavern runtime copy
- request-reset behavior after a stuck or canceled `resolve-turn`
- lore activation quality from real play traces
- extraction review actions for supported categories
