# Use additive JSON addons for external authoring

Externally authored Campaign content uses typed JSON addons with stable External IDs, bundled during installation and synchronized through one revision-checked Campaign Operation. Synchronization upserts entries but never deletes missing rows, authors cannot import Events, Scene Archives, or Proposals, and exactly one optional Current Scene may be supplied; this preserves audit/lifecycle invariants while allowing bulk editing outside SillyTavern without treating chat JSONL or World Info as a database.
