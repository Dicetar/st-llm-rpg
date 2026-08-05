# Story Sync and model-job orchestration spike

**THROWAWAY PROTOTYPE.** This directory proves the Worker Job, Proposal, finalization, restart, cancellation, malformed-output, and single-model-lane transitions selected by Wayfinder #24. It is not production companion code.

## Run

```powershell
npm run test:worker-jobs-prototype
```

The tests use `node:sqlite` with in-memory and real temporary SQLite files. They demonstrate:

- bounded contiguous Story Sync source fingerprints;
- stale Campaign Anchor rejection;
- Job and Attempt persistence across close/reopen;
- restart interruption and evidence-checked Resume;
- user cancellation without automatic Resume;
- exactly one malformed-output repair;
- editable Proposals without Campaign mutation capability;
- one explicit finalization plan containing an atomic Campaign batch and Sync Boundary update;
- stale final source proof blocking both changes;
- idempotent authority acknowledgement and source-content pruning;
- narration preempting worker inference;
- sequential worker → narrator → worker model transitions with at most one loaded model.

The fake model host does not prove LM Studio timing, cancellation latency, VRAM release, or model fidelity. Those remain measurement gates for the later Wayfinder tickets.
