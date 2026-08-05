# Context Focus retrieval and narration context

Status: deterministic Context Focus remains accepted. The hidden-draft/revision portion of the earlier #21 design is superseded for v1 by measured Wayfinder #22 evidence.

## Final v1 decision

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

Version 1 performs one narrator generation from the original SillyTavern messages plus deterministic preflight Context. The complete visible reply is buffered and delivered atomically.

Version 1 does **not** use:

- hidden narration drafts;
- model-driven entity discovery from hidden prose;
- enrichment revision 1 or revision 2;
- volatile recovery entries containing discarded hidden prose;
- automatic rewrite attempts for prose polishing or preservation repair.

Wayfinder #22 measured two representative local models on the target 16 GB system. Both passed visible-output readiness but changed material events in the initial draft before enrichment began. A rewrite pipeline cannot safely improve a candidate that has already lost exact dialogue, explicit solitude, or the required closed outcome. The added calls and recovery machinery are therefore not justified for v1.

Manual pins remain ordered Chat Binding state. They use complete versioned narrator views and are never silently truncated, reordered, expired, or removed. If required core plus pins cannot fit, generation stops before model work with an actionable budget Problem.

## Evidence and retained behavior

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

## Domain additions

**Narrator View** is a deterministic versioned projection of one Record plus relevant live entries. It contains curated fields and human-reviewed summaries, never raw JSON.

**Context Plan** is an immutable ephemeral result of one preflight planning phase. It pins authority, budget, rendered blocks, selections, omissions, ambiguity sets, and model-profile decisions.

**Context Selection** is one included core block or Record with retrieval tier, reason, visibility, source evidence, and token cost.

**Context Omission** is one considered subject excluded with a closed reason such as visibility, ambiguity, threshold, duplicate, record limit, or token budget.

**Ambiguity Set** is two or more Records matching one textual reference without unique structural evidence. No member is selected from that reference.

**Narrator Model Profile** is a reviewed compatibility record for one LM Studio base URL and exact model ID. It owns context capacity, visible-output readiness, serialization, placement, token estimation, reasoning controls, and optional embedding thresholds.

Existing human-reviewed Record `summary` fields and Scene Archive summaries are the v1 Reviewed Summary source. A model may propose a summary through a separate reviewed workflow, but Context uses it only after a human accepts the corresponding Operation.

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
- model reasoning;
- generated narrator candidates.

Pin, unpin, and reorder are accepted `BindingOperation`s using optimistic facet concurrency. They create Binding Events and never Campaign Events. Archived, deleted, or Campaign Private pins cause an actionable stale/private-pin Problem; Context never silently edits the Binding.

The process may retain bounded diagnostic summaries for recent linked attempts. These contain IDs, names, visibility labels, reasons, token costs, timings, Problems, and profile IDs. They contain no prompt text, final prose, secret field values, or private material. Restart clears them.

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

The full attempt uses this authority. Later edits affect only later attempts. Context reads numbered semantic Campaign/Binding views. It never holds a SQLite transaction over model work or trusts caller-supplied Record bodies.

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

