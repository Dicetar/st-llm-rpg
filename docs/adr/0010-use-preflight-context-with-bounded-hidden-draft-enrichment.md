# Use preflight context with bounded hidden-draft enrichment

Status: superseded by [ADR 0018](./0018-use-one-companion-one-writer-and-one-model-call.md).

This ADR records the former provisional decision to test an ephemeral hidden Narration Draft followed by bounded enrichment rewrites. Wayfinder #22 measured that approach on the target 16 GB system and found that both representative models changed material events in the initial hidden draft before enrichment began.

Version 1 therefore does not implement this workflow. Hidden narration drafts, enrichment revisions, model-driven discovery from hidden prose, and recovery caches containing discarded prose are historical prototype evidence only.

The retained parts of this decision are deterministic preflight Context, complete ordered manual pins, fail-before-inference budget enforcement, Narrator Visibility, no narrator tools, and atomic linked delivery. The current binding decision is ADR 0018: one deterministic preflight Context Plan and one narrator model call.
