# Use durable Worker Jobs with atomic human review finalization

Status: accepted provisionally and logic-proven by Wayfinder #24. Live LM Studio timing and cancellation evidence remain required before Wayfinder #26 fixes the final execution policy.

Story Sync runs as a durable, per-Chat-Binding Worker Job over one bounded fingerprinted source snapshot. Worker Jobs receives Campaign read capability but never Campaign mutation capability. Model output becomes editable Proposals; a person decides every Proposal and explicitly finalizes the review. Accepted Proposal operations form one atomic Campaign batch, and the same authority transaction advances that binding's Sync Boundary. Stale source, Campaign, Binding, Proposal, or validation evidence changes neither history.

One internal inference lane gives narration strict priority. Active worker inference may be aborted and requeued; user cancellation and host restart require explicit evidence-checked Resume. Narrator and worker models load sequentially through reviewed profiles, with at most one companion-managed model instance resident on the 16 GB target. Worker source and raw output persist only while unresolved and are pruned after successful authority reconciliation.

This replaces the fallback's browser-owned Connection Manager worker, sequential per-Proposal application, and automatic boundary completion while retaining conservative extraction, one bounded repair, stale-source rejection, editable review, and no automatic Campaign mutation. Full rationale, interfaces, persistence, state machines, Problems, and prototype evidence are in [Story Sync and model-job orchestration](../design/story-sync-and-model-jobs.md).
