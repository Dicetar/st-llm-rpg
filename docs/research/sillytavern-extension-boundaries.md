# SillyTavern extension boundaries for the RPG rebuild

Research date: 2026-08-01

Current source reference: SillyTavern `release` commit [`8172dcd`](https://github.com/SillyTavern/SillyTavern/tree/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8). Documentation and source behavior can change, so the extension must declare and test a minimum supported SillyTavern version.

## Decision summary

A UI-only v1 is technically plausible, but two assumptions must be proven by prototypes before they become architecture:

1. A compact Campaign document in namespaced `chatMetadata` must remain fast and recoverable in a long real-world chat.
2. One cached Context Capsule inserted with `setExtensionPrompt()` must appear correctly in both Chat Completion and Text Completion prompts used by representative 20–40B models.

Recommended v1 boundary:

- Store one versioned Campaign document, its compiled Context Capsule, sync bookkeeping, and bounded revision data under one namespaced `chatMetadata` key.
- Reacquire metadata and re-register the capsule on every chat change.
- Inject the already-compiled capsule with `setExtensionPrompt()`. Use a minimal generation interceptor only as a fail-closed guard; never perform model calls, storage, retrieval, or campaign compilation in the generation hot path.
- Run Story Sync with `generateRaw()` over explicit, small message chunks. Validate locally and create editable proposals. Do not require provider-native structured output.
- Provide a first-class Campaign JSON export/import in addition to SillyTavern's JSONL chat export.
- Keep a server plugin as an explicit escape hatch, triggered by measured failure or a requirement that a browser extension cannot safely meet.

Evidence labels used below:

- **Documented fact**: stated by official SillyTavern documentation.
- **Source-code fact**: observed in the current official `release` source.
- **Inference**: project recommendation derived from those facts.
- **Unknown**: not guaranteed by documentation or source inspection; requires measurement.

## 1. Chat metadata persistence

### What is guaranteed

- **Documented fact:** UI extensions may place arbitrary chat-specific data in `SillyTavern.getContext().chatMetadata` and persist it with `saveMetadata()`. The metadata object reference changes when the chat changes, so extensions must reacquire it rather than retain a long-lived reference. SillyTavern emits `CHAT_CHANGED` after a switch. [UI Extensions: Chat metadata](https://docs.sillytavern.app/for-contributors/writing-extensions/#chat-metadata)
- **Source-code fact:** metadata is the first/header object in the chat JSONL structure. Loading a chat replaces the in-memory `chat_metadata` reference from that header, then emits `CHAT_CHANGED`. [Chat loading source](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L7594-L7642)
- **Source-code fact:** `saveMetadata()` is not a small metadata-only operation. It invokes the normal chat save. The browser constructs `[chatHeader, ...entireChat]`, serializes the complete request, and sends it to `/api/chats/save`. The server serializes the complete array back to JSONL. [Client save path](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L7325-L7421), [server save path](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/chats.js#L448-L495)
- **Source-code fact:** the final server write uses an atomic file-write helper, and SillyTavern also creates chat backups. [Atomic helper](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/util.js#L1486-L1498), [save and backup](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/chats.js#L457-L467)
- **Source-code fact:** the server accepts very large JSON request bodies (500 MB), but this is only an HTTP ceiling, not a practical metadata capacity promise. [Server body limit](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/server-main.js#L103-L111)
- **Source-code fact:** `saveChat()` catches network/server errors and displays a toast instead of reliably propagating a failed result to the caller. Consequently, `await saveMetadata()` does not by itself prove durable persistence to an extension. [Client error handling](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L7375-L7421)

### Consequences for v1

- **Inference:** `chatMetadata` is appropriate only for a compact canonical document. Do not place unbounded audit history, duplicated rendered text, large binary data, or disposable indexes in it.
- **Inference:** keep Campaign state and the matching compiled Context Capsule in the same metadata value and revision them together. Candidate state must validate and compile before it replaces the previous known-good pair.
- **Inference:** retain a recoverable local draft until persistence has been verified. The public save function's resolved promise is not a sufficient acknowledgement.
- **Unknown:** no official practical limit exists for metadata size, save latency, load latency, browser memory use, or backup growth. These must be measured against representative campaign and chat fixtures.
- **Unknown:** a UI-only implementation needs a supported way to verify the just-written revision after simulated network/server failure. If the prototype cannot prove this without relying on unstable private endpoints, explicit acknowledged storage becomes a server-plugin trigger.

### Mandatory storage prototype

Test combinations of short and multi-thousand-message chats with small, representative, and deliberately oversized Campaign documents. Measure:

- edit-to-save completion and visible UI jank;
- chat reload and chat-switch time;
- branch creation time;
- JSONL export/import time and resulting file size;
- recovery after browser reload during save, server outage, integrity conflict, and malformed metadata;
- whether the UI can distinguish committed, pending, stale, and failed revisions.

Pass only if the previous committed revision remains usable after every injected failure and an unsaved edit is recoverable without guessing.

## 2. Chat switching, branches, message mutations, and transfer

### Switching and new chats

- **Documented fact:** extensions can observe `CHAT_CHANGED`, `CHAT_CREATED`, `CHAT_DELETED`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, and `MESSAGE_SWIPED`. Event payloads are not uniform; the documentation directs extension authors to inspect the emitting source. [UI Extensions: Events](https://docs.sillytavern.app/for-contributors/writing-extensions/#events)
- **Source-code fact:** loading replaces the metadata object; creating/clearing a chat can reset both metadata and the in-memory extension-prompt registry. [Chat load](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L7594-L7642), [chat clear](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L1579-L1603)
- **Inference:** on every `CHAT_CHANGED`, cancel work belonging to the old chat, reacquire context, validate/migrate the namespaced Campaign value, and re-register only that chat's known-good capsule. Never let an asynchronous analysis result commit after its originating chat has been left.

### Branches and checkpoints

- **Documented fact:** a branch/checkpoint clones messages only through the selected message. Branch creation switches to the clone; checkpoint creation does not. JSONL chat links use file names, so renaming a chat can break checkpoint links. [Chat File Management](https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/#checkpoints)
- **Source-code fact, critical:** branch creation slices messages at the chosen point, but passes only a new `main_chat` field as metadata override. `saveChat()` merges that override over the current full metadata. A branch from an old message therefore inherits the latest Campaign metadata, not the Campaign state at that message. [Branch construction](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/bookmarks.js#L165-L242), [metadata merge](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L7347-L7384)
- **Inference:** a correct RPG branch needs point-in-time state recovery. Every committed Campaign revision should record the message-prefix anchor at which it became effective. A branch should fork the latest Campaign revision whose anchor exists in the branch. If that state cannot be reconstructed, show a reconciliation choice; never silently retain future inventory, quest, NPC, or scene changes.
- **Inference:** branch/import cloning also copies application IDs. On load, detect that the stored binding no longer matches the current chat, assign a new Campaign instance ID, and retain lineage to the parent. Treat a chat file name as a mutable locator, not campaign identity.
- **Unknown:** the exact UX for manual edits with no narrative source—copy current values, restore point-in-time values, or ask per branch—must be resolved by the branch prototype.

### Edits, deletions, reordering, and swipes

- **Source-code fact:** `ChatMessage` has content, timestamps, swipe data, and an open-ended `extra` object, but no documented stable message UUID. Message IDs exposed by the UI are chat-array positions. [Chat message types](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/global.d.ts#L45-L88)
- **Source-code fact:** edits and swipes emit the affected array index. A message deletion splices the array but emits the new chat length rather than the deleted index, so the deletion event alone cannot identify the earliest changed message. [Edit event](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L8337-L8346), [swipe event](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L10247-L10256), [delete behavior](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L1612-L1673)
- **Inference:** a numeric `Sync Point` alone is unsafe. Store a compact fingerprint sequence or chunked prefix hashes for processed messages. At Sync time, compare current fingerprints to the saved prefix, find the earliest divergence, and reprocess from there. Include active swipe identity/content in the fingerprint.
- **Inference:** accepted canonical changes are not automatically reversed when their source message changes. Mark their provenance stale and generate editable correction proposals. Scene boundaries and proposal citations should store both observed indices and fingerprints.
- **Inference:** avoid writing custom IDs into SillyTavern message objects in v1. It is intrusive and still requires migration/import handling; prefix fingerprints solve the necessary detection without taking ownership of chat records.

### Import and export

- **Documented fact:** native JSONL export/re-import preserves all chat metadata. Plain-text export loses metadata and cannot be re-imported. Images and file attachments are not included in JSONL export. [Chat File Management: export](https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/#export-as-jsonl)
- **Source-code fact:** native JSONL import copies a valid JSONL chat file, including its header metadata. Foreign-format importers construct SillyTavern chats and generally begin with empty metadata. [Import source](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/chats.js#L720-L790)
- **Inference:** advertise JSONL as the SillyTavern-native whole-chat backup, but provide explicit `.campaign.json` export/import from the extension. The application export must include schema version, canonical records, revisions needed for recovery, capsule source data, and sync/scene anchors; it must not depend on chat text export.
- **Inference:** validate and migrate imported Campaign JSON before making it current. An imported JSONL header is transport, not proof that application data is valid.

## 3. Prompt injection across Chat and Text Completion

### Available mechanisms

- **Source-code fact:** `setExtensionPrompt(key, value, position, depth, scan, role, filter)` is explicitly defined for UI extensions and writes to the in-memory extension-prompt registry. It supports before/after-story positions and depth-based in-chat injection with system, user, or assistant roles. [Prompt API](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L483-L499), [setter](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L8856-L8875)
- **Source-code fact:** depth-based `IN_CHAT` prompts are inserted into Text Completion message assembly and are separately inserted as role-bearing messages in Chat Completion assembly. [Text Completion insertion](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L5563-L5616), [Chat Completion insertion](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/openai.js#L794-L865)
- **Documented fact:** a manifest `generate_interceptor` runs before non-dry-run generation, can add injections or abort, receives the generation type, and runs sequentially with other extension interceptors. [UI Extensions: Prompt Interceptors](https://docs.sillytavern.app/for-contributors/writing-extensions/#prompt-interceptors)
- **Source-code fact:** interceptor exceptions are logged and generation continues unless an interceptor explicitly aborts. [Interceptor runner](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/extensions.js#L2008-L2040)

### Recommended capsule path

1. Compile the Context Capsule locally whenever committed Campaign state changes.
2. Cache the capsule beside the matching Campaign revision.
3. Register it under a namespaced `setExtensionPrompt()` key.
4. On every visible generation—including send, regenerate, continue, and swipe—a minimal interceptor reacquires the current metadata and checks that the cached capsule exists and matches the Campaign revision.
5. If it matches, re-register it synchronously and return. If a bound Campaign has no known-good capsule, abort generation and show one actionable status surface. Do not silently generate with missing or stale RPG state.
6. Ignore the extension's own analysis jobs and never mutate SillyTavern chat messages from this interceptor.

**Inference:** prefer `IN_CHAT` for the capsule because current source implements it in both API modes and it can remain close to recent turns. However, exact role and depth are not settled. System-role adherence, instruct formatting, continuation behavior, provider restrictions, and interaction with other extensions must be inspected in the final outgoing prompt.

**Unknown:** no source inspection can prove that a given 20–40B model will follow a system message at a particular depth. Prototype plain, short, labeled variants at depth 0 and 1 in both completion modes. Test possession, quantity, equipment, conditions, active objectives, and conflicting chat claims. Choose the smallest form with the best factual adherence; do not choose by token count alone.

## 4. Separate Story Sync and scene analysis

- **Documented fact:** `generateQuietPrompt()` runs an invisible generation with the normal chat/character context. `generateRaw()` runs without chat context and accepts either a Text Completion string or Chat Completion message array, adapting to the active API. [UI Extensions: Generating text](https://docs.sillytavern.app/for-contributors/writing-extensions/#generating-text)
- **Documented fact, critical:** provider-native structured output is Chat Completion-only, varies by source and model, may fail or return `{}`, and SillyTavern does not validate the result against the schema. [UI Extensions: Structured Outputs](https://docs.sillytavern.app/for-contributors/writing-extensions/#structured-outputs)
- **Source-code fact:** `generateRaw()` uses the active API and exposes response-length, prefill, system-prompt, and optional schema controls; it emits the appropriate final-prompt event for Text or Chat Completion. [Raw-generation source](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L3935-L4054)
- **Source-code fact:** the current release also exposes a Connection Manager request service able to send through a named Chat Completion or Text Completion profile, but it fails when Connection Manager is disabled. [Connection service](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/extensions/shared.js#L385-L487)

### Recommended weak-model workflow

- Use `generateRaw()` with an explicit, bounded source-message chunk plus only the minimal canonical state needed for comparison. Do not use the whole implicit chat context for routine Story Sync.
- Use the active connection only as an explicit fallback. The primary Story Sync path uses a separately selected Campaign Worker profile through `ConnectionManagerRequestService` and never applies that profile to normal chat. Feature-detect Connection Manager, keep manual editing available when it is missing, and reject results when the originating chat or narrator connection changes. See ADR 0003.
- Request a small, flat proposal shape with explicit operation, record type, target name/ID when known, proposed fields, confidence, and source fingerprints.
- Parse and validate locally. Provider-native JSON Schema is an optional improvement, never a correctness dependency. Text Completion must work through ordinary constrained JSON/text, tolerant extraction, and a manual fallback.
- Retry only one malformed chunk with a repair prompt. Preserve raw output and already-valid chunks. Never commit partial model output directly to canonical state.
- Serialize analysis jobs, make them cancellable, bind them to chat and source fingerprints, and discard results if the chat or source prefix changes before completion.
- Story Sync failure must leave the analysis cursor and Campaign revision unchanged. Advance Scene must remain manually completable when analysis fails.

## 5. When a server plugin becomes justified

- **Documented fact:** server plugins add server-side endpoints and Node.js functionality unavailable in the browser. They are disabled unless `enableServerPlugins` is enabled, run unsandboxed, and may access the filesystem. [Server Plugins](https://docs.sillytavern.app/for-contributors/server-plugins/)
- **Documented fact:** official extension submissions cannot require a server plugin. [UI extension submission rules](https://docs.sillytavern.app/for-contributors/writing-extensions/#extension-submissions)
- **Documented fact:** client-side extension settings are not secure storage for secrets; official guidance points to server plugins when secret handling is required. [UI Extensions: Security](https://docs.sillytavern.app/for-contributors/writing-extensions/#security)

Do not add a server plugin merely because it is architecturally convenient. Add one when at least one measured or explicit requirement applies:

1. The storage prototype shows unacceptable save/load/switch/export behavior at the agreed representative fixture size.
2. The UI extension cannot obtain a reliable persistence acknowledgement and recover cleanly from simulated failures using supported APIs.
3. Campaign data must outgrow a compact chat-bound document—for example, unbounded history, large attachments, cross-chat shared campaigns, concurrent mutation, or independently managed backups.
4. The product requires filesystem access, a browser-inaccessible/Node-only library, background server work, or a custom API endpoint.
5. A future dedicated analysis connection requires securely stored credentials not already managed by SillyTavern.

If triggered, the server plugin should own durable Campaign storage and acknowledged transactions. Chat metadata should shrink to a binding, schema/version marker, processing anchors needed by the UI, and possibly the last known-good capsule for degraded operation. The browser extension should remain usable enough to explain the failure and export recoverable data when the plugin is unavailable.

## 6. Required prototype acceptance checks

1. **Metadata durability and scale:** prove load, edit, save, reload, switch, JSONL export/import, and outage recovery with representative and stress fixtures.
2. **Branch correctness:** branch from an old message after later inventory/quest changes; prove the new branch receives the correct point-in-time Campaign state, a new instance identity, and explicit lineage.
3. **History mutation:** edit, delete, reorder, and swipe before and after the saved sync boundary; prove earliest divergence is detected and canonical state is never silently rolled back or overwritten.
4. **Capsule delivery:** inspect exact outgoing prompts for Chat Completion and Text Completion, including send, continue, regenerate, and swipe. Test at least one representative model in the intended 20–40B class for factual adherence under conflicting prose.
5. **Fail-closed context:** remove/corrupt/mismatch the capsule and prove visible generation is blocked with one recoverable error rather than proceeding without RPG state.
6. **Weak-model Story Sync:** prove extraction, local validation, one retry, partial-result preservation, cancellation, manual correction, and zero canonical mutation when native structured outputs are unavailable.
7. **Transfer:** prove native JSONL preserves Campaign metadata, TXT warns that it does not, foreign chat import starts unbound, and explicit Campaign JSON round-trips independently.

## Final boundary

Proceed with a UI-extension prototype, not a server plugin, but treat `chatMetadata` as a measured transport-backed document rather than a database. The Context Capsule can use SillyTavern's native prompt registry across both completion families. Story Sync can use the active SillyTavern connection without entering the normal chat. The architecture is accepted only after durability, point-in-time branching, mutation detection, exact prompt placement, and weak-model extraction are demonstrated; failure of storage durability or save acknowledgement is the evidence-based trigger for a server plugin.
