# Use one versioned exchange and one Narration transaction

Status: superseded for v1 by [ADR 0018](./0018-use-one-companion-one-writer-and-one-model-call.md).

Historical evidence only. Do not implement hidden drafts, enrichment revisions, hidden-prose recovery, vectors, automatic narrator retries, or automatic model management from this ADR. Where still compatible, the versioned exchange and atomic final-delivery constraints remain useful evidence beneath the final v1 contract.

The SillyTavern Bridge describes every Chat Completion request in one canonical, versioned `X-ST-RPG-Exchange` envelope. Missing or invalid wire metadata is an error, never implicit unlinked pass-through. A valid absent per-chat binding marker is encoded explicitly as unlinked; a valid marker carries only canonical Chat Binding ID while Campaign authority remains in SQLite. Chat Locator is collision evidence, never Binding identity.

The companion exposes one deep `Narration.respond` Interface. It privately owns route admission, Binding verification, Context, hidden draft and bounded enrichment, generation-mode semantics, cancellation, recovery, diagnostics, and final delivery. Fastify cannot choose the unlinked path or orchestrate stages. Explicit unlinked requests transparently forward one LM Studio exchange. Linked requests fail closed and expose no successful bytes until one full completion or continuation suffix is ready.

Narration never mutates Campaign or Binding history and never automatically retries model output. A usable draft whose enrichment failed may be retained briefly in bounded volatile memory and delivered only after an explicit Retry or Use unenhanced draft choice through a fresh pinned-ST generation. It never enters SQLite, files, logs, diagnostics, chat, or Campaign history while hidden.

This rejects multiple independent routing headers, separate public `linked()`/`unlinked()` methods, a public narration stage graph, early linked streaming, automatic narrator retry, durable hidden drafts, and direct companion writes to SillyTavern chat JSONL. Full rationale, contracts, Problems, and prototype obligations are in [SillyTavern bridge and narrator proxy](../design/sillytavern-bridge-and-narrator-proxy.md).
