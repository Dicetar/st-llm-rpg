# Migration, launcher, and cutover spike

**THROWAWAY PROTOTYPE.** This directory proves the orchestration rules selected by Wayfinder #25. It is not the production importer, launcher, watcher, updater, or companion.

## Run

```powershell
npm run test:cutover-prototype
npm run prototype:cutover
```

The tests use real temporary files and SQLite to demonstrate:

- previewed import from `chat_metadata.stLlmRpgCampaign` into a revision-1 SQLite Campaign;
- preservation of the legacy metadata and explicit pending Chat Binding marker;
- idempotent re-import and copied-source detection;
- stale-preview rejection;
- addon directory reconciliation after rename saves and malformed-file repair;
- additive JSON diff/apply with no deletion from missing rows;
- pre-import backup ordering and one Campaign revision per accepted addon batch;
- visible supervisor planning for `:8001`, `:8002`, and optional `:1234`;
- occupied-port blocking, stale PID diagnostics, and stop-only-owned behavior;
- Workspace readiness while LM Studio is unavailable;
- staged compatibility updates with rollback after a post-switch failure;
- a durable real-campaign cutover checklist and one-command fallback that preserves both SQLite and legacy metadata.

The prototype does not start real SillyTavern, LM Studio, or the companion. Live port ownership, process cancellation, actual online backups, pinned-ST update installation, browser bridge marker writes, and the complete real-device cutover remain later implementation/acceptance work.
