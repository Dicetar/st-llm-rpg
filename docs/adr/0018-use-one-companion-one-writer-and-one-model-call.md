# Use one companion, one SQLite writer, and one narrator model call

Status: accepted.

Version 1 is one pinned Node 24 companion process at `:8002` beside pinned SillyTavern at `:8001` and external LM Studio at `:1234`. The companion owns SQLite Campaign truth, Workspace, deterministic Context, narrator proxy, worker jobs, addon reconciliation, backup/restore, and health. One visible supervisor owns SillyTavern and the companion and observes LM Studio without controlling unrelated processes.

Campaign authority uses one SQLite writer behind Campaign Journal. Interactive commits remain short and atomic. Heavy verification, replay, snapshot/FTS rebuild, import analysis, and backup validation execute off the event-loop path, then commit through the same writer. Additional Journal work moves off the event loop when target-machine measurements exceed 25 ms p95 across 100 executions or 100 ms for one normal interactive execution.

Narration uses one deterministic preflight Context plan and one LM Studio Chat Completions request. Linked output is fully buffered and delivered atomically. There are no hidden drafts, enrichment revisions, hidden-prose recovery caches, automatic retries, or narrator tools. Unlinked traffic remains a transparent single upstream call; malformed routing never defaults to unlinked.

Context uses required core, ordered pins, unique exact mentions, Scene anchors, qualified FTS5, and one bounded relation hop. Ambiguous identities select nothing. Narrator Visibility is applied before indexing and retrieval. Vectors remain disabled until separately measured thresholds, latency, memory cost, and degradation behavior justify them.

One inference lane serves Narration and Worker Jobs. Narration has queue priority and may cancel active cancellable worker inference. Version 1 uses models already exposed by LM Studio and does not automatically load, unload, or swap models.

The existing fallback extension remains through a verified real-device cutover. Migration is previewed, fingerprinted, backed up, and non-destructive. Returning to fallback after companion-only Events is explicitly divergent rather than a reverse migration.

See [Final companion architecture and verification seams](../design/final-companion-architecture-and-verification.md). This ADR supersedes earlier provisional text where it selected hidden-draft enrichment, vector retrieval as enabled behavior, automatic model swapping, or recovery caches for hidden prose.