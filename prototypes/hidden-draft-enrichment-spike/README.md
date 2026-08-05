# Hidden-draft enrichment model spike

**Throwaway Wayfinder #22 evidence. This is not production narration code.**

## Final result

The hidden-draft rewrite path is a **no-go for v1** on the tested target models.

Measured on the user's 16 GB NVIDIA system through LM Studio:

- `gemma-4-31b-styletune-heretic-ara-i1` passed visible-output readiness, then its initial hidden draft lost the exact dialogue and the closed-wardrobe outcome.
- `mistralai/mistral-nemo-instruct-2407` passed visible-output readiness, then its initial hidden draft also lost that Nera was alone.

The runner stopped before enrichment because revision cannot safely improve a draft that has already changed material story events. This is a decisive architecture result, not an infrastructure failure.

## Architectural consequence

Version 1 uses:

- deterministic preflight Context selection;
- one normal narrator generation;
- atomic final delivery;
- no hidden draft;
- no enrichment revision 1 or revision 2;
- no volatile recovery cache for discarded hidden prose.

Ambiguous entities still select nothing during deterministic Context planning. Context budgets, visibility, pins, and retrieval tiers remain unchanged.

## Original measurement scope

The spike was built to measure whether representative local narrator models could:

- produce visible draft prose;
- preserve material events, exact dialogue, numbers, and outcomes through a full enrichment rewrite;
- incorporate a uniquely resolved Record;
- perform one bounded second revision for a newly introduced unique subject;
- avoid exposing Narrator Secret material;
- skip an ambiguous same-alias entity instead of guessing;
- retain a usable volatile draft when revision fails;
- stay within observable latency and VRAM limits.

Both tested models failed the prerequisite draft-preservation gate, so later rewrite stages were intentionally not executed.

## Run

The harness remains as reproducible evidence:

```powershell
npm run test:enrichment-prototype
npm run prototype:enrichment -- --model "exact-model-id-1" --model "exact-model-id-2"
```

It has no browser UI, automatic retries, model loading, model unloading, profile changes, cryptography, or persisted draft prose. Any failed requirement prints one explicit error and exits nonzero.
