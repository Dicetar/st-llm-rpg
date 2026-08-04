# Current Extension Disposition Audit

Status: proposed for user approval in Wayfinder issue #13.

This report decides what evidence from `extension/st-rpg-campaign` should survive into the campaign-independent companion. It does not design the companion's final interfaces, runtime, SQLite schema, proxy contract, or Workspace shell; those remain later Wayfinder decisions.

## Executive verdict

Keep the current extension running as the fallback and treat its tested behavior as an executable specification. Extract domain rules, pure parsing, deterministic retrieval ideas, failure scenarios, and interaction journeys. Do not turn the current browser files into the companion by layering SQLite and HTTP beneath them: chat ownership, module-level global state, SillyTavern DOM orchestration, persistence acknowledgement, model jobs, and prompt registration are deliberately entangled with the old architecture.

The target principle is **preserve behavior, replace ownership**:

- Campaign authority moves from chat metadata to the companion.
- Narrator request ownership moves from extension prompt events to the proxy.
- Model-job ownership moves from SillyTavern Connection Manager to the companion.
- Workspace ownership moves from a body-mounted extension overlay to the separate full-page Workspace.
- SillyTavern retains only the smallest proven bridge needed for Chat Binding and navigation.

## Evidence

| Current file or suite | Size / surface | Architectural evidence |
|---|---:|---|
| `campaign-session.js` | 3,429 lines; 50 operation types; `open/query/preview/execute/subscribe` | Externally deep interface, but one implementation owns normalization, validation, query projection, undo, Story Sync state, addon import, events, persistence coordination, and Context Capsule compilation. |
| `index.js` | 3,785 lines; 100+ top-level functions | Module-level controller constructs every dependency, owns all collection drafts and rendering, reaches into SillyTavern globals, registers prompt events, and dispatches every interaction. It has no reusable interface. |
| `story-sync.js` | 960 lines; public `source/parse/open/close` surface | Pure source/parser behavior is mixed with prompt construction, Connection Manager profiles, worker execution, Popup rendering, review editing, cancellation, and Campaign Operations. |
| `context-capsule.js` + `context-router.js` | 876 lines; pure compiler entry points | Deterministic selection, typed rendering, omission diagnostics, exact-name matching, scene bias, and one-hop links are useful. Character budgets, record shapes, policy flags, and pre-generation-only assumptions are fallback-specific. |
| `sillytavern-storage.js` | 188 lines; `load/commit/getRecovery` | Correctly proves readback, recoverable candidates, and stale-write blocking for chat metadata. Its authority and failure protocol are intentionally obsolete under SQLite. |
| Behavioral tests | 42 tests / 2,614 lines | 21 Campaign behavior, 5 Context, 6 Story Sync, 1 storage, and 9 Workspace/bridge checks provide concrete acceptance scenarios rather than a reason to preserve file layout. |

Current import direction is also informative:

```text
index.js
├── Campaign Session ──> Reference Graph
│                    └─> Context Capsule
├── SillyTavern Storage ──> Campaign Session error type
├── Story Sync ──> Campaign Session field definitions
├── Context Router ──> Context Capsule
└── Context Inspector
```

The browser entry point is therefore the composition root, controller, view layer, SillyTavern adapter, prompt bridge, and draft store at once. Adding the companion underneath it would retain the wrong ownership even if the storage adapter were swapped.

## Keep, extract, or retire

### Campaign Session — extract behavior; retire the browser implementation after cutover

**Keep as specification**

- typed Campaign Operations and atomic accept-or-reject behavior;
- Campaign-wide expected-revision conflicts;
- stable IDs, normalized Record/live-entry split, and typed references;
- archive/restore and reference-blocked deletion;
- immutable Scene Archives and accepted Campaign Events;
- colocated create-and-attach batches, guarded Advance Scene, and explicit zero quantities;
- query projections that join definitions to live entries;
- human-reviewed Proposal acceptance through the ordinary mutation path.

**Extract into the future Campaign authority**

- validation and normalization rules;
- the Reference Graph as an internal module, not a public storage-shaped interface;
- operation outcomes, impact previews, affected IDs, and conflict/error semantics;
- domain-level acceptance fixtures from the current tests.

