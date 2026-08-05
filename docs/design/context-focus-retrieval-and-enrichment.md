# Context Focus retrieval and hidden-draft enrichment

Status: accepted as the provisional design for Wayfinder issue #21. Wayfinder #22 must measure this workflow with representative local models on the target 16 GB system before #26 makes it implementation authority.

## Decision

Context is one deterministic, read-only capability. For a pinned Campaign Revision and Chat Binding Revision it produces an inspectable `ContextPlan` containing curated narrator views, visibility decisions, exact token accounting, selections, omissions, ambiguity sets, and rendered prompt blocks.

Automatic retrieval uses strict precedence rather than one blended score:

1. required core state;
2. ordered per-binding manual pins;
3. unique exact names and aliases;
4. current-Scene structural anchors;
5. lexically qualified FTS5 matches;
6. optional reviewed-profile vector matches;
7. one bounded relation hop.

A lower tier never outranks a higher tier. Plain text never resolves an ambiguous identity. When several Records remain plausible, Context selects none and reports an `AmbiguitySet`.

Linked narration creates an ephemeral hidden Narration Draft from deterministic preflight context. The draft may drive additional retrieval and at most two full enrichment revisions. Revisions must preserve material actions, dialogue intent, introduced subjects, numbers, and outcomes. The final reply is delivered atomically. Drafts, candidates, plan text, and recovery text never enter SQLite, chat, files, logs, or Campaign history.

Manual pins are ordered Chat Binding state. They use complete versioned narrator views and are never silently truncated, reordered, expired, or removed. If required core plus pins cannot fit, generation stops before model work with an actionable budget Problem.

## Evidence and superseded fallback behavior

Keep from the fallback extension:

- compact authoritative indexes;
- Record-specific detail rendering joined to live state;
- unique exact-name routing;
- recent-message evidence;
- explicit one-hop references;
- visible selection and omission reasons.

Retire from the fallback architecture:

- character-count budgets;
- one global `contextPolicy` combining visibility and pinning;
- global pinned Records shared by every chat;
- broad collection words selecting arbitrary “top current” Records;
- score-based identity guesses;
- silent truncation of forced material;
- multilingual heuristics in the first English-only implementation;
- one prompt serialization hard-coded for every model.

ADR 0010 remains authoritative for deterministic preflight, ephemeral hidden drafts, Narrator Visibility, explicit recovery, atomic delivery, and the two-revision cap.

## Domain additions

**Narrator View** is a deterministic versioned projection of one Record plus relevant live entries. It contains curated fields and human-reviewed summaries, never raw JSON.

**Context Plan** is an immutable ephemeral result of one preflight or enrichment planning phase. It pins authority, budget, rendered blocks, selections, omissions, ambiguity sets, and model-profile decisions.

**Context Selection** is one included core block or Record with retrieval tier, reason, visibility, source evidence, and token cost.

**Context Omission** is one considered subject excluded with a closed reason such as visibility, ambiguity, threshold, duplicate, record limit, or token budget.

**Ambiguity Set** is two or more Records matching one textual reference without unique structural evidence. No member is selected from that reference.

**Narrator Model Profile** is a reviewed compatibility record for one LM Studio base URL and exact model ID. It owns context capacity, visible-output readiness, serialization, placement, token estimation, reasoning controls, and optional embedding thresholds.

Existing human-reviewed Record `summary` fields and Scene Archive summaries are the v1 Reviewed Summary source. A model may propose a summary, but Context uses it only after a human accepts the corresponding Operation.

## Ownership and persistence

SQLite persists:

- canonical Record/live-entry fields and Narrator Visibility;
- ordered manual pins on each Chat Binding;
- Binding Revision and the Context Focus facet revision;
- reviewed Narrator Model Profiles;
- optional derived embeddings keyed by Record Revision and embedding profile.

SQLite does not persist:

- automatic selections;
- Context Plans or rendered prompts;
- retrieval queries;
- hidden drafts or enrichment candidates;
- model reasoning;
- volatile recovery entries.

Pin, unpin, and reorder are accepted `BindingOperation`s using optimistic facet concurrency. They create Binding Events and never Campaign Events. Archived, deleted, or Campaign Private pins cause an actionable stale/private-pin Problem; Context never silently edits the Binding.

