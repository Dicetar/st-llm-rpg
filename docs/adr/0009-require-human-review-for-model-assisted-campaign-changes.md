# Require human review for model-assisted Campaign changes

Status: accepted.

Story Sync and other model-assisted analysis may create editable, source-linked Proposals but cannot mutate Campaign state, accept Proposals, advance a Sync Boundary, or write chat messages. A person may edit, accept, or reject each Proposal; acceptance uses the ordinary Campaign Operation path and therefore creates the same revision and event history as a manual edit. This preserves a robust workflow with weaker local models at the cost of an explicit Review Inbox step.

This supersedes the companion-specific connection-profile design in [ADR 0003](./0003-use-a-separate-campaign-worker-profile.md) while retaining its safety boundary. The exact worker connection, job persistence, cancellation, and model-swap orchestration remain separate design decisions.
