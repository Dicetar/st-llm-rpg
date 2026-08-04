# Use SQLite as Campaign authority and accepted-event history

Status: accepted.

The local companion stores canonical Campaign state in SQLite. Every accepted Campaign Operation atomically creates its Campaign Revision and immutable Campaign Event; JSON remains an explicit import, export, addon, and backup format, never a silently synchronized second authority. This adds migrations and recovery work but gives multi-tab concurrency, revision reconstruction, branches, reviewed imports, and automatic backups one transactional source of truth.

This supersedes the chat-metadata persistence envelope in [Canonical Campaign Model v1](../design/campaign-model-v1.md) and the metadata durability responsibility implied by [ADR 0002](./0002-route-all-changes-through-the-campaign-session.md), while preserving ADR 0002's rule that every caller uses typed Campaign Operations through one mutation authority. It refines [ADR 0005](./0005-use-additive-json-addons.md): changed addon files produce an import diff, and only an explicit user action applies that diff as one accepted Operation batch. Exact schema, snapshots, migrations, retention, and backup mechanics remain separate design decisions.