The Campaign owner can see that a Secret Record was selected in the Context Tray. Validation rejects distinctive verbatim secret sentences or labels in the visible candidate when deterministic checks are available.

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
safety margin          = max(1024, ceil(context window * 0.05))
max Campaign tokens    = min(8192, floor(context window * 0.35))
max automatic Records  = 10
max relation expansions = 4
```

For the one narration phase:

```text
input ceiling = context window - visible output reserve - safety margin
available Campaign budget = min(
  max Campaign tokens,
  input ceiling
    - estimated existing ST message tokens
    - companion instruction overhead
)
```

The conservative unscreened estimator is `ceil(UTF-8 bytes / 3)` plus per-message overhead. A screened profile may use a model-specific tokenizer Adapter.

Allocation is strict: instructions, required core, all ordered pins, automatic Records, relation expansion. No percentage sub-budget may starve pins. Core overflow returns `context_core_over_budget`. Core-plus-pins overflow returns `context_pins_over_budget` with individual pin costs and actions to open the Tray, unpin, or choose a larger profile. No model request has started.

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

## Retrieval ladder

### Tier 0: required core

Selected structurally as `required-core`.

### Tier 1: manual pins

Selected in stored order as `manual-pin`. A pin cannot change visibility, lifecycle, or authority.

### Tier 2: unique exact mention

Names and aliases use normalized whole-word/phrase boundaries; longer overlapping aliases are evaluated first. Evidence order is:

1. owned Workspace action carrying canonical Record ID;
2. current user message;
3. recent messages, newest first.

A textual mention qualifies only when one Record remains after visibility and structural scoping. Structural scoping may resolve uniqueness only when:

- exactly one matching Record has an active Scene Presence;
- exactly one matching Item is the referenced active Scene Possession;
- exactly one matching Record is manually pinned;
- an owned Workspace action supplied its ID.

Rank, importance, recency, equipment, FTS, and vectors cannot choose identity. Multiple survivors form an `AmbiguitySet`; none may re-enter through FTS/vector for that query span.

### Tier 3: Scene anchors

Context may select detail for current Place, active Presences, active Scene World Objects, and Records explicitly referenced by active obstacles, exits, countdowns, or threads. Automatic Scene detail is capped at four Records. A compact row is not duplicated unless detail adds material fields.

### Tier 4: FTS5

Context constructs an escaped query from significant English terms and quoted multi-word phrases and requests at most 16 rows ordered by ascending FTS5 rank/BM25.

A candidate qualifies only when:

- lifecycle, visibility, duplicate, and ambiguity checks pass;
- one quoted phrase or at least two significant terms match;
- a one-term match appears in name/alias/category/tag and occurs in at most 1% of eligible documents;
- its relative rank loss is within the reviewed profile threshold.

The fallback reviewed relative-loss threshold is `<= 0.75`. Qualified rows sort by rank ascending, exact significant-term count descending, current-Scene first, name, then Record ID.

Broad words such as “inventory”, “people”, and “world” never select arbitrary detail Records. They receive compact indexes and omission/ambiguity diagnostics.

### Tier 5: optional vectors

Vectors are disabled unless the exact model profile references a reviewed local embedding profile defining model/dimension, templates, `minSimilarity`, `minWinnerMargin`, max candidates, and evidence date.

A vector candidate qualifies only when all earlier filters pass, similarity reaches the profile threshold, it beats the next plausible candidate by the profile margin, the query has at least four significant English terms, and no ambiguity set covers the subject. Vectors never choose among same-name/alias Records and never outrank pins, exact mentions, Scene anchors, or qualified FTS.

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

## Context interface

```ts
interface Context {
  plan(
    request: PreflightContextRequest,
    signal: AbortSignal,
  ): Promise<Outcome<ContextPlan>>;
}
```

Expected Problems:

- `context_core_over_budget`;
- `context_pins_over_budget`;
- `context_stale_pin`;
- `context_private_pin`;
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
4. Validate ordered pins without mutation.
5. Apply lifecycle and visibility filters.
6. Render required core.
7. Render pins and block if they do not fit.
8. Run exact, Scene, FTS, optional vector, and one-hop retrieval.
9. Fill remaining budget with whole detail blocks.
10. Render separate Known and Secret blocks using profile serialization/placement.
11. Return a content-hashed plan and bounded diagnostics.
12. Run one narrator completion and atomically deliver the complete visible reply.

## Verification seams

Production tests must cover:

- deterministic selection and ordering;
- ambiguity selects nothing;
- visibility before indexing and rendering;
- private text absent from search/model requests/diagnostics;
- Secret block separation;
- pin ordering and complete-pin budget failure;
- whole-record omission rather than field slicing;
- model-profile readiness and exact model identity;
- cancellation before atomic commit;
- unlinked pass-through;
- linked authority outage before model work.

Hidden-draft and enrichment-revision tests remain historical prototype evidence only and are not production v1 requirements.