**Retire from the companion**

- `open({ chatId })` as Campaign ownership;
- in-memory verified envelopes as canonical state;
- Context Capsule compilation inside every mutation commit;
- Story Sync draft storage as fields on the browser-owned Campaign document;
- browser-only undo tokens and direct addon synchronization;
- the current 3,429-line conditional dispatcher as a file to extend.

The deletion test favors the behavior but not the file: deleting Campaign Session today would scatter invariants across UI callers, so its seam is valuable. Moving it unchanged would also move obsolete chat, context, and persistence responsibilities. The companion should re-express the proven behavior behind its own authority rather than wrap this module with additional layers.

### Context Capsule and Router — extract algorithms and diagnostics; replace the contract

**Keep as evidence**

- deterministic compact indexes before detailed expansion;
- exact names and aliases before weak term matches;
- current-Scene and typed-link relevance;
- kind-specific detail rendering;
- explicit selection reasons, omissions, and budget diagnostics;
- the rule that narrator retrieval never mutates Campaign state;
- the large-Inventory and named-wardrobe style acceptance scenarios.

**Extract later**

- pure ranking and rendering ideas into the Context Focus/retrieval design;
- explainable diagnostic fixtures for the visible Context Tray;
- compact narrator-view projections that do not expose the SQLite model directly.

**Retire or replace**

- fixed character budgets and a hard-coded recent-message count;
- `contextPolicy` as the only visibility model;
- hard-coded v1 Campaign object traversal as the retrieval interface;
- browser event timing and `setExtensionPrompt()` registration;
- the prohibition on embeddings or hidden-draft enrichment from the fallback ADR;
- compiling and storing a full capsule on every Campaign mutation.

The future Context module should remain pure at its external seam, but its exact input, ranking stages, token budgets, and retrieval adapters belong to Wayfinder #21.

### Story Sync parser and workflow — extract pure worker contract; retire the controller

**Keep as specification**

- bounded, fingerprinted source ranges after a per-binding Sync Boundary;
- transcript-as-untrusted-data prompting;
- conservative extraction of explicit durable changes;
- one bounded malformed-output repair;
- safe alias normalization and rejection of unknown fields;
- stale-source rejection;
- editable, source-linked Proposals and no automatic application;
- cancellation and model failure leaving Campaign state unchanged.

**Extract later**

- `createStorySyncSource`, output parsing, validation, and prompt fixtures into a worker-job module;
- Proposal editing/acceptance journeys into Workspace acceptance tests;
- malformed-output examples into model-profile verification.

**Retire or replace**

- SillyTavern Connection Manager profile creation and selection;
- narrator-fingerprint checks as the job isolation mechanism;
- Popup DOM, local controller state, and sequential per-proposal operation loops;
- direct imports of Campaign Session field constants;
- worker execution inside the SillyTavern browser.

`story-sync.js` presents a small `open/close` interface, but that depth is accidental: it hides several independent seams that will vary separately in the companion. Reusing it would couple worker transport, parsing, review UI, and Campaign mutation again.

### SillyTavern storage adapter — retain only as migration and failure evidence

**Keep**

- fixtures proving stale-write detection, recoverable candidates, unknown save outcomes, and last-known-good behavior;
- a read-only legacy metadata reader for the future one-time import path, if migration evidence requires it.

**Retire**

- chat metadata as canonical Campaign storage;
- `/api/chats/get` readback as mutation acknowledgement;
- localStorage recovery journals for canonical mutations;
- the `load/commit/getRecovery` adapter as a production companion seam.

SQLite is not a second adapter for this interface: it has different ownership, transaction, history, backup, and subscription responsibilities. Making SQLite imitate the chat envelope would preserve the wrong abstraction.

### Workspace UI — keep interaction decisions; rebuild the implementation

**Keep as UX requirements**

- Collections → Records → Editor navigation;
- creation inside the collection or reference block where the new subject is needed;
- one editor for definition plus live attachment where the operation is atomic;
- structured repeaters instead of delimiter syntax;
- Save/Cancel for multi-field drafts and immediate counters/statuses with revision-safe Undo;
- retained drafts on failure, visible validation, archive-first lifecycle, blockers, and restore;
- guarded Advance Scene and editable Story Sync review;
- explainable context selection and omissions;
- mobile one-column editing, sticky actions, native Popup subworkflows, and real-phone acceptance.

