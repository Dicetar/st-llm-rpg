# Use deterministic tiered Context Plans

Status: accepted; amended by Wayfinder #22.

Narrator context is produced by one read-only Context Module as an inspectable `ContextPlan` pinned to exact Campaign, Binding, and Context Focus revisions. Required core state and ordered per-binding manual pins are followed by unique exact mentions, current-Scene anchors, lexically qualified FTS5 results, optional reviewed-profile vector results, and one bounded relation hop. The tiers are strict precedence rather than one blended score. Ambiguous textual identities select no Record, and manual pins block generation rather than being silently truncated.

Narrator Visibility is enforced before indexing and retrieval: Known material may be revealed, Narrator Secret material is isolated and may influence narration without direct disclosure, and Campaign Private material never enters narrator search documents, embeddings, plans, prompts, or operational diagnostics. Context renders versioned curated narrator views and human-reviewed summaries rather than raw Record JSON.

Wayfinder #22 tested hidden-draft rewriting on the target 16 GB system with `gemma-4-31b-styletune-heretic-ara-i1` and `mistralai/mistral-nemo-instruct-2407`. Both passed visible-output readiness but changed material events in the initial hidden draft before enrichment began. Gemma lost exact dialogue and the closed outcome; Mistral Nemo additionally lost that the protagonist was alone.

Therefore v1 performs one narrator generation from the original SillyTavern messages plus deterministic preflight Context. The complete visible reply is buffered and delivered atomically. V1 does not use hidden drafts, model-driven enrichment discovery, full rewrite revisions, or volatile recovery caches containing discarded prose.

Exact LM Studio model profiles still own serialization, placement, token capacity, readiness, and optional embedding thresholds; the unscreened fallback is plain-labelled with vectors disabled.

See [Context Focus retrieval and narration context](../design/context-focus-retrieval-and-enrichment.md). Hidden-draft and two-revision behavior remains historical prototype evidence only and must not return without new measured evidence and a separate accepted ADR.
