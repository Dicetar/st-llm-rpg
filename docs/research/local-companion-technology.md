# Local companion technology for the campaign-independent rebuild

Research date: 2026-08-04

This report answers GitHub issue #14 (Wayfinder program decision 3). It compares technology for the local companion at `:8002`: SQLite access, migrations, concurrency, backups, addon-file watching, HTTP and OpenAI-compatible streaming, Windows startup, and LAN exposure. It supplies evidence for the provisional runtime and module-seam choice in #16 plus prototype gates for the final architecture decision in #26; it does **not** select the final architecture.

Evidence labels used below:

- **Documented fact:** stated by a primary project's documentation.
- **Local probe:** observed on this project's pinned development machine.
- **Inference:** a recommendation derived from the facts and the project's locked constraints.
- **Prototype gate:** behavior that must be proved in this project before it is locked.

## Provisional recommendation

The lowest-risk stack to take into the persistence and proxy prototypes is:

- pinned Node.js 24 LTS;
- built-in `node:sqlite`, isolated behind a narrow Campaign Store interface;
- a small internal migration runner and SQLite online backups;
- WAL on a local fixed disk, with one companion process owning writes;
- core `fs.watch` used only to trigger debounced full-directory reconciliation;
- Fastify 5 for Workspace and Campaign APIs, with a deliberately narrow raw streaming path for proxy responses;
- native `fetch()` and `AbortController` for LM Studio requests;
- the existing visible `.cmd`/PowerShell launcher pattern rather than a service or executable bundle;
- explicit `0.0.0.0` binding for SillyTavern `:8001` and Companion `:8002`, while LM Studio remains on `127.0.0.1:1234`.

`better-sqlite3` is the credible database fallback. Native `node:http` is the credible zero-dependency HTTP fallback. Both should remain alternatives until the prototypes prove Windows installation, persistence, cancellation, streaming, and real-phone behavior.

## 1. Runtime and SQLite binding