**Retire or replace**

- the body-mounted full-screen Workspace implementation;
- one 3,785-line HTML/state/render/event module;
- duplicated form-specific draft, populate, render, and operation-building functions;
- chat-local localStorage as the primary draft/view-state design;
- direct Campaign Session queries from rendering code;
- CSS selectors and markup as the future Workspace interface.

The current Workspace is valuable as a tested interaction prototype, not as a code foundation. Wayfinder #23 should prototype the separate-page shell from the retained journeys rather than port the DOM tree.

### `index.js` and the SillyTavern bridge — retire the monolith; re-prove a thin bridge

The companion must not extract a generic utility layer from `index.js` first. Its responsibilities are coupled through shared module state, and a utility extraction would produce shallow pass-through modules while retaining the same controller.

Keep only behavior that the proxy-contract research proves SillyTavern still must own: detecting the current chat identity, exposing Chat Binding state, opening Workspace/Story Sync surfaces synchronously through supported SillyTavern mechanisms, and displaying actionable linked/unlinked failure status. Reimplement that minimum after Wayfinder #15 and #19. Prompt assembly, Campaign queries, worker jobs, full Workspace rendering, and canonical drafts do not stay in the extension.

### Behavioral tests — keep all until equivalent seams exist

Do not delete current tests during planning or early companion work. Reclassify them as migration inventory:

| Current tests | Count | Future home |
|---|---:|---|
| Campaign Session behavior | 21 | Campaign authority acceptance tests through its public interface |
| Context Capsule / Router | 5 | Context selection, budget, visibility, and diagnostic contract tests |
| Story Sync | 6 | Worker source/parser/job and Proposal lifecycle tests |
| SillyTavern storage | 1 | Legacy import fixture plus SQLite conflict/recovery scenarios |
| Workspace / bridge | 9 | Full-page Workspace component/E2E journeys and pinned-ST bridge tests |

Use replace-don't-layer testing: when a companion test exercises the same behavior through the new external seam, remove the redundant new-system test of internal helpers. Keep the fallback suite itself unchanged until real-campaign cutover succeeds; it protects the one-command fallback.

## Supporting assets

- **Reference Graph:** extract its behavior into the Campaign authority's implementation; it is a useful internal module and does not justify a remote port.
- **Context Inspector:** keep the explainability and control journey; rebuild its UI as the Context Tray.
- **JSON addon examples and builder:** keep the documented data fixtures and stable External ID rules. Replace automatic sync language with file-watch → diff → explicit accepted batch.
- **Manifest, installer, and CSS:** fallback-only. A future thin bridge receives its own minimal assets after the ST contract prototype.
- **Throwaway prototypes and research:** retain as evidence, never import them into production modules.

## Sequencing constraints

1. Do not refactor the fallback extension before the target runtime and ST proxy contract are chosen.
2. Use current tests and fixtures to write tracer acceptance at the future module seams.
3. Build new modules beside the extension; do not route the working extension through half-built companion modules.
4. Introduce an adapter only when both production and test adapters are real. Do not create speculative ports around pure in-process logic.
5. Retire fallback files only after campaign import, Chat Binding, retrieval, generation, Workspace, and real-phone cutover all pass.

## Approval decision

Approve the following disposition as the input to later Wayfinder design:

- **Campaign Session:** extract behavior and tests; do not reuse the browser implementation.
- **Context compiler/router:** extract deterministic selection, rendering, and diagnostics; replace its contract and integration.
- **Story Sync:** extract bounded source/parser/prompt behavior; replace the ST worker and Popup controller.
- **SillyTavern storage:** retire from production; keep only migration/failure evidence.
- **Workspace:** preserve interaction journeys; rebuild the separate-page implementation.
- **`index.js`:** retire the monolith; later reimplement only the proven thin bridge.
- **Tests:** retain the fallback suite and migrate scenarios to new external seams before deleting any equivalent coverage.
