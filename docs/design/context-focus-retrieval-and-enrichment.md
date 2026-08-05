# Context Focus retrieval and hidden-draft enrichment

Status: accepted as the provisional design for Wayfinder issue #21. Wayfinder #22 must measure the hidden-draft workflow against representative local models on the target 16 GB system before #26 makes this implementation authority.

## Decision

Context is a deterministic, read-only capability that produces one inspectable `ContextPlan` for a pinned Campaign Revision and Chat Binding Revision. It renders curated narrator views rather than raw Records, enforces Narrator Visibility before retrieval, preserves ordered per-binding manual pins, and fills the remaining budget through a fixed retrieval ladder:

1. required core state;
2. manual pins;
3. unique exact names and aliases;
4. current-Scene structural anchors;
5. qualified FTS5 matches;
6. optional profile-gated vector matches;
7. bounded one-hop relation expansion.

The ladder is precedence, not a blended relevance score. A lower tier never outranks a higher tier. Candidates inside one tier use deterministic tie-breakers. Plain text cannot resolve an ambiguous identity: if several Records remain plausible, Context selects none of them and reports one `AmbiguitySet` in the Context Tray.

Linked narration first creates a hidden Narration Draft from deterministic preflight context. The draft is ephemeral process memory and is never written to SQLite, chat, files, logs, diagnostics, or Campaign history. Context may use the draft to retrieve additional Records and run at most two full enrichment revisions. A revision may enrich or repair the previous candidate, but it must preserve material actions, dialogue intent, introduced subjects, numbers, and outcomes. The final visible reply is delivered atomically.

Manual pins are Chat Binding state. They are rendered in their complete curated narrator view and are never silently truncated, reordered, expired, or removed. If required core state plus pins cannot fit, generation stops before model work and returns an actionable budget Problem.

Narrator model behavior is selected through an exact model profile keyed by LM Studio connection and model ID. Serialization, placement, output reserve, reasoning compatibility, token estimation, and optional embedding thresholds are profile data rather than global guesses. An unscreened model receives the conservative plain-labelled format, vectors disabled, and an explicit unscreened diagnostic.

## Evidence and superseded behavior

The fallback extension supplies useful executable evidence:

- `context-capsule.js` proves that a compact authoritative index, per-section diagnostics, and Record-specific live-state joins are valuable;
- `context-router.js` proves exact-name routing, recent-message weighting, record-kind detail renderers, one-hop relations, visible reasons, and omission reporting;
- the model-screening notes prove that context serialization and placement vary by exact model and that reasoning-only models may return no visible answer;
- ADR 0010 fixes deterministic preflight, ephemeral hidden drafts, human-visible recovery, Narrator Visibility, and a two-revision cap.

The new companion does not copy these fallback behaviors:

- character-count budgets;
- one global Record `contextPolicy` combining visibility and pinning;
- broad collection requests that select arbitrary “top current” Records;
- global pinned Records shared by every chat;
- silent truncation of forced material;
- automatic selection from score alone when identity is ambiguous;
- multilingual retrieval heuristics in the first English-only implementation;
- prompt serialization hard-coded globally.

## Domain additions

### Narrator View

A deterministic, versioned projection of one Record and its relevant live entries for narration. It contains only curated fields, stable labels, and human-reviewed summaries. It never contains raw JSON, storage metadata, archived material, Campaign Private material, or unrelated fields.

### Context Plan

An immutable ephemeral result of one Context planning phase. It pins authority revisions, budget accounting, rendered blocks, selected Records, omissions, ambiguity sets, and model-profile decisions. A plan is operational evidence rather than Campaign truth.

### Context Selection

One Record or required core block included by a Context Plan, with its precedence tier, reason, visibility, token estimate, source terms, and relation source when applicable.

### Context Omission

One eligible or considered subject excluded from a Context Plan with a closed reason code such as visibility, ambiguity, threshold, duplicate, record limit, or token budget.

### Ambiguity Set

Two or more Records that match the same textual reference without unique structural evidence. Context reports the candidates and selects none. A person may resolve the next attempt by pinning a Record or editing names/aliases.