Node 24 is an active LTS line, and Node recommends supported LTS releases for production applications. [Node release schedule](https://nodejs.org/en/about/previous-releases)

The project-local runtime currently reports Node `v24.15.0`, N-API 10, and SQLite `3.51.3`. A local probe loaded `node:sqlite` without an experimental flag, created and queried a database, enabled WAL on a file database, created an FTS5 virtual table, and made a readable online backup while the source remained open. These results are useful compatibility evidence, not a substitute for recovery tests.

### Binding comparison

| Option | Evidence | Costs and risks | Provisional disposition |
|---|---|---|---|
| `node:sqlite` | In Node 24.15 it is Stability 1.2, **Release candidate**. `DatabaseSync` is synchronous; the module includes prepared statements, busy timeout support, sessions, and an asynchronous wrapper around SQLite's online backup API. Foreign keys and defensive mode are enabled by default for new databases in this runtime. [Node 24.15 SQLite API](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html) | The public API has not reached Stability 2. Synchronous operations block the event loop, so transactions and queries must remain short. The exact Node runtime also determines the bundled SQLite version and compile options. | Leading prototype choice: no native npm addon or separate SQLite install, and it passed the required local feature probes. Hide it behind a small adapter. |
| `better-sqlite3` | Mature synchronous API with transactions, backup support, functions/extensions, worker support, and prebuilt binaries for supported Node versions and common platforms. Its own guidance recommends WAL and identifies high concurrent-write workloads as a poor fit. [Official repository](https://github.com/WiseLibs/better-sqlite3), [official API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) | Adds a native addon, prebuild/install surface, and another compatibility dimension during Node and Windows updates. It does not remove the event-loop blocking characteristic of synchronous access. | Strong fallback if a persistence prototype finds a missing API, performance problem, or runtime regression in `node:sqlite`. |
| `sqlite3` / `node-sqlite3` | The official repository is archived and identifies the package as deprecated and unmaintained. [Official repository](https://github.com/TryGhost/node-sqlite3) | Depending on an unmaintained native database binding would add avoidable security, compatibility, and recovery risk. | Reject. |

**Inference:** pin the exact Node runtime with the project-local SillyTavern version. A compatibility update must probe the SQLite version and compile options, FTS5 creation, WAL, backup/readback, and the complete bridge test suite before it switches the pinned runtime. The Campaign Store interface should expose project concepts—transaction, expected revision, event append, snapshot read, backup—not the entire binding API. This keeps `better-sqlite3` substitution possible without designing for two databases everywhere.

## 2. Migrations

SQLite deliberately reserves `PRAGMA user_version` for applications and does not interpret it. `PRAGMA application_id` can identify an application-specific database file. [SQLite PRAGMA reference](https://www.sqlite.org/pragma.html#pragma_user_version)

SQLite supports only one simultaneous writer. `BEGIN IMMEDIATE` attempts to begin the write transaction immediately and fails with `SQLITE_BUSY` if another writer already exists, rather than discovering contention partway through a migration. [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html)

SQLite's generalized schema-change procedure is transactional but intentionally explicit: create a replacement table, copy data, drop/rename, rebuild indexes and triggers, and validate foreign keys. [SQLite ALTER TABLE guidance](https://www.sqlite.org/lang_altertable.html)

**Inference:** use a tiny internal ordered migration runner rather than introducing an ORM migration system before the domain model exists:

1. Store immutable numbered SQL or JS migrations in source control.
2. Record `version`, `name`, `checksum`, and `applied_at` in `schema_migrations`; mirror the newest version to `user_version` as a quick check, not as the only audit trail.
3. Set and verify a project `application_id` before treating a file as a Campaign database.
4. Before any pending migration, create and validate an online backup.
5. Run a migration and its ledger insert in one `BEGIN IMMEDIATE` transaction; rollback the whole migration on error.
6. After the sequence, run `PRAGMA quick_check` and `PRAGMA foreign_key_check` before accepting the database.

Never keep a database transaction open across an HTTP request, model generation, file operation, timer, or other `await`. Expensive data transformations should be prepared outside the transaction and committed with an expected-revision check.

### Migration prototype gate

Prove fresh creation, upgrade through every schema version, restart after each version, failure halfway through a migration, checksum mismatch, migration with a stale second tab, and restoration of the automatic pre-migration backup. A failed migration must leave either the old valid database or a validated restored database—not a partially accepted schema.

## 3. WAL, concurrency, and durability

WAL allows readers to continue while a writer appends, but SQLite still permits only one writer at a time. WAL requires all users of the database to be on the same host and does not work over a network filesystem. A long-running reader can delay checkpoints and allow the WAL file to grow; `SQLITE_BUSY` remains possible. SQLite's default automatic checkpoint is approximately 1,000 pages. [SQLite WAL documentation](https://www.sqlite.org/wal.html)

`PRAGMA journal_mode=WAL` persists across database reopenings. `synchronous=FULL` asks SQLite to sync each WAL commit; `NORMAL` can improve throughput but may lose recent committed transactions after a power loss. [SQLite PRAGMA reference](https://www.sqlite.org/pragma.html#pragma_journal_mode)

**Inference:** start with this opening policy and verify the returned journal mode rather than assuming it applied:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

One Campaign Engine process should own the read/write connection. Browser tabs and phones should access it over HTTP; they must never open the SQLite file. Keep transactions short and resolve application conflicts with `expected_revision`, not long SQLite locks. Store the database on a local fixed disk outside OneDrive, SMB shares, and VPN-mounted filesystems.

Do not tune checkpoint frequency or downgrade durability before measurement. Instrument commit latency, busy responses, WAL size, checkpoint duration, and event-loop delay in the persistence prototype. If synchronous queries measurably disturb proxy streaming, first shorten/batch them; only then evaluate a worker thread or `better-sqlite3` alternative.

## 4. Backup and restore

SQLite's online backup API produces a consistent snapshot while a source database remains in use. Node's `sqlite.backup()` wraps that API, runs incrementally, and returns a Promise; changes made through another connection can restart the backup. [Node online backup API](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html#sqlitebackupsource-path-options), [SQLite online backup API](https://www.sqlite.org/backup.html)

Copying only a live main database file is unsafe because committed data may still reside in its WAL, and separating a database from its journal can corrupt the copy. [SQLite corruption guidance](https://www.sqlite.org/howtocorrupt.html#_backup_or_restore_while_a_transaction_is_active)

**Inference:** use the online API, never `Copy-Item` on a live database:

1. Back up to a unique timestamped `.partial` path without overwriting an existing file.
2. Open the candidate read-only and validate its application ID, supported schema version, `quick_check`, and `foreign_key_check`.
3. Rename it atomically to the final backup name only after validation.
4. Make an unconditional backup before every migration and accepted JSON import batch.
5. On companion startup, create a daily backup when the newest validated daily backup is older than 24 hours; keep a timer for long-running sessions.

No process means no mutations under the locked no-offline-mutations rule, so a companion-owned daily scheduler is sufficient. Retention count, disk-space warning threshold, and whether pre-operation backups have a separate retention class remain product decisions; do not silently delete backups until those rules are specified.

Restore must be an exclusive maintenance operation: stop mutations, close the active connection, preserve the replaced database, install the backup, open and validate it, then resume. Keep the replaced database until the restored copy has passed checks and the user has explicitly completed or abandoned rollback.

### Recovery prototype gate

Prove online backup during reads and writes, restart, power/process termination at each backup stage, corrupt candidate rejection, disk-full behavior, restore, and rollback of the restore. Reconstruct representative arbitrary Campaign revisions after restore and verify immutable event counts and hashes.

## 5. JSON addon file watcher

On Windows, Node implements `fs.watch()` with `ReadDirectoryChangesW`. The API is not fully consistent across platforms; filenames may be absent, network filesystems can be unreliable, and moving or deleting the watched directory can stop events or produce an error. `fs.watchFile()` polls but is slower and less efficient. [Node file-system watcher caveats](https://nodejs.org/download/release/v24.15.0/docs/api/fs.html#caveats)

**Inference:** a watcher notification is only a reason to reconcile, never proof of the final file state:

- watch the addon directory, not individual files, because editors commonly save through a temporary file and rename;
- debounce bursts, wait until files are readable and stable, then rescan every recognized addon filename;
- compare content hashes and a persisted scan manifest rather than trusting `rename`/`change` or the reported filename;
- provide a periodic reconciliation pass and a visible manual **Rescan** action;
- parse changed files into a persisted import candidate, retain parse/validation errors, and show an import diff;
- never mutate Campaign state until the user explicitly applies the diff as one accepted mutation batch.

Chokidar can normalize events and add polling, but it cannot remove the underlying network/filesystem uncertainty. For one project-local directory, core `fs.watch` plus deterministic reconciliation is a smaller first prototype. Keep addon files local; do not promise reliable live watching of SMB or cloud-synchronized folders.

### Watcher prototype gate

Test direct writes, temporary-file rename saves, rapid repeated saves, deletion/recreation, malformed JSON followed by repair, companion restart, a missing filename event simulated in the reconciler, and replacement of the watched directory. The persisted diff must converge to disk contents without duplicate or silent Campaign mutations.

## 6. HTTP server and narrator proxy

Node 24 provides stable browser-compatible `fetch`, `AbortController`, `ReadableStream`, and `TransformStream`; `fetch` is implemented by the bundled Undici version. [Node global `fetch`](https://nodejs.org/download/release/v24.15.0/docs/api/globals.html#fetch)

LM Studio exposes OpenAI-compatible Chat Completions at the local `/v1` base URL and accepts streaming requests. Its server can bind only locally or be exposed to the network. [LM Studio local server](https://lmstudio.ai/docs/developer/core/server), [Chat Completions compatibility](https://lmstudio.ai/docs/developer/openai-compat/chat-completions)

SSE is UTF-8 `text/event-stream`; events are separated by blank lines and may contain multiple `data:` lines. A TCP or fetch chunk is not necessarily one SSE event. [WHATWG event-stream format](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)

### Server comparison

| Option | Advantages | Costs and risks | Provisional disposition |
|---|---|---|---|
| Fastify 5 | JSON Schema request validation and response serialization, consistent hooks/errors/logging, and in-process HTTP testing. It supports raw reply control through `reply.raw`/`reply.hijack()` when exact proxy behavior is needed. [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Fastify testing](https://fastify.dev/docs/v5.7.x/Guides/Testing/), [Fastify reply API](https://fastify.dev/docs/latest/Reference/Reply/) | A hijacked response bypasses normal Fastify lifecycle behavior and makes the proxy path responsible for headers, errors, and completion. Response schemas can strip fields if used carelessly. Node 24/Windows must still be smoke-tested with the exact pinned package versions. | Leading API-shell candidate. Use schemas for owned Campaign routes, but isolate transparent proxy handling and do not put a restrictive body schema on passthrough requests. |
| Native `node:http` | Stable, zero dependency, complete stream/backpressure control. `response.write()` exposes backpressure and `drain`; close events allow disconnect detection. [Node HTTP API](https://nodejs.org/download/release/v24.15.0/docs/api/http.html) | Requires custom routing, body limits, validation, serialization, errors, logging, CORS, static assets, and tests. That surface is larger than the application's differentiated logic. | Credible fallback if Fastify prevents exact SillyTavern semantics in the proxy spike. |
| Express 5 | Widely understood and supports modern Node. [Express FAQ](https://expressjs.com/en/starter/faq/) | Adds a dependency without Fastify's schema/test advantages or native HTTP's minimalism; exact streaming still drops to raw response handling. | No project-specific advantage found. |

**Inference:** use native `fetch()` and `AbortController` for LM Studio rather than an OpenAI SDK. A transparent proxy should not add SDK retries to a narration request that may already have generated output. When the downstream SillyTavern request closes or stops, abort upstream immediately. Respect `response.write()` backpressure rather than buffering an unbounded model response.

The unlinked path should forward the upstream status, safe headers, and body as transparently as possible. It need not parse SSE. A linked path that must inspect or accumulate model output needs a real incremental SSE parser with a bounded buffer; `eventsource-parser` is a small candidate to prototype rather than writing an ad hoc line splitter. Preserve unknown chunk fields, usage chunks, `finish_reason`, and reasoning deltas instead of assuming every delta contains visible `content`. LM Studio documents its OpenAI-compatible response surface and evolving API behavior. [LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions), [LM Studio API changelog](https://lmstudio.ai/docs/developer/api-changelog)

Request mutation must recalculate `content-length` or allow the HTTP client to do so. Apply explicit JSON body and accumulated-output limits. Exact SillyTavern request metadata, safe forwarded headers, retry rules, atomic linked delivery, and send/regenerate/continue/swipe/stop behavior belong to the bridge-contract research and proxy prototype, not this technology ticket.

### HTTP/proxy prototype gate

On the pinned Node and Windows environment, prove:

- Fastify-owned JSON validation and consistent `409`, `422`, and service-unavailable errors;
- transparent unlinked streaming without changed chunks or duplicate retries;
- linked accumulation and final atomic delivery;
- cancellation during connect, headers, stream, hidden draft, and revision passes;
- downstream disconnect aborts LM Studio promptly;
- slow-client backpressure and bounded memory;
- malformed/truncated SSE and chunks containing reasoning but no visible answer;
- concurrent Workspace reads while a Campaign mutation and narrator stream are active.

## 7. Windows startup and packaging

Node's Single Executable Application feature remains Stability 1.1, active development. It embeds one CommonJS script and requires a blob-injection/binary-preparation flow; packaging assets and native modules adds more build machinery. [Node single executable applications](https://nodejs.org/download/release/v24.15.0/docs/api/single-executable-applications.html)

Windows Task Scheduler supports triggers such as `ONLOGON` and can query, run, end, create, and delete tasks. [Microsoft `schtasks` documentation](https://learn.microsoft.com/en-us/windows/win32/taskschd/schtasks)

The repository already has a visible `.cmd` to PowerShell launcher for pinned SillyTavern. It checks health and port ownership and keeps failures observable. **Inference:** extend this pattern into one project-local supervisor for the first implementation:

- start or detect SillyTavern `:8001` and Companion `:8002`;
- detect LM Studio `:1234` and clearly report when it is unavailable instead of attempting to own its GUI lifecycle blindly;
- write PID ownership and logs under ignored `.runtime` paths;
- wait for health checks before opening the browser;
- stop only child processes it started and whose identity still matches;
- expose explicit fallback and compatibility-update commands.

Keep the console visible by default while the service is young. It makes port conflicts, migrations, backup failures, and model connectivity diagnosable. If automatic startup is later requested, an opt-in Task Scheduler `ONLOGON` task fits LM Studio's user session better than a Windows service.

Defer SEA, a Windows service wrapper, installer, and tray application. They do not improve the Campaign model or proxy contract and would hide or multiply failure modes before those are stable. The pinned Node runtime is already required by the project-local SillyTavern.

### Launcher prototype gate

Prove first start, normal restart, occupied ports, stale PID files, already-running components, LM Studio absent, child crash, clean shutdown, fallback extension launch, paths containing spaces, and running from a non-project working directory. Logs must identify which process owns each port and give one actionable next step.

## 8. LAN and VPN exposure

If the host is omitted, Node may listen on the unspecified IPv6 address `::` or IPv4 `0.0.0.0`, depending on the environment. [Node `net.Server.listen`](https://nodejs.org/download/release/v24.15.0/docs/api/net.html#serverlistenport-host-backlog-callback)

Windows Firewall inbound rules can constrain protocol, local port, network profile, and remote address such as `LocalSubnet` or an explicit CIDR. [Microsoft `New-NetFirewallRule`](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)

**Inference:** bind deliberately rather than relying on dual-stack defaults:

```text
SillyTavern       0.0.0.0:8001
Companion         0.0.0.0:8002
LM Studio         127.0.0.1:1234
```

This exposes only the two browser-facing services to the phone. Keep the database and LM Studio endpoint host-local. The launcher should print the detected LAN URLs and provide a cheap `/health` endpoint. A firewall helper may create inbound TCP rules for ports 8001 and 8002 on the Private profile, restricted to `LocalSubnet` plus the actual `10.8.0.0/16` VPN range when needed; it should show the exact rule and require an explicit action.

The project has explicitly accepted trusted LAN/VPN operation without pairing, authentication, or origin restriction. This means Windows Firewall and VPN membership are the security boundary. It provides no confidentiality against another device already on those networks and must never be represented as safe for public internet exposure. Cross-origin response headers required by the SillyTavern bridge should be specified narrowly in the bridge contract even though origin authentication is out of scope.

### LAN prototype gate

Verify desktop and the real phone over both `192.168.*` LAN and `10.8.*` VPN paths: Workspace load, API mutation, streaming narration, stop, reconnect, companion outage, ST outage, and firewall diagnostics. Do not accept browser emulation as the mobile result.

## 9. Decisions deliberately left for later tickets

This research narrows implementation choices but does not settle:

- the final Campaign Engine and storage interfaces;
- exact schema, event/snapshot cadence, and revision reconstruction algorithm;
- Fastify versus native HTTP after the real ST proxy spike;
- exact SillyTavern headers, request mutation, cancellation, and error contract;
- whether linked generation streams or is delivered atomically after enrichment;
- backup retention and disk-pressure policy;
- CORS header details and compatibility-update mechanics;
- whether observed event-loop delay warrants a database worker thread.

Issue #16 should use this evidence to choose a provisional runtime, repository shape, and deep module seams that the prototypes can exercise. Choices that depend on measured persistence, proxy, or enrichment behavior remain provisional until the final architecture decision in #26.

## 10. Evidence required before #26 final architecture selection

The technology choice is ready to lock only when one reproducible Windows test trace demonstrates all of the following together:

1. Migrate, mutate, append an immutable event, reconstruct an arbitrary revision, back up, restart, restore, and fork without data loss.
2. Two tabs produce a deterministic stale-revision conflict rather than last-write-wins corruption.
3. Addon writes converge to one previewed import diff and cause zero silent mutations.
4. Unlinked SillyTavern generation matches direct LM Studio behavior for send, stop, regenerate, continue, and swipe.
5. Linked generation fails closed, cancels cleanly, bounds memory, and does not corrupt chat after a truncated stream or companion restart.
6. Workspace and narration remain usable on the actual phone through the supported LAN/VPN routes.
7. The current extension remains available through the documented fallback command.

If `node:sqlite` fails these gates because of an API or runtime defect, repeat the persistence trace with `better-sqlite3`. If Fastify prevents transparent streaming or cancellation, repeat the proxy trace with native `node:http`. Ticket #26 must choose from measured behavior, not library popularity.
