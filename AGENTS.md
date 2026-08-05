# Agent operating rules

Read `docs/agents/development.md` before implementation work. It defines the repository source-of-truth order, current tracer frontier, one-call narration contract, fallback boundary, and evidence requirements.

## Repository workflow

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage workflow labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context domain-documentation layout. See `docs/agents/domain.md`.

### Normative implementation sources

- `docs/spec/companion-v1-specification.md`
- `docs/design/final-companion-architecture-and-verification.md`
- `docs/spec/implementation-tracer-plan.md`
- `CONTEXT.md`

The specification and final architecture supersede conflicting provisional text. V1 uses one deterministic preflight Context Plan and one narrator model call. Do not implement hidden narration drafts, enrichment rewrites, narrator tools, automatic narrator retries, vectors, or automatic model management.

## SillyTavern mobile UI invariants

- Use `SillyTavern.getContext().Popup` for modal tool surfaces in the fallback. Do not add competing fixed-position body overlays for nested workflows.
- Keep the owning Workspace mounted while a modal subworkflow is open; closing the modal must reveal the same Workspace state.
- Do not coordinate UI navigation through cancelable cross-extension DOM events, arbitrary delays, or `z-index` escalation.
- A source surface must never close merely because another component acknowledged a request. The destination must be owned by the same controller or opened synchronously through SillyTavern's native modal layer.
- Run `node prototypes/st-worker-routing-spike/check-native-popup-surface.mjs` after changing fallback Workspace or Story Sync navigation.
- Mobile UI is not accepted from emulation alone. Verify the affected workflow on the real phone at roughly 360 CSS pixels before declaring it fixed.