### Narrator Model Profile

A reviewed compatibility record for one LM Studio base URL and exact model ID. It defines context window, visible-output reserve, prompt serialization and placement, readiness status, token estimator, allowed request controls, and optional embedding configuration.

These concepts do not create new Campaign Record kinds. Manual pins remain a Chat Binding facet. Human-reviewed `summary` fields on Records and Scene Archives are the v1 Reviewed Summary source; a model may propose a summary, but it becomes usable canonical text only after a human accepts the corresponding Operation.

## Ownership and persistence

SQLite persists only canonical or explicitly accepted state:

- Record and live-entry fields, including Narrator Visibility and reviewed summaries;
- ordered manual Context Focus pins on each Chat Binding;
- the Chat Binding Revision and facet revision changed by pin/unpin/reorder Operations;
- selected companion settings and reviewed Narrator Model Profiles;
- optional embedding rows derived from eligible canonical narrator-search documents, keyed by Record Revision and embedding profile.

SQLite does not persist:

- automatic selections;
- Context Plans;
- rendered prompt text;
- Narration Drafts;
- enrichment candidates;
- model reasoning;
- volatile recovery entries;
- retrieval queries;
- automatic ambiguity choices.

The companion may retain a bounded in-memory diagnostic summary for the latest 20 linked attempts per host, expiring after 30 minutes. That summary contains IDs, names, visibility labels, reasons, token estimates, timings, Problems, and model-profile IDs. It contains no prompt text, hidden draft, final prose, secret field values, or private material. Restart clears it.

A manual pin is an ordered `RecordId` in one Chat Binding. Pin, unpin, and reorder are accepted `BindingOperation`s using the expected Binding facet revision. They create Binding Events and never Campaign Events. Deleted, archived, or Campaign Private Records cannot remain effective pins; the planner returns an actionable stale-pin Problem rather than silently deleting the pin.

## Pinned authority for one attempt

Narration verifies the route and pins these values before Context runs:

```ts
type PinnedNarrationAuthority = Readonly<{
  campaignId: CampaignId;
  campaignRevision: CampaignRevision;
  bindingId: ChatBindingId;
  bindingRevision: BindingRevision;
  contextFocusRevision: BindingFacetRevision;
  campaignAnchor: CampaignRevision;
}>;
```

Every preflight and enrichment plan in one attempt uses this authority. Later edits do not alter an in-flight attempt. A recovery action is valid only while its pinned authority and request-body fingerprint still match. The next ordinary request observes newer revisions.

Context reads numbered Campaign and Binding state through semantic readers. It does not read mutable projections without revision verification, hold a SQLite transaction across model work, or accept caller-supplied Record bodies.

## Curated narrator views

The renderer has two view depths.

### Compact index view

Compact views establish authoritative current state and disambiguation anchors. They use stable IDs internally and human-readable names in prompt text.

Required compact material, in order:

1. Campaign Revision and Binding identity statement;
2. Player Character identity, current conditions, meters, and immediate goals;
3. Current Scene title, place, summary, active obstacles, countdowns, exits, and open threads;
4. active Scene Presences with role and current state;
5. currently equipped, worn, and carried Possessions as an index;
6. prepared/enabled/available Abilities as an index;
7. active or blocked Quests with the next unresolved step;
8. compact names of directly connected Known or Narrator Secret subjects needed to interpret the above.

The compact renderer omits empty sections. Required identity and Scene facts must fit or planning fails. Lower-priority index rows may be omitted with diagnostics; they are never cut mid-field.

### Detail view

A detail view is rendered for each effective manual pin and selected automatic Record. It joins canonical definition with relevant live state:

- Actor: identity, aliases, appearance, personality, goals, voice, conditions, reviewed summary, and bounded active Relationships;
- Item: category, tags, reviewed summary, details, ownership, quantity, carried state, equipment slots, condition, and instance notes;
- Ability: category, reviewed summary, usage, limits, and learned/prepared/use state;
- Quest: state, reviewed summary, stakes, ordered unresolved steps, involved Records, and outcome when known;
- Fact: proposition, scope, importance, subject, reviewed summary, and reviewed evidence/details;
- Place: category, reviewed summary, atmosphere, parent, and bounded connections;
- World Object: category, reviewed summary, current state, home Place, and details;
- Scene Archive: reviewed summary, outcomes, unresolved threads, and involved Records when selected for historical continuity.