The process may retain diagnostic summaries for the latest 20 linked attempts per host for 30 minutes. These summaries contain IDs, names, visibility labels, reasons, token costs, timings, Problems, and profile IDs. They contain no prompt text, hidden draft, final prose, secret field values, or private material. Restart clears them.

## Pinned attempt authority

Narration verifies the route and pins:

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

Every phase of one attempt uses this authority. Later edits affect only later attempts. Recovery is valid only while authority, locator, generation mode, model profile, and request-body fingerprint still match.

Context reads numbered semantic Campaign/Binding views. It never holds a SQLite transaction over model work or trusts caller-supplied Record bodies.

## Curated narrator views

### Compact core

Required compact material is rendered in this order:

1. Campaign Revision and authority statement;
2. Player Character identity, conditions, meters, and immediate goals;
3. Current Scene, current Place, obstacles, countdowns, exits, and open threads;
4. active Scene Presences with role/state;
5. equipped, worn, and carried Possessions as an index;
6. prepared/enabled/available Abilities as an index;
7. active/blocked Quests with the next unresolved step;
8. directly connected subjects needed to interpret those rows.

Required identity and Scene facts must fit or planning fails. Lower-priority index rows are omitted whole with diagnostics, never cut mid-field.

### Record detail

Pins and selected Records use complete versioned views:

- Actor: identity, aliases, appearance, personality, goals, voice, conditions, reviewed summary, bounded active Relationships;
- Item: category, tags, reviewed summary/details, ownership, quantity, carried state, equipment, condition, notes;
- Ability: category, reviewed summary, usage, limits, learned/prepared/use state;
- Quest: state, reviewed summary, stakes, unresolved steps, involved Records, known outcome;
- Fact: proposition, scope, importance, subject, reviewed summary/evidence;
- Place: category, reviewed summary, atmosphere, parent, bounded connections;
- World Object: category, reviewed summary, current state, home Place, details;
- Scene Archive: reviewed summary, outcomes, unresolved threads, involved Records.

“Complete” means complete according to the renderer schema. Field-size limits are Campaign validation rules applied when data is accepted. Context never arbitrary-slices fields. An oversized automatic view is omitted; an oversized pin blocks before inference.

## Narrator Visibility

Visibility is enforced before search-document construction, FTS, vector lookup, relation expansion, rendering, and diagnostics.

**Known** material may be selected, used, and directly revealed.

**Narrator Secret** material may be indexed and selected, but is rendered in a separate block:

```text
NARRATOR SECRET — USE SILENTLY
Maintain causality and characterization from this material. Do not state,
confirm, quote, or expose it directly unless visible supplied Campaign state
already makes it Known.
```

The Campaign owner can see that a Secret Record was selected in the Context Tray. Validation rejects distinctive verbatim secret sentences or labels in the visible candidate.

**Campaign Private** material never enters narrator search documents, embeddings, prompt blocks, model requests, relation expansion, or operational diagnostics. The Tray may say that a named pin is private without exposing private values.

Changing visibility is a Campaign Operation. Pins never override it.

## Token budget

All planning uses tokens. Character counts are diagnostic only.

A reviewed model profile supplies:

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

Default reviewed values:

```text
safety margin       = max(1024, ceil(context window * 0.05))
max Campaign tokens = min(8192, floor(context window * 0.35))
max automatic Records = 10
max relation expansions = 4
```

For each phase:

```text
input ceiling = context window - visible output reserve - safety margin
available Campaign budget = min(
  max Campaign tokens,
  input ceiling
    - estimated existing ST message tokens
    - companion instruction overhead
    - phase-specific draft/revision tokens
)
```

The conservative unscreened estimator is `ceil(UTF-8 bytes / 3)` plus per-message overhead. A screened profile may use a model-specific tokenizer Adapter.

Allocation is strict: instructions, required core, all ordered pins, automatic Records, relation expansion. No percentage sub-budget may starve pins. Core overflow returns `context_core_over_budget`. Core-plus-pins overflow returns `context_pins_over_budget` with individual pin costs and actions to open the Tray, unpin, or choose a larger profile. No model request has started.

Enrichment recalculates budget including the draft/latest candidate. It may omit new automatic material; it may not remove required core or pins.

