# Campaign authority SQLite spike

**THROWAWAY PROTOTYPE — scratch databases are created under the operating-system temporary directory and may be deleted. This is not production companion code.**

## Question

Does the Campaign authority model selected in Wayfinder #17 actually preserve atomic Campaign and Chat Binding histories, idempotent multi-tab writes, arbitrary revision reconstruction, independent branches, durable invalidations, migrations, validated backups, restoration, and fail-closed corruption behavior on the target Windows/Node environment?

The spike deliberately uses the chosen local stack: pinned Node 24, built-in `node:sqlite`, WAL, `synchronous=FULL`, and SQLite online backup. It keeps one small `read / execute / changes`-shaped authority Module and exposes the scratch state after every scenario. It does not implement HTTP, React, SillyTavern, LM Studio, retrieval, or production schemas.

## Run

```powershell
npm run prototype:persistence
```

The default run executes the complete evidence trace, prints every relevant state transition, measures a 10,000-subject Campaign, and removes its temporary directory after success. A failed trace preserves the directory and prints its path.

For the lightweight interactive state viewer:

```powershell
npm run prototype:persistence -- --interactive
```

Keys are shown in the terminal. The interactive mode operates on another disposable scratch database.

## Artifact boundary

- `authority-spike.mjs` is the portable experimental authority/persistence Module.
- `run.mjs` is the throwaway evidence trace and TUI shell.
- Generated SQLite, WAL, SHM, backup, and diagnostic files are never written into the repository.
- Validated conclusions belong in `docs/research/campaign-persistence-prototype.md`; this directory remains primary-source prototype evidence only.