A view is complete according to its versioned renderer, not according to raw Record size. The renderer does not arbitrary-slice individual fields. Field limits are domain validation limits applied when data is accepted. If one full view is too large for the available budget, a manual pin blocks generation and an automatic candidate is omitted.

Every rendered block includes a stable internal source list in the `ContextPlan`; IDs are omitted from ordinary prose unless the model profile requires them.

## Narrator Visibility

Visibility is evaluated before indexing, ranking, expansion, rendering, and embedding lookup.

### Known

Known material may be selected, sent, used, and directly revealed. It appears under an ordinary authoritative-data block.

### Narrator Secret

Narrator Secret material may be indexed and selected. It is rendered in a separate block labelled as hidden causal context:

```text
NARRATOR SECRET — USE SILENTLY
Use this material to maintain causality and characterization. Do not state,
confirm, quote, or expose it directly unless visible events independently
make it Known in the supplied Campaign state.
```

A Secret selection is visible to the player in the Context Tray because the Workspace is the Campaign-authoring surface. The narrator may imply effects while preserving the secret. Enrichment validation rejects a candidate that reproduces distinctive secret sentences or labels verbatim.

### Campaign Private

Campaign Private material is absent from the narrator-search document set, FTS table, embedding table used by Context, prompt rendering, model requests, relation expansion, and operational diagnostics. The player-facing Context Tray may state that a named manual pin is unavailable because it is Campaign Private, but no private field value enters the plan.

Changing visibility is a Campaign Operation. Context never changes it.

## Budget model

All budgets are token budgets. Character counts are diagnostic only.

The Narrator Model Profile supplies:

```ts
type ContextCapacity = Readonly<{
  contextWindowTokens: number;
  requestedVisibleOutputTokens: number;
  safetyMarginTokens: number;
  maxCampaignTokens: number;
  maxAutomaticRecords: number;
  maxRelationExpansions: number;
}>;
```

The default reviewed profile values are:

```text
safetyMarginTokens = max(1024, ceil(contextWindowTokens * 0.05))
maxCampaignTokens  = min(8192, floor(contextWindowTokens * 0.35))
maxAutomaticRecords = 10
maxRelationExpansions = 4
```

For one phase:

```text
input ceiling = context window
              - requested visible output
              - safety margin

available campaign budget = min(
  maxCampaignTokens,
  input ceiling
    - estimated tokens already present in the ST Chat Completion messages
    - companion instruction overhead
    - phase-specific draft/revision material
)
```

The conservative fallback estimator is:

```text
estimated tokens = ceil(UTF-8 bytes / 3) + per-message overhead
```

A screened profile may replace it with a model-specific tokenizer Adapter. The planner never assumes the common four-characters-per-token approximation for safety.

Allocation order is strict:

1. companion instruction overhead;
2. required compact core;
3. all ordered manual pins in full detail;
4. automatic detail Records in retrieval order;
5. relation expansions.

No percentage sub-budget may starve pins. Automatic material uses the remainder. If core does not fit, return `context_core_over_budget`. If core plus pins does not fit, return `context_pins_over_budget` with each pin cost and actions to open Context Tray, unpin, or choose a larger profile. Model work has not begun at either failure.

Enrichment planning recalculates the complete input budget including the draft or previous revision. It may omit new automatic material. It may not remove preflight pins, required core, or already supplied material needed to interpret the draft.

## Search documents

Context maintains a derived narrator-search document per eligible Record Revision. The document contains only fields allowed by Narrator Visibility and the Record-kind renderer:

- normalized name and aliases;
- category and tags;
- reviewed summary;
- selected searchable detail fields;
- names of directly referenced Records;
- relevant live-state labels such as equipped slot, prepared state, Quest status, or current Place.