## Search documents

Context maintains one derived narrator-search document per eligible Record Revision using only visibility-approved curated fields:

- normalized name and aliases;
- category and tags;
- reviewed summary;
- searchable detail fields;
- names of direct references;
- relevant live-state labels.

Normalization uses Unicode NFKC, case folding, punctuation-to-space, whitespace collapse, and English stop words. Exact-normalized names/aliases remain separate.

The first implementation uses SQLite FTS5 with `unicode61 remove_diacritics 2`. Search rows are revision-keyed and updated after accepted Operations. Campaign Private text never enters the narrator FTS table.

Optional embeddings are local derived data keyed by `(recordId, recordRevision, embeddingProfileId)`. Missing or stale embeddings degrade to FTS-only and add a diagnostic unless a manually selected reviewed profile explicitly requires vectors.

## Retrieval input

Preflight uses:

- current user message in full;
- up to seven preceding non-system user/assistant messages;
- at most 2,000 estimated tokens, newest first;
- Scene structural IDs;
- ordered pins;
- pinned authority.

System prompts, existing RPG injections, reasoning, tool messages, and unrelated extension metadata are excluded from retrieval evidence.

Enrichment uses current user text plus the hidden draft/latest candidate and excludes already supplied material. It has no broad collection fallback.

## Retrieval ladder

### Tier 0: required core

Selected structurally as `required-core`.

### Tier 1: manual pins

Selected in stored order as `manual-pin`. A pin cannot change visibility, lifecycle, or authority.

### Tier 2: unique exact mention

Names and aliases use normalized whole-word/phrase boundaries; longer overlapping aliases are evaluated first. Evidence order is:

1. owned Workspace action carrying canonical Record ID;
2. current user message;
3. draft/latest candidate during enrichment;
4. recent messages, newest first.

A textual mention qualifies only when one Record remains after visibility and structural scoping. Structural scoping may resolve uniqueness only when:

- exactly one matching Record has an active Scene Presence;
- exactly one matching Item is the referenced active Scene Possession;
- exactly one matching Record is manually pinned;
- an owned Workspace action supplied its ID.

Rank, importance, recency, equipment, FTS, and vectors cannot choose identity. Multiple survivors form an `AmbiguitySet`; none may re-enter through FTS/vector for that query span. Thus one uniquely scoped wardrobe may enrich, while several plausible wardrobes select none.

### Tier 3: Scene anchors

Context may select detail for current Place, active Presences, active Scene World Objects, and Records explicitly referenced by active obstacles, exits, countdowns, or threads. Automatic Scene detail is capped at four Records. A compact row is not duplicated unless detail adds material fields.

### Tier 4: FTS5

Context constructs an escaped query from significant English terms and quoted multi-word phrases and requests at most 16 rows ordered by ascending FTS5 rank/BM25 (numerically lower is better).

A candidate qualifies only when:

- lifecycle, visibility, duplicate, and ambiguity checks pass;
- one quoted phrase or at least two significant terms match;
- a one-term match appears in name/alias/category/tag and occurs in at most 1% of eligible documents;
- its relative rank loss is within the reviewed profile threshold.

Relative rank loss is:

```text
relative loss = (candidate rank - best rank) / max(abs(best rank), epsilon)
```

The fallback reviewed threshold is `<= 0.75`. Qualified rows sort by rank ascending, exact significant-term count descending, current-Scene first, name, then Record ID. #22 may tighten the profile threshold but may not remove lexical qualification.

Broad words such as “inventory”, “people”, and “world” never select arbitrary detail Records. They receive compact indexes and omission/ambiguity diagnostics.

### Tier 5: optional vectors

Vectors are disabled unless the exact model profile references a reviewed local embedding profile defining model/dimension, templates, `minSimilarity`, `minWinnerMargin`, max candidates, and evidence date.

A vector candidate qualifies only when all earlier filters pass, similarity reaches the profile threshold, it beats the next plausible candidate by the profile margin, the query has at least four significant English terms, and no ambiguity set covers the subject. Vectors never choose among same-name/alias Records and never outrank pins, exact mentions, Scene anchors, or qualified FTS.

The unscreened profile has vectors disabled. #22 must establish thresholds before a profile is accepted.

