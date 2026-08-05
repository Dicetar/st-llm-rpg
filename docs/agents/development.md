# Development operating rules

This repository has a working fallback extension and a planned companion rebuild. Agents must not confuse prototype evidence or superseded design text with production implementation.

## Source-of-truth order

For implementation work, read and follow sources in this order:

1. the active GitHub issue and its comments;
2. `docs/spec/companion-v1-specification.md`;
3. `docs/design/final-companion-architecture-and-verification.md`;
4. `CONTEXT.md` for canonical domain vocabulary;
5. accepted ADRs and linked design documents;
6. relevant research and throwaway prototypes;
7. current implementation and tests;
8. official upstream documentation.

When older provisional material conflicts with the normative specification or final architecture, the normative specification and final architecture win. Record and repair the stale document instead of silently choosing either behavior.

## Current implementation frontier

Companion implementation begins at issue #32 and follows the strict tracer chain in `docs/spec/implementation-tracer-plan.md`.

Work directly on `main` unless the user explicitly requests another workflow. Claim the active issue before substantive work. Do not start a blocked tracer or a later tracer in the same fresh session.

## V1 narration contract

V1 narration uses:

- one deterministic preflight Context Plan;
- one narrator LM Studio request;
- complete buffering for linked replies;
- atomic delivery to SillyTavern;
- explicit cancellation and actionable failure Problems.

V1 does **not** use hidden narration drafts, enrichment rewrites, narrator tools, automatic narrator retries, vector retrieval, or automatic model loading/unloading. Do not reintroduce those designs from superseded ADRs, prototype code, old branches, or stale agent prompts.

## Fallback boundary

`extension/st-rpg-campaign` is the working fallback and executable behavior reference. Keep it installed and green through tracers #32–#39. Do not turn the browser extension into the companion by layering new server authority beneath its monolithic UI.

Extract tested behavior and domain rules where a tracer requires them; do not mechanically port the fallback module structure.

## Evidence rules

- Throw or return a clear actionable error when a requirement fails. Do not build recorder state machines for ordinary validation.
- Run the smallest focused test first, then the full relevant suite.
- Mobile acceptance requires the physical Android client near 360 CSS pixels.
- LM Studio/model claims require the actual target machine and named model IDs.
- Prototype results are evidence, not production completion.
- Close an implementation ticket only after its user-visible demo and every acceptance criterion pass.