Normalization uses Unicode NFKC, locale-independent case folding, punctuation-to-space, whitespace collapse, and English stop-word filtering. Names and aliases retain a separate exact-normalized representation. Search documents are rebuilt transactionally after an accepted Operation commits; stale derived rows are never used for a later Campaign Revision.

The first implementation uses SQLite FTS5 with `unicode61 remove_diacritics 2`. Workspace search and narrator retrieval may share source projections, but Context always applies its visibility filter and revision key. Campaign Private text never enters the narrator FTS table.

Optional embeddings are local derived data, never Campaign authority. Rows are keyed by `(recordId, recordRevision, embeddingProfileId)`. Missing, stale, or failed embeddings degrade to FTS-only retrieval and produce a diagnostic; they never block narration unless a manually selected model profile explicitly requires vectors.

## Retrieval input

Preflight retrieval uses:

- the current user message in full;
- up to the preceding seven non-system user/assistant messages;
- at most 2,000 estimated tokens of recent excerpt, newest first;
- current Scene structural IDs;
- ordered manual pins;
- the pinned Campaign and Binding revisions.

System prompts, existing injected RPG blocks, hidden reasoning, tool messages, and unrelated extension metadata are excluded from retrieval text. Historical tool-role messages may remain in the upstream completion body but do not become retrieval evidence.

Enrichment retrieval uses:

- the same current user message;
- the hidden draft or latest enrichment candidate;
- existing selections, so duplicate material is not selected again;
- no broad collection fallback.

## Retrieval ladder

### Tier 0 — required core

Required compact core is selected by Campaign structure rather than text similarity. It always precedes automatic details and is reported as `required-core`.

### Tier 1 — manual pins

Ordered effective pins are selected as `manual-pin`. A pin does not make a Record Known, override Campaign Private, restore an archived Record, or bypass a stale Binding revision. Pins are included in the same order stored by the Chat Binding.

### Tier 2 — unique exact mention

Names and aliases are matched using normalized whole-word or whole-phrase boundaries. Longer overlapping aliases are evaluated first. Evidence is ordered:

1. explicit Record ID supplied by an owned Workspace action;
2. current user message;
3. hidden draft/latest candidate during enrichment;
4. recent chat excerpt, newest first.

An exact textual mention qualifies only when one Record remains after visibility and structural scoping. Structural scoping may make a match unique only through one of these facts:

- exactly one matching Record has an active Scene Presence;
- exactly one matching Item is the referenced active Possession in the Scene;
- exactly one matching Record is already manually pinned;
- an owned Workspace action supplied the canonical Record ID.

Ranking score, Quest importance, recency, equipment state, or vector similarity cannot resolve identity. If several Records remain, Context creates an `AmbiguitySet`, selects none of them through that mention, and does not let FTS or vectors reintroduce them for the same query span.

This rule yields the required wardrobe behavior: one uniquely scoped wardrobe may enrich; several plausible wardrobes produce an ambiguity diagnostic and no wardrobe detail.

### Tier 3 — Scene structural anchors

After exact mentions, Context may select detailed views for current Place, active Scene Presences, active Scene World Objects, and Records directly referenced by active obstacles, exits, countdowns, or threads. Scene membership is accepted structural evidence and does not require lexical similarity.

Scene anchors already represented by a sufficient compact core row are not duplicated as detail unless they are exact-mentioned, manually pinned, or the renderer identifies additional material fields. Automatic Scene detail is capped at four Records before general retrieval.

### Tier 4 — FTS5

Context builds one escaped FTS query from significant English terms and quoted multi-word phrases. It requests at most 16 candidates. A candidate qualifies only when:

- it is not excluded, private, archived, deleted, already selected, or inside an unresolved Ambiguity Set;
- at least one quoted phrase matches, or at least two significant query terms match;
- one-term matches are allowed only when the term appears in a name, alias, category, or tag and occurs in no more than 1% of eligible search documents;
- its normalized BM25 score is within the reviewed profile's `ftsMaxNormalizedScore`;
- the candidate does not conflict with unique Scene structure.

The default FTS normalized score is:

