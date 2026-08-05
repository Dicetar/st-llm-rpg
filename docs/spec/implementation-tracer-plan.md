# Companion v1 vertical implementation tracer plan

Status: implementation plan for Wayfinder issue #28.

This plan turns `docs/spec/companion-v1-specification.md` into nine ordered, demoable tracers. Each tracer must leave the repository green, preserve the existing fallback, and produce evidence that a user or operator can observe. Horizontal framework work belongs inside the first vertical slice that needs it; do not create separate storage/UI/retrieval cleanup projects.

## Dependency chain

```text
#32 Boot companion beside fallback
  -> #33 Persist one Campaign through SQLite history
  -> #34 Edit Campaign truth through Campaign Book
  -> #35 Import a legacy chat and create an explicit Binding
  -> #36 Build deterministic Context plans
  -> #37 Route linked narration through one atomic model call
  -> #38 Run durable Story Sync with human finalization
  -> #39 Operate imports, backups, restore, supervisor, and updates
  -> #40 Prove full production cutover
```

The chain is intentionally strict. A later ticket may begin only when its blocker is complete, because each later acceptance trace depends on the preceding production seam rather than a prototype substitute.

## Expand–contract rules

1. Expand the new companion beside `extension/st-rpg-campaign`; do not move or delete fallback behavior during #32–#39.
2. Add production seams only when a vertical tracer exercises them. Avoid prefactoring into empty abstractions.
3. Keep one SQLite writer, one companion process, one inference lane, and one narrator model call.
4. Preserve existing tests while adding focused tests for each tracer. A tracer cannot close with a known broken fallback baseline.
5. Contract old compatibility scaffolding only in #40, and only after the real-device cutover trace proves it is superseded.
6. Never contract preserved legacy chat metadata as part of v1 migration. Returning to fallback after companion-only Events remains explicitly divergent.

## Ticket inventory

### #32 — Boot companion beside fallback with health and wire contracts

Establishes the production repository shape, host lifecycle, Workspace shell, wire package, readiness, degraded mode, and resource baseline without claiming Campaign authority.

### #33 — Persist one Campaign through immutable SQLite history

Introduces Campaign Engine and Campaign Journal with one real create/edit/reconstruct/restart flow, atomic revisions/events, stale-write protection, idempotency, backup, restore, and failure injection.

### #34 — Edit Campaign truth through Campaign Book on desktop and phone

Adds the first full user workflow over canonical authority: task-oriented documents/intents, invalidation, stale-edit recovery, representative Records, and physical Android acceptance.

### #35 — Import a legacy chat into an explicit Campaign binding

Creates the migration boundary: previewed, fingerprinted, non-destructive import into revision-1 Campaign and Binding state while preserving fallback metadata.

### #36 — Build deterministic Context plans with visibility, pins, and FTS5

Implements the preflight-only Context contract: required core, ordered pins, exact/Scene/FTS5/relation retrieval, visibility, ambiguity, token budgets, and Context Tray diagnostics. Vectors remain disabled.

### #37 — Route linked SillyTavern narration through one atomic model call

Replaces the prototype seam with the production bridge/proxy, explicit route envelope, one Context plan, one LM Studio call, full buffering, cancellation, native generation-mode semantics, and real desktop/phone traces.

### #38 — Run durable Story Sync jobs with human-only Campaign finalization

Introduces persisted worker stages, source/boundary fingerprints, narrator-priority inference, editable Proposals, restart behavior, and atomic human finalization without granting workers mutation capability.

### #39 — Operate addon imports, backups, restore, and the visible supervisor

Completes Windows operation: one visible launcher, identity-matched process ownership, degraded LM Studio mode, reviewable addon reconciliation, validated backups/restores, staged updates, smoke checks, and rollback.

### #40 — Prove full production cutover and retire no fallback early

Runs the complete real Campaign and physical-device acceptance trace, records all performance/resource gates, proves fallback/divergence behavior, and makes the only allowed fallback-retirement decision.

## Common closure requirements

Every implementation tracer must:

- reference the normative specification and its direct blocker;
- keep changes on `main` unless the user explicitly requests another workflow;
- include focused automated tests and preserve the fallback baseline suite;
- document the exact command used for verification;
- capture measured evidence when the ticket has latency, memory, Windows, LM Studio, or phone gates;
- throw or return an actionable Problem on failure rather than hiding the condition behind recorder or workflow state;
- close only when its user-visible demo and all acceptance criteria pass.

## Completion definition

Wayfinder implementation planning is complete when #32–#40 exist with blockers, acceptance criteria, `ready-for-agent` labels, and this dependency plan. Product implementation is not complete until #40 closes.