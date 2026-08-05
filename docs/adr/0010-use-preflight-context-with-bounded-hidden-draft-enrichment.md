# Use preflight context with bounded hidden-draft enrichment

Status: accepted.

Narration starts with deterministic, inspectable preflight context and may use an ephemeral hidden Narration Draft to retrieve additional relevant Campaign material before one atomic final reply. Enrichment may rewrite prose but must preserve the draft's material actions, dialogue intent, introduced subjects, and outcomes; hidden drafts never enter chat or Campaign history, the narrator receives no tools, and at most two enrichment revisions are allowed. Manual Context Focus pins are never silently removed; if pins alone exceed the budget, generation pauses for an explicit user choice.

This supersedes the pre-generation-only limitation in [ADR 0006](./0006-route-narrator-context-before-generation.md) while retaining deterministic preflight selection as the default. Narrator Visibility is enforced throughout: Known material may be used and revealed, Narrator Secret material may be used but not directly revealed, and Campaign Private material is never sent. Exact retrieval scoring, embedding choice, budgets, wire format, and model profiles remain separate design decisions.