```text
normalized = abs(bm25) / max(abs(best bm25), epsilon)
```

The reviewed fallback profile accepts `normalized <= 2.5` after the lexical qualification above. Results sort by BM25, then exact significant-term count, then current-Scene flag, then Record name, then Record ID. #22 may tighten the profile threshold from measured false positives; it may not remove lexical qualification.

FTS never selects arbitrary Records merely because a broad collection word such as “inventory”, “people”, or “world” appears. Broad requests receive compact indexes and a Context Tray ambiguity/omission explanation rather than guessed detail Records.

### Tier 5 — optional vectors

Vectors are a recall tier after qualified FTS. They are disabled unless the exact Narrator Model Profile names a reviewed local embedding profile with:

- embedding model ID and dimension;
- document-template version;
- query-template version;
- `minSimilarity`;
- `minWinnerMargin`;
- maximum candidates;
- screening evidence date.

A vector candidate qualifies only when:

- every visibility, lifecycle, duplicate, and ambiguity rule above passes;
- cosine similarity is at least the profile's `minSimilarity`;
- the candidate exceeds the next plausible candidate by at least `minWinnerMargin`, unless both candidates are independently unique structural anchors;
- the candidate is not being used to choose among same-name or same-alias Records;
- the query contains at least four significant English terms;
- no exact unresolved Ambiguity Set covers the same subject phrase.

The first unscreened/fallback profile has vectors disabled. #22 must establish thresholds before any embedding profile is accepted. A vector hit never overrides a manual pin, exact match, Scene anchor, or qualified FTS hit.

### Tier 6 — relation expansion

Context performs at most one graph hop from selected primary Records. Eligible edges are explicit Campaign references: Relationships, Quest involved references, Fact subjects, Place parent/connections, World Object home Place, Scene Presence subject, Possession-to-Item, and Learned Ability-to-Ability.

Expansion candidates sort by source tier, edge kind, target name, and target ID. They are capped by `maxRelationExpansions`, receive the remaining budget, and are selected only when their detail is needed to interpret the source. A relation label alone is insufficient when the target is ambiguous or private. Expansion never recurses.

## Deterministic selection order

Each candidate receives a lexicographic key rather than one blended score:

```ts
type SelectionOrder = readonly [
  tier: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  evidencePosition: number,
  sourceRank: number,
  lexicalRank: number,
  stableName: string,
  recordId: RecordId,
];
```

Budget filling follows this key. This makes selection reproducible and diagnostics meaningful. Model output, wall-clock timing, hash-map iteration, and database row order never affect the plan.

## Context Interface

The public deep Interface remains one method, refined as follows:

```ts
interface Context {
  plan(
    request: PreflightContextRequest | EnrichmentContextRequest,
    signal: AbortSignal,
  ): Promise<Outcome<ContextPlan>>;
}

type PreflightContextRequest = Readonly<{
  phase: "preflight";
  authority: PinnedNarrationAuthority;
  generation: "normal" | "regenerate" | "continue" | "swipe";
  chat: ChatExcerpt;
  completion: CompletionCapacity;
  modelProfile: NarratorModelProfileId;
}>;

type EnrichmentContextRequest = Readonly<{
  phase: "enrichment";
  basePlanId: ContextPlanId;
  candidate: NarrationCandidate;
  revisionNumber: 1 | 2;
  completion: CompletionCapacity;
}>;

type ContextPlan = Readonly<{
  id: ContextPlanId;
  phase: "preflight" | "enrichment";
  authority: PinnedNarrationAuthority;
  modelProfile: NarratorModelProfileSummary;
  budget: ContextBudgetReport;
  prompt: RenderedContextBlocks;
  selections: readonly ContextSelection[];
  omissions: readonly ContextOmission[];
  ambiguities: readonly AmbiguitySet[];
  timings: ContextPlanningTimings;
  contentHash: string;
}>;
```

`basePlanId` is an opaque in-memory handle. Context verifies that the plan exists, authority matches, the candidate belongs to the same Narration transaction, and the revision number is next. Callers cannot submit arbitrary text as a base plan or skip revisions.

