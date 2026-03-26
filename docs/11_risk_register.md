# 11 — Risk Register

## Risk 1 — model narrates impossible outcomes
Mitigation:
- always include authoritative command results in narration context
- never let narration mutate state directly

## Risk 2 — ST extension becomes source of truth
Mitigation:
- backend remains authoritative
- extension only reads and submits commands

## Risk 3 — extractor invents facts
Mitigation:
- validate extracted updates
- auto-apply only safe categories
- stage ambiguous changes for review

## Risk 4 — schema churn too early
Mitigation:
- start with a minimal stable domain model
- keep repository boundary small

## Risk 5 — project grows beyond ST comfort zone
Mitigation:
- keep backend contract frontend-agnostic
- allow later migration to a custom frontend without rewriting the engine
