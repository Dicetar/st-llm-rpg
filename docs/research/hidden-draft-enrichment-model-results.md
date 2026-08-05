# Hidden-draft enrichment model results

Research date: 2026-08-05

## Environment

- Target GPU class: NVIDIA 16 GB VRAM.
- LM Studio base URL: `http://127.0.0.1:1234`.
- GPU preflight at run start: 8,490 / 16,311 MiB used.
- Harness: `prototypes/hidden-draft-enrichment-spike/run.mjs`.
- Automatic retries: disabled.
- Model loading/unloading or profile mutation: disabled.

## Models

### `gemma-4-31b-styletune-heretic-ara-i1`

- Visible-output readiness: passed.
- Hidden draft: failed.
- Failed preservation checks: exact dialogue; wardrobe remained closed.
- Enrichment revisions: not executed because the prerequisite draft was already unsafe.
- Verdict: no-go for hidden-draft rewriting in v1.

### `mistralai/mistral-nemo-instruct-2407`

- Visible-output readiness: passed.
- Hidden draft: failed.
- Failed preservation checks: protagonist alone; exact dialogue; wardrobe remained closed.
- Enrichment revisions: not executed because the prerequisite draft was already unsafe.
- Verdict: no-go for hidden-draft rewriting in v1.

## Architecture decision

Hidden drafts and full rewrite enrichment do not justify their latency and complexity for v1. Both representative models changed material story events before enrichment began.

Version 1 therefore uses deterministic preflight Context selection followed by one narrator generation and atomic delivery. It has no hidden draft, enrichment revision, or volatile recovery cache for discarded hidden prose.

This does not reject deterministic Context retrieval, manual pins, ambiguity skip, visibility enforcement, FTS5, reviewed model profiles, or optional future vector retrieval.