`RenderedContextBlocks` separates Known, Narrator Secret, and preservation instructions. Fastify, the Workspace, and the ST bridge never assemble or alter these blocks.

Expected Problems include:

- `context_core_over_budget`;
- `context_pins_over_budget`;
- `context_stale_pin`;
- `context_private_pin`;
- `context_plan_expired`;
- `context_authority_mismatch`;
- `context_model_profile_missing`;
- `context_model_incompatible`;
- `context_embedding_unavailable` only when the selected reviewed profile requires it;
- `context_cancelled`.

Ambiguity and automatic omissions are successful plan diagnostics, not failures.

## Preflight workflow

1. Verify pinned authority and exact model profile.
2. Validate the completion capacity and estimate the existing ST messages.
3. Load the numbered Campaign and Binding views.
4. Validate ordered pins without changing them.
5. Apply visibility and lifecycle filters.
6. Render required compact core.
7. Render every pin in full and fail before inference if core plus pins exceed budget.
8. Run exact, Scene, FTS, optional vector, and one-hop retrieval in fixed order.
9. Fill remaining budget without partial detail blocks.
10. Render separate Known and Narrator Secret blocks using the model profile's serialization and placement.
11. Return a content-hashed plan and bounded diagnostic summary.

The hidden draft inference receives the original SillyTavern messages plus the preflight blocks. It uses the narrator model and the user-selected narrative sampling controls, subject only to reviewed profile controls needed for a visible bounded answer. It receives no tools and cannot mutate Campaign or Binding state.

## Hidden draft and enrichment workflow

The initial hidden draft does not count as an enrichment revision.

After Draft Ready:

1. Reject empty visible output, reasoning-only output, cancellation, or incompatible role/template behavior as a model Problem.
2. Build deterministic preservation anchors from the draft:
   - canonical names uniquely identified in the draft;
   - exact numbers, quantities, durations, and named outcomes;
   - quoted user text repeated by the draft;
   - explicit scene-state verbs and negations detectable by the conservative anchor parser;
   - generation semantics, especially continuation suffix boundaries.
3. Ask Context for revision 1 enrichment using the draft.
4. If the enrichment plan contains no new material selection, the draft becomes the final candidate without a rewrite.
5. Otherwise run one full revision prompt containing the draft, added context, visibility instructions, and preservation contract.
6. Perform hard deterministic checks for missing unique names, changed exact numbers, leaked secret labels/verbatim secret sentences, empty visible output, and invalid continuation shape.
7. A second revision is allowed for exactly one of two reasons:
   - repair hard preservation failures from revision 1 using the same context; or
   - enrich one newly introduced, uniquely resolvable subject whose Context plan adds material information unavailable to revision 1.
8. Repair has priority over additional retrieval. One second revision cannot do both.
9. Revision 2 is checked again. A remaining hard failure becomes recoverable enrichment failure rather than automatic fallback.
10. Buffer the complete accepted candidate, recheck cancellation, and return it for atomic delivery.

No revision runs solely for style polishing, lengthening, shortening, or “try again”. Planned revisions are not retries. An external/model failure never causes an automatic repeat after output may have been generated.

Material preservation includes semantic requirements that conservative deterministic checks cannot fully prove, especially dialogue intent and causal outcomes. #22 must measure these manually and with fixed fixtures. The implementation claims hard guarantees only for the explicit anchors above; it exposes fidelity measurements rather than pretending to solve semantic equivalence perfectly.

## Generation-mode semantics

- `normal`, `regenerate`, and `swipe` produce one complete hidden draft and complete final candidate.
- `continue` operates on a suffix contract. The draft and revisions contain only the continuation suffix; existing assistant text is supplied as immutable context and is never repeated in delivery.
- Enrichment may not change which user turn is being answered.
- Enrichment may not add a tool call, multiple choices, or assistant metadata.
- The model reported in the final OpenAI response is the actual narrator model used for the visible candidate.

## Volatile recovery

When a usable draft exists but enrichment fails, Narration may retain one volatile recovery entry:

