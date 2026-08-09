# Development operating rules

This repository has a working fallback extension and an in-progress companion. Agents must not confuse prototype evidence or superseded design text with production implementation.

## Source-of-truth order

For implementation work, read and follow sources in this order:

1. the active GitHub issue and its comments;
2. `docs/spec/companion-v1-specification.md`;
3. `docs/design/final-companion-architecture-and-verification.md`;
4. `CONTEXT.md` for canonical domain vocabulary;
5. accepted ADRs and linked design documents;
6. relevant research and frozen prototype evidence;
7. current implementation and tests;
8. official upstream documentation.

When older provisional material conflicts with the normative specification or final architecture, the normative specification and final architecture win. Repair stale text only when it can misdirect active implementation.

## Current implementation frontier

Issues #32 through #36 are complete. Issue #37 is active. Its production envelope, companion proxy, LM Studio adapter, Context assembly, inference serialization, atomic linked delivery, explicit-unlinked stream, and thin SillyTavern bridge are implemented. Direct live LM Studio and real pinned-SillyTavern desktop generation-mode/Stop/outage traces pass. Finish the physical-phone production trace before closing #37; do not start a later tracer while it remains open. Sanitized desktop evidence is recorded in `docs/evidence/production-narration-desktop-2026-08-09.json`.

Work directly on `main` unless the user explicitly requests another workflow. Claim the active issue before substantive work.

The planning phase is complete. Do not create a new ADR, research note, architecture map, or prototype unless active implementation exposes a genuinely unresolved decision that blocks delivery and requires user review. Existing prototypes are frozen evidence; reproduce them when necessary, but do not extend them.

## V1 narration contract

V1 narration uses:

- one deterministic preflight Context Plan;
- one narrator LM Studio request;
- complete buffering for linked replies;
- atomic delivery to SillyTavern;
- explicit cancellation and actionable failure Problems.

V1 does **not** use hidden narration drafts, enrichment rewrites, narrator tools, automatic narrator retries, vector retrieval, or automatic model loading/unloading. Do not reintroduce those designs from superseded ADRs, prototype code, old branches, or stale prompts.

## Fallback boundary

`extension/st-rpg-campaign` is the working fallback and executable behavior reference. Keep it installed and green until an explicit cutover passes.

The fallback already exposes a Campaign Session boundary through `open`, `query`, `preview`, `execute`, and `subscribe`. Use that seam before introducing another abstraction. Extract one record-kind workflow only when an active companion tracer needs it; do not begin a broad cleanup refactor independently of product delivery.

## Testing cadence

Do not run the full build, typecheck, and test matrix after every edit or small commit.

During active implementation:

- continue through a coherent slice without interrupting it for routine full-suite runs;
- use a narrow syntax check, focused test, or smoke check only when a risky boundary would otherwise let unknown failures accumulate;
- do not ask the user to rerun the full suite for intermediate cleanup commits;
- treat background CI as a safety signal, not as a reason to stop an unfinished coherent slice.

Run verification in bulk at a real milestone boundary, such as:

- completing and closing a tracer;
- finishing the first end-to-end SQLite Campaign workflow;
- completing a migration, backup/restore, narrator-routing, or cutover slice;
- preparing a release or destructive authority transition.

Milestone verification should include the relevant typecheck, production build, full behavioral suite, runtime smoke checks, and any required Windows or physical-phone evidence.

## Evidence rules

- Throw or return a clear actionable error when a requirement fails.
- Preserve enough focused checks during risky implementation to avoid stacking silent corruption or irreversible state defects.
- Mobile acceptance requires the physical Android client near 360 CSS pixels.
- LM Studio/model claims require the actual target machine and named model IDs.
- Prototype results are evidence, not production completion.
- Close an implementation ticket only after its user-visible demo and milestone verification pass.

## Delivery rule

Each implementation session must end in runnable behavior, an executable regression test, or removal of a concrete blocker. Do not create planning artifacts merely to restate accepted decisions. Keep operator documentation proportional to shipped behavior; scaffolding is not a product milestone.
