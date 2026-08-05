# Hidden-draft enrichment model spike

**Throwaway Wayfinder #22 evidence. This is not production narration code.**

## Purpose

Measure whether representative local narrator models on the target 16 GB NVIDIA system can:

- produce visible draft prose;
- preserve material events, exact dialogue, numbers, and outcomes through a full enrichment rewrite;
- incorporate a uniquely resolved Record;
- perform one bounded second revision for a newly introduced unique subject;
- avoid exposing Narrator Secret material;
- skip an ambiguous same-alias entity instead of guessing;
- retain a usable volatile draft when revision fails;
- stay within observable latency and VRAM limits.

The runner uses LM Studio's OpenAI-compatible `GET /v1/models` and `POST /v1/chat/completions` endpoints. It runs models sequentially and samples `nvidia-smi` during each request.

## Deliberately simple behavior

- No browser UI.
- No automatic retries.
- No automatic model loading, unloading, or profile changes.
- No cryptography or generated identifiers.
- No raw draft or revision prose is written to disk.
- Any failed requirement prints one explicit error and exits nonzero after writing the bounded summary when possible.

## Run

LM Studio must already be serving at `http://127.0.0.1:1234` and the selected models must be visible to its server.

First run the pure checks:

```powershell
npm run test:enrichment-prototype
```

To see the exact model IDs available from LM Studio, run without model arguments. The command intentionally exits with an error that lists them:

```powershell
npm run prototype:enrichment
```

Then run two representative models by exact ID:

```powershell
npm run prototype:enrichment -- --model "exact-model-id-1" --model "exact-model-id-2"
```

Optional overrides:

```text
--base-url http://127.0.0.1:1234
--timeout-ms 180000
--max-tokens 512
```

The runner makes four calls per model: visible-output readiness, hidden draft, revision 1, and revision 2. It does not retry a failed call.

## Result

The bounded result is written to:

```text
.runtime/enrichment-spike/latest.json
```

It contains model IDs, check results, token usage when supplied by LM Studio, latency, peak sampled VRAM, ambiguity/recovery results, and model-specific verdicts. It contains no prompt, draft, revision, Campaign prose, or secret text.

A model failure is a valid model-specific `no-go` result. The error states the exact failed stage or preservation check. Wayfinder #22 should compare at least two representative models before closing.