```ts
type EnrichmentRecovery = Readonly<{
  id: RecoveryId;
  bindingId: ChatBindingId;
  locatorFingerprint: string;
  authority: PinnedNarrationAuthority;
  completionFingerprint: string;
  generation: "normal" | "regenerate" | "continue" | "swipe";
  draft: NarrationDraft;
  failedStage: "enrichment-plan" | "revision-1" | "revision-2" | "validation";
  expiresAt: Instant;
}>;
```

Rules:

- TTL is 15 minutes;
- maximum three recovery entries per Binding and 20 per process;
- insertion evicts the oldest entry and zeroes its text buffer where practical;
- restart, model change, authority change, locator mismatch, body-fingerprint change, expiry, or successful recovery invalidates it;
- it is never serialized, logged, backed up, or shown as text in diagnostics.

The user receives two explicit actions:

- **Retry enrichment**: fresh Request ID, same draft and pinned authority, one new planned enrichment workflow;
- **Use unenhanced draft**: fresh Request ID, same validations, atomic delivery of the retained draft.

The companion never chooses either action automatically. If recovery expired, the user starts a fresh generation.

## Narrator Model Profiles

A profile is keyed by `(lmStudioBaseUrlFingerprint, exactModelId, profileVersion)` and contains:

```ts
type NarratorModelProfile = Readonly<{
  id: NarratorModelProfileId;
  lmStudioBaseUrlFingerprint: string;
  modelId: string;
  profileVersion: number;
  status: "screened" | "unscreened" | "incompatible";
  contextWindowTokens: number;
  maxVisibleOutputTokens: number;
  tokenEstimator: TokenEstimatorConfig;
  serialization: "plain-labelled" | "xml";
  placement: "near-final-system" | "final-user-prefix";
  reasoningControls: Readonly<Record<string, unknown>>;
  allowedBodyOverrides: readonly string[];
  ftsMaxNormalizedScore: number;
  embedding: null | ReviewedEmbeddingProfile;
  screening: {
    testedAt: string;
    fixtureVersion: string;
    notes: string;
  };
}>;
```

Profiles never silently alter temperature, top-p, repetition controls, stop sequences, or other narrative sampling chosen in SillyTavern. They may enforce one choice, output ceiling, compatible reasoning controls, and role/prompt placement required for visible output. Every override appears in Context diagnostics.

Selection order:

1. exact screened connection/model profile;
2. exact incompatible profile, which blocks with evidence;
3. unscreened conservative profile: plain-labelled, near-final-system, vectors disabled, fallback token estimator, readiness probe required.

The 40-token visible-answer readiness probe from the existing model lab remains the gate for a newly loaded or changed model. Reasoning-only, empty, unloaded, or template-rejected results stop before a full narration workflow.

## Context Tray contract

The full-page Workspace exposes one Context Tray scoped to a Chat Binding. It shows:

- Campaign, Campaign Revision, Binding Revision, and Context Focus facet revision;
- exact narrator model/profile and screening status;
- available input, output reserve, safety margin, core cost, pin cost, automatic cost, and unused tokens;
- ordered manual pins with individual complete-view cost and pin/unpin/reorder actions;
- automatic selections grouped by tier with source phrase, relation source, visibility, and token cost;
- compact-core sections and omitted rows;
- unresolved Ambiguity Sets with candidate names/kinds and actions to open or pin;
- omissions with closed reason codes;
- whether FTS, vectors, or fallback estimation were used;
- each enrichment revision, added Record IDs, timing, and validation outcome;
- recoverable failure actions when present.

The Tray does not display hidden draft text by default and never displays model reasoning. A debug build may expose rendered Context blocks to the Campaign owner, but production diagnostics remain bounded and omit secret field text unless the user explicitly opens the source Record in Workspace.

Pin/unpin/reorder uses Binding Operations and optimistic facet concurrency. Automatic choices are preview-only and cannot be “accepted” into Campaign history. The Tray may offer **Pin for future replies**, which creates a Binding Operation, and **Use once**, which supplies an owned canonical Record ID to the next request without persisting a pin. A one-shot selection expires after one attempt and is never inferred from free text.

## Test seams

