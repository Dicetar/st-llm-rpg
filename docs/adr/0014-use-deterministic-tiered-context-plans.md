# Use deterministic tiered Context Plans

Status: accepted.

Narrator context is produced by one read-only Context Module as an inspectable `ContextPlan` pinned to exact Campaign, Binding, and Context Focus revisions. Required core state and ordered per-binding manual pins are followed by unique exact mentions, current-Scene anchors, lexically qualified FTS5 results, optional reviewed-profile vector results, and one bounded relation hop. The tiers are strict precedence rather than one blended score. Ambiguous textual identities select no Record, and manual pins block generation rather than being silently truncated.

Narrator Visibility is enforced before indexing and retrieval: Known material may be revealed, Narrator Secret material is isolated and may influence narration without direct disclosure, and Campaign Private material never enters narrator search documents, embeddings, plans, prompts, or operational diagnostics. Context renders versioned curated narrator views and human-reviewed summaries rather than raw Record JSON.

Linked narration uses an ephemeral hidden draft, then at most two full enrichment revisions. A second revision is allowed only to repair preservation failure or enrich one newly introduced uniquely resolvable subject. Drafts, candidates, plans, and recovery text remain volatile; failed enrichment offers explicit Retry or Use unenhanced draft actions and never falls back or retries automatically. Exact LM Studio model profiles own serialization, placement, token capacity, readiness, and optional embedding thresholds; the unscreened fallback is plain-labelled with vectors disabled.

See [Context Focus retrieval and hidden-draft enrichment](../design/context-focus-retrieval-and-enrichment.md). This refines ADR [0010](./0010-use-preflight-context-with-bounded-hidden-draft-enrichment.md) without changing its authority, visibility, human-recovery, atomic-delivery, or two-revision invariants.