### Tier 6: relation expansion

At most one hop follows explicit Relationships, Quest involved references, Fact subjects, Place parent/connections, World Object home Place, Scene Presence subjects, Possession-to-Item, and Learned Ability-to-Ability. Expansion is capped, non-recursive, and receives only remaining budget. A relation label cannot override ambiguity or privacy.

## Deterministic ordering

Candidates use a lexicographic key:

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

Database row order, wall-clock timing, hash iteration, and model output cannot perturb a plan.

## Context Interface

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

`basePlanId` is an opaque in-memory handle. Context verifies plan ownership, authority, candidate transaction, and next revision. Callers cannot inject arbitrary base text or skip revisions. Known, Secret, and preservation blocks are structurally separate and assembled only inside Context.

Expected Problems:

- `context_core_over_budget`;
- `context_pins_over_budget`;
- `context_stale_pin`;
- `context_private_pin`;
- `context_plan_expired`;
- `context_authority_mismatch`;
- `context_model_profile_missing`;
- `context_model_incompatible`;
- `context_embedding_unavailable` when a reviewed profile requires it;
- `context_cancelled`.

Ambiguities and automatic omissions are successful diagnostics, not failures.

## Preflight workflow

1. Verify pinned authority and exact model profile.
2. Estimate existing messages and capacity.
3. Read numbered Campaign/Binding state.
4. validate ordered pins without mutation.
5. apply lifecycle and visibility filters.
6. render required core.
7. render pins and block if they do not fit.
8. run exact, Scene, FTS, optional vector, and one-hop retrieval.
9. fill remaining budget with whole detail blocks.
10. render separate Known and Secret blocks using profile serialization/placement.
11. return a content-hashed plan and bounded diagnostics.

The draft inference receives the original ST messages plus preflight blocks, uses the selected narrator model and user narrative sampling, receives no tools, and cannot mutate Campaign or Binding state.

## Hidden draft and enrichment

The initial draft does not count as an enrichment revision.

1. Empty visible output, reasoning-only output, template failure, cancellation, or model disappearance is a model Problem.
2. Build conservative preservation anchors from unique canonical names, exact numbers/quantities/durations, repeated quoted user text, detectable state verbs/negations, and continuation boundaries.
3. Plan revision 1 from the draft.
4. When revision 1 adds no material selection, deliver the draft without rewriting.
5. Otherwise run one full revision with added context and the preservation contract.
6. Check missing unique names, changed numbers, verbatim Secret leakage, empty output, and continuation shape.
7. Revision 2 is allowed only to repair a hard preservation failure or enrich one newly introduced uniquely resolvable subject. Repair has priority; one revision cannot do both.
8. Recheck revision 2. Remaining hard failure becomes recoverable enrichment failure.
9. Buffer the complete accepted candidate, recheck cancellation, then return atomic delivery.

No revision runs solely for prose polishing or “try again”. Planned revisions are not retries. The runtime can hard-check explicit anchors; dialogue intent and causal equivalence remain measured acceptance properties for #22 rather than falsely claimed perfect guarantees.

`normal`, `regenerate`, and `swipe` use complete-message candidates. `continue` uses suffix-only candidates and never repeats existing assistant text.

## Volatile recovery

When a usable draft exists but enrichment fails, Narration may retain one recovery entry containing Binding, locator fingerprint, pinned authority, body fingerprint, generation mode, draft, failed stage, and expiry.

Rules:

- TTL 15 minutes;
- maximum three entries per Binding and 20 per process;
- oldest-entry eviction;
- restart, model change, authority change, locator/body mismatch, expiry, or success invalidates it;
- no serialization, logging, backup, or draft text in diagnostics.

The user receives exactly two choices:

- **Retry enrichment** with a fresh Request ID and the same draft/authority;
- **Use unenhanced draft** with a fresh Request ID and atomic delivery.

Neither action is automatic. Expired recovery requires fresh generation.

## Narrator Model Profiles