Context must be testable without Fastify, React, SillyTavern, or LM Studio. Required scripted seams:

- numbered Campaign/Binding reader;
- deterministic token estimator;
- FTS search Adapter over temporary SQLite;
- optional embedding search Adapter;
- clock and volatile plan/recovery store;
- model-profile reader;
- scripted Inference Runtime for Narration orchestration tests.

Required behavior tests include:

- private material never reaches search documents, selections, prompt blocks, embeddings, or diagnostics;
- Secret material is separately labelled and verbatim leakage is rejected;
- core and ordered pins precede automatic material;
- pins block rather than truncate;
- exact unique names select the correct Record;
- several same-name wardrobes create an Ambiguity Set and select none;
- one active Scene Presence can structurally disambiguate a same-name Record;
- broad collection words do not select arbitrary detail Records;
- FTS requires lexical qualification;
- vectors cannot choose among ambiguous same-name Records;
- one-hop expansion is capped and non-recursive;
- plans are deterministic across database row order;
- stale Record revisions invalidate search rows and plan bases;
- hidden drafts and recoveries never persist;
- no-new-material draft is delivered without a rewrite;
- revision 1 enrichment preserves hard anchors;
- revision 2 is used only for repair or one newly introduced unique subject;
- failed enrichment offers Retry or Use unenhanced draft;
- continue returns suffix only;
- cancellation reaches every planning and inference stage;
- model-profile changes invalidate recovery and rerun readiness checks.

## Prototype obligations for #22

Wayfinder #22 must run on the target 16 GB machine with representative narrator models and record:

1. exact wardrobe match versus several-wardrobe ambiguity;
2. FTS-only and optional vector recall with false-positive fixtures;
3. preflight latency and token cost;
4. hidden draft latency, visible-output readiness, and reasoning behavior;
5. revision 1 and revision 2 latency;
6. preservation of material actions, dialogue intent, entities, numbers, and outcomes;
7. Secret non-disclosure and Campaign Private absence;
8. failure after draft, Retry, Use unenhanced draft, Stop, and process restart;
9. model swap and profile selection;
10. whether the second enrichment revision provides enough value to retain.

The prototype may tune reviewed profile thresholds and budgets. It may not weaken authority pinning, visibility, ambiguity, manual-pin, no-persistence, human-recovery, or atomic-delivery invariants.

## Rejected designs

- One blended relevance score: obscures precedence and permits weak semantic similarity to outrank exact or structural evidence.
- Global pinned Records: leaks one chat's focus into unrelated chats and confuses visibility with selection.
- Automatic ambiguity resolution by score: guesses identity and fails the wardrobe acceptance case.
- Broad collection fallback: chooses arbitrary Records without subject evidence.
- Raw Record JSON in prompts: leaks storage detail and wastes budget.
- Model-generated summaries used immediately: lets unreviewed model output become future narrator context.
- Persisted hidden drafts or Context Plans: creates a second narrative history and privacy burden.
- Silent draft fallback after failed enrichment: violates explicit recovery choice.
- Automatic model retry: risks duplicate or divergent output after work has occurred.
- Unlimited recursive relation expansion: makes context unpredictable and unbounded.
- Vectors always on: adds cost and false confidence before an embedding profile is screened.
- Vector similarity as identity evidence: cannot safely resolve same-name Records.
- Truncating manual pins: violates the user's explicit focus and hides missing material.
- A model call inside Context ranking: makes planning nondeterministic and consumes the shared inference lane.
- A separate generic retrieval service or vector database: unnecessary process and operational complexity for local SQLite authority.

## Downstream decisions now unblocked

- #22 may prove hidden-draft enrichment, tune reviewed model/embedding profiles, and decide whether revision 2 earns its cost.
- #23 may design the Context Tray, ambiguity and budget surfaces against this `ContextPlan` contract.
- #24 may use the shared model-profile and inference-lane vocabulary while keeping Worker Jobs unable to mutate Campaign.
- #26 must retain the Context Module only if #22 proves that deterministic planning and bounded enrichment form a deep policy seam rather than pass-through mapping.
