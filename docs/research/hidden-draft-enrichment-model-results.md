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

## Interpretation

The benchmark intentionally stops before revision when the initial candidate changes a material event. Revision latency and fidelity were therefore not measured for these models; the prerequisite failed first. This is sufficient to reject the proposed hidden-draft rewrite pipeline for v1 because the pipeline requires a usable draft before any enrichment pass can be trusted.

The run does not establish that every future model will fail. It establishes that the tested target workflow is not reliable enough to justify making hidden rewriting part of the first production architecture.

## Architecture decision

Version 1 uses deterministic preflight Context selection followed by one narrator generation and atomic delivery. It has no hidden draft, enrichment revision, or volatile recovery cache for discarded hidden prose.

This does not reject deterministic Context retrieval, manual pins, ambiguity skip, visibility enforcement, FTS5, reviewed model profiles, or optional future vector retrieval.