Profiles are keyed by `(LM Studio base URL fingerprint, exact model ID, profile version)` and include:

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
  ftsMaxRelativeLoss: number;
  embedding: null | ReviewedEmbeddingProfile;
  screening: { testedAt: string; fixtureVersion: string; notes: string };
}>;
```

Profiles never silently alter temperature, top-p, repetition controls, or other SillyTavern narrative sampling. They may enforce one choice, visible output ceiling, compatible reasoning controls, and required prompt placement; every override appears in diagnostics.

Selection order:

1. exact screened profile;
2. exact incompatible profile, which blocks with evidence;
3. conservative unscreened profile: plain-labelled near-final-system, vectors off, fallback estimator, readiness probe required.

A 40-token visible-answer readiness probe gates newly loaded/changed models. Reasoning-only, empty, unloaded, or role-template-rejected output stops before full narration.

## Context Tray

The Workspace Tray is scoped to one Chat Binding and shows:

- Campaign/Binding/Context Focus revisions;
- exact model/profile and screening status;
- available input, output reserve, safety margin, core/pin/automatic costs, unused tokens;
- ordered pins with individual costs and pin/unpin/reorder actions;
- automatic selections grouped by tier with source evidence, visibility, and cost;
- compact-core omissions;
- ambiguity sets with candidate names/kinds and open/pin actions;
- closed omission reasons;
- FTS/vector/fallback-estimator use;
- each enrichment revision, added IDs, timing, and validation result;
- recovery actions.

The Tray does not display hidden drafts or model reasoning. Production diagnostics omit Secret field text; the owner opens the source Record to inspect it.

**Pin for future replies** creates a Binding Operation. **Use once** supplies an owned canonical Record ID for one attempt without persisting a pin. One-shot selections expire after that attempt and are never inferred from free text.

## Test seams and required behavior

Context is testable without Fastify, React, SillyTavern, or LM Studio through numbered Campaign/Binding readers, deterministic token estimator, temporary-SQLite FTS Adapter, optional embedding Adapter, clock/volatile stores, profile reader, and scripted Inference Runtime.

Required tests:

- Private text never reaches search, embeddings, plans, prompts, or diagnostics;
- Secret material is isolated and verbatim leakage rejected;
- core/pins precede automatic material;
- pins block rather than truncate;
- unique exact match selects correctly;
- several same-name wardrobes select none;
- unique active Scene Presence may structurally disambiguate;
- broad collection words select no arbitrary detail;
- FTS lexical qualification and correct ascending rank order;
- vectors cannot resolve identity ambiguity;
- relation expansion is capped and non-recursive;
- plans are stable across row order;
- stale derived rows and base plans are rejected;
- drafts/recoveries never persist;
- no-new-material draft avoids rewrite;
- revisions preserve hard anchors;
- revision 2 has only the two allowed reasons;
- failed enrichment offers Retry or Use draft;
- continue returns suffix only;
- cancellation reaches every stage;
- model/profile changes invalidate recovery and rerun readiness.

## Prototype obligations for #22

Run on the actual 16 GB system and record:

1. exact wardrobe versus several-wardrobe ambiguity;
2. FTS-only and optional-vector recall/false positives;
3. preflight tokens and latency;
4. hidden-draft visible-output readiness and reasoning behavior;
5. revision 1/2 latency;
6. preservation of actions, dialogue intent, entities, numbers, and outcomes;
7. Secret non-disclosure and Private absence;
8. failure after draft, Retry, Use draft, Stop, and restart;
9. model swap/profile selection;
10. whether revision 2 provides enough value to retain.

#22 may tune reviewed thresholds and budgets. It may not weaken authority, visibility, ambiguity, pin, volatility, explicit recovery, or atomic-delivery invariants.

## Rejected designs

- one blended relevance score;
- global pins;
- score-based ambiguity resolution;
- broad collection fallback;
- raw Record JSON prompts;
- unreviewed model summaries reused as truth;
- persisted hidden drafts/plans;
- silent draft fallback;
- automatic model retries;
- recursive relation expansion;
- vectors always enabled;
- vectors as identity evidence;
- truncating pins;
- model calls inside Context ranking;
- separate vector service/database.

## Downstream decisions now unblocked

- #22 may prove enrichment and tune reviewed profiles.
- #23 may design Context Tray, ambiguity, and budget UX against this contract.
- #24 may reuse model-profile vocabulary while keeping Worker Jobs read-only.
- #26 must retain Context as a separate deep Module only if prototype evidence justifies it.
