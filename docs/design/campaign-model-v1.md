# Canonical Campaign Model v1

Status: working fallback architecture. Its normalized Record model, typed Operations, and existing Workspace workflows remain production evidence. Its one-chat metadata authority, deferred cross-chat Campaigns, separate SillyTavern worker profile, and pre-generation-only context router are superseded for the companion architecture by [ADR 0007](../adr/0007-separate-campaign-authority-from-chat-bindings.md), [ADR 0008](../adr/0008-use-sqlite-as-campaign-authority.md), [ADR 0009](../adr/0009-require-human-review-for-model-assisted-campaign-changes.md), and [ADR 0010](../adr/0010-use-preflight-context-with-bounded-hidden-draft-enrichment.md).

Character, Inventory, Abilities, People, Relationships, Objectives, World, Current Scene, and guarded Advance Scene have first-class Workspace workflows in `extension/st-rpg-campaign`. Typed external JSON authoring covers the same content model. Addons and forms route through the same Campaign Session, resolve typed references, and feed deterministic context. Production owns a durable native-popup Story Sync Review Inbox with editable field-level proposals, accept/reject, and reviewed-range boundary advancement. Long-chat durability, branch recovery, measured capsule budgets, broader proposal types, and final model-adherence evidence remain open fallback-extension gates.

## Outcome

Campaign Model v1 is a normalized document with stable IDs, discriminated Record types, explicit live entries, one Campaign-wide revision, typed operations, immutable accepted events, immutable closed scenes, and a deterministic cached Context Capsule. It is intentionally system-agnostic without exposing an arbitrary `data` dictionary or page/schema builder.

The first production tracer was Inventory because it exercises the most important seam end to end: create an Item in place, add a Possession, edit quantity/equipment, compile context, persist with acknowledgement, recover failure, and render correctly on mobile. Abilities proves the same Campaign Session seam for an Ability definition plus its actor-specific Learned Ability. People now adds NPC Actor records and explicitly directed Relationships, including guarded cleanup of references before permanent Actor deletion.

## Collection views

Collections are Workspace queries, not storage containers.

| Workspace collection | Primary content | Colocated creation |
|---|---|---|
| Character | Player Character, conditions, meters | Add condition or meter in the Character block |
| Inventory | Possessions joined with Item Records | Find Item → add Possession; or create Item → add Possession |
| Abilities | Learned Abilities joined with Ability Records | Find Ability → learn; or create Ability → learn |
| People | NPC Actors and directed Relationships | Find Actor → relate; or create Actor → relate |
| Objectives | Quest Records | Create Quest or add a step in the current Quest |
| World | Facts, Places, and World Objects | Create the required Record inside the referencing block |
| Current Scene | Scene, Presences, exits, obstacles, countdowns, threads | Attach existing subject or create it without leaving the Scene |

Creating a definition does not silently create a live entry. The colocated workflow performs both explicit operations in one atomic batch after showing the consequence: for example, “Create Item and add to Lavir’s inventory ×1.”

## Production sequence

1. **Complete:** normalized Campaign Session, verified persistence, Inventory, Abilities, People, and Relationships.
2. **Complete:** additive typed JSON authoring for every editable v1 content kind, including stable nested Quest/Scene IDs and deterministic context compilation.
3. **Complete:** first-class Character and Objectives collection editors using the existing save/undo/draft conventions.
4. **Complete:** World editors for Facts, Places, and World Objects, with in-place typed reference selection and linked-record quick creation.
5. **Complete:** Current Scene editor and guarded Advance Scene transaction producing immutable Scene Archives.
6. **Complete:** durable Story Sync proposals for Character, Item, Ability, NPC, Quest, Fact, and Current Scene field changes; approval reuses Campaign Operations and advances the Sync Boundary only after review.
7. **Complete:** deterministic 8,000-character Context Capsule ceiling, per-section budgets, overflow diagnostics, exact-text inspector, and verified pin/automatic/exclude controls.
8. **Next:** tune budgets with real long-chat evidence, expand proposal targets where useful, and complete branch-recovery, weak-model, mobile, and durability evidence below.

## Record union

Every Record has common fields:

- stable opaque `id`;
- discriminant `kind`;
- `name`, short `summary`, optional long `details`;
- canonical category and user tags;
- archive metadata;
- the Campaign revisions in which it was created and last changed;
- a small context policy: automatic, pinned, or excluded.

There is no public generic payload. Each kind has a validated shape:

### Actor

- role: player character or NPC;
- aliases and pronouns;
- appearance, personality, goals, and voice notes;
- current conditions and simple labeled meters;
- no duplicated current location or inventory arrays.

The Campaign identifies one Actor as the solo Player Character. Supporting other Actors does not require a second content model.

### Item

- item category;
- portable/unique flags;
- descriptive traits;
- optional default equipment slots;
- no owner, quantity, equipped state, or current location.

Two distinct swords can share one Item Record and use separate Possessions when their condition or notes differ. A truly unique artifact may still have one Item Record and one Possession.

### Ability

- ability category: spell, skill, feat, or power;
- usage description and limits;
- optional default resource label;
- no learner, prepared state, charges, or current uses.

### Quest

- status: planned, active, blocked, completed, failed, or archived;
- stakes and outcome;
- ordered steps with independent status;
- stable references to involved Records.

### Fact

- concise proposition;
- scope/category;
- optional subject Record reference;
- importance/context policy.

Facts are canonical claims, not copies of chat prose. Source provenance lives on Proposals and Campaign Events.

### Place

- place category;
- description and atmosphere;
- stable references to containing/connected Places when known.

### World Object

- object category;
- description and durable state;
- optional home Place reference;
- no Scene-specific presence state.

## Live entry union

Live entries also have stable IDs, revision metadata, and archive state. Their shapes are explicit.

### Possession

- owner Actor ID;
- Item ID;
- non-negative quantity;
- carried state: carried, worn, stored, missing, consumed, or other explicit state;
- zero or more equipped slots;
- instance-specific label, condition, and notes.

Quantity zero is not automatic deletion. The UI offers archive/remove as a separate decision so failed transactions and narrative provenance remain understandable.

### Learned Ability

- Actor ID and Ability ID;
- access state: learned, prepared, enabled, unavailable, or forgotten;
- optional current/max uses;
- instance-specific notes.

### Relationship

- source Actor ID and target Actor ID;
- relationship kind and lifecycle status;
- notes from the source Actor’s perspective;
- optional bounded affinity, trust, respect, fear, tension, and debt dimensions.

Direction is deliberate: Lavir trusting the Player Character does not imply the Player Character trusts Lavir. The UI may display reciprocal Relationships together but cannot collapse them into a shared name-keyed row.

### Scene Presence

- Scene ID;
- typed subject reference to an Actor, Item, Possession, or World Object;
- scene role;
- present, hidden, departed, destroyed, or other explicit presence state;
- scene-specific notes.

Detaching a Presence does not delete its subject Record. Closing the Scene captures the final Presences in the immutable Scene Archive.

## Current Scene

Exactly zero or one Scene is open. An open Scene contains:

- stable ID, title, optional Place ID, and summary;
- starting message-prefix anchor;
- Scene Presence IDs;
- ordered exits with optional destination Place references;
- ordered obstacles;
- labeled countdowns/clocks without formulas;
- open threads that are immediate scene concerns, not Quests;
- editable transition notes.

Advance Scene atomically:

1. validates and closes the current Scene;
2. writes one immutable Scene Archive with the ending message anchor;
3. creates the next open Scene from user-edited input;
4. carries selected unresolved threads forward;
5. leaves Story Sync Proposals pending rather than forcing review.

If analysis fails, the user can complete all five steps manually using the same fields.

## References and lifecycle invariants

- Every reference uses stable ID plus an allowed target kind; names are presentation only.
- Renaming never rewrites references.
- A Record may be archived while referenced; archived references remain resolvable and visibly marked.
- Delete previews return every surviving blocker. Delete either removes the target atomically or changes nothing.
- Deleting a definition never cascades through Possessions, Learned Abilities, Relationships, Presences, Quests, Facts, Events, or Scene Archives.
- Closed Scene Archives and Campaign Events cannot be edited or deleted through ordinary operations.
- Bulk operations are atomic and exclude permanent deletion.
- There is no arbitrary public `data` dictionary and no name-keyed canonical map.

## Campaign Session module

The Campaign Session is the sole mutation seam used by the Workspace and model-assisted workflows. Its external interface stays small:

```text
open(chatBinding) -> CampaignStatus
query(CampaignQuery) -> CampaignView
preview(CampaignOperation) -> Impact
execute(CampaignOperation, expectedRevision) -> MutationResult
subscribe(listener) -> unsubscribe
```

The interface hides validation, normalization, reference checking, revision conflicts, inverse recovery data, event creation, context compilation, pending browser journaling, SillyTavern metadata persistence, server readback, and prompt registration.

`MutationResult` returns the verified Campaign Revision, affected stable IDs, user-facing impact, undo eligibility, and refreshed views. It never returns instructions for callers to mutate JSON.

The production SillyTavern storage adapter and an in-memory test adapter satisfy the internal persistence port. If the durability prototype ultimately requires a server plugin, that plugin replaces the production adapter without changing forms, operations, or Campaign queries.

## Operation families

Operations are a discriminated union, not string commands:

- create, update, archive, restore, and safe-delete Record;
- add/update/archive Possession;
- learn/update/archive Learned Ability;
- create/update/archive Relationship;
- attach/update/detach Scene Presence;
- update Quest status/steps;
- update open Scene elements;
- open/advance Scene;
- accept or reject Proposal;
- atomic batch for colocated create-and-attach and bulk archive/tag/category operations.

Story Sync output is validated into proposed operations. Accepting a Proposal submits those same operations. Slash commands, if retained at all, are compatibility adapters that parse into the union and never receive a separate mutation implementation.

## Context Capsule rules

The Context Capsule Core is compiled inside the Campaign Session after validation and before persistence. Campaign state and Core are committed as one matching envelope. Before normal narration, the extension derives an ephemeral Context Focus from that verified Campaign Revision and recent chat, then registers Core plus Focus under one 8,000-character ceiling.

Default selection is deterministic:

- Player Character identity, conditions, and active meters;
- active Possessions and available Learned Abilities as compact name/state indexes;
- open Scene, Place, Presences, exits, obstacles, countdowns, and threads;
- active/blocked Quests and their next unresolved step;
- compact People, Relationship, Objective, and World indexes, with critical truths retained in Core;
- detailed Records selected by exact names/aliases, rarity-weighted text matches, collection intent, current Scene membership, recent mentions, pins, manual next-reply focus, and one-hop typed links.

Archived or explicitly excluded content is omitted. Pinned content receives deterministic Focus priority. Overflow and selection reasons are visible in Narrator Context. Routing performs no model call, embedding request, Campaign write, or World Info synchronization, and the narrator is never required to use tools.

The Record is the source of Item, Ability, Actor, Place, and World Object descriptions. SillyTavern World Info is neither canonical storage nor a required mirror.

## Review Inbox and provenance

Story Sync creates bounded Proposals containing:

- typed proposed operations;
- source message range and fingerprints;
- confidence and validation warnings;
- short source excerpts needed for review;
- pending, accepted, or rejected state.

Only unresolved Proposals need durable storage. Raw model output and parser diagnostics stay outside the canonical Campaign document unless explicitly exported for debugging. Accepting a Proposal creates normal Campaign Events; it does not create a second journal mutation path.

## Persistence envelope

The stored envelope contains:

- schema version and Campaign identity/binding/lineage;
- current normalized Records, live entries, and open Scene;
- Campaign revision and compact reverse change trail anchored to message prefixes;
- immutable accepted events and Scene Archives under explicit retention rules;
- unresolved Proposals and sync boundary fingerprints;
- cached Context Capsule with matching revision/commit identity.

The browser recovery journal stores at most one pending candidate per chat. A candidate is not exposed as verified state until durable readback confirms its commit identity. The previous verified envelope and capsule remain usable after save or verification failure.

## Explicitly deferred

- user-authored schemas, formulas, and arbitrary page builders;
- multiplayer and concurrent authors;
- generic rules engine or D&D-specific mechanics;
- automatic vector retrieval or generated World Info;
- cross-chat shared Campaigns;
- large attachments inside Campaign metadata;
- independent Record-level revisions;
- permanent audit retention without measured size limits.

Custom fields may be added later only as a versioned discriminated field subsystem with validation and context policy. They must not reintroduce an untyped payload bag.

## First tracer acceptance journey

1. In Inventory, select **Add item**.
2. Search existing Item Records inline.
3. Choose an existing Item or create a new Item without losing the Inventory draft.
4. Confirm owner and starting quantity, then submit one atomic operation/batch.
5. See the new Possession immediately, edit quantity/equipment inline, and receive a temporary Undo while the revision remains current.
6. Confirm the matching Item/Possession appears in the exact Context Capsule.
7. Simulate a failed save; retain all input and the previous verified Campaign/capsule.
8. Retry and verify the saved commit through the Campaign Session.
9. Complete the entire flow at roughly 360 px without horizontal overflow or leaving Inventory.

This tracer is successful only if no UI code understands Campaign JSON layout and no mutation path bypasses the Campaign Session.

## Remaining evidence before architecture acceptance

- durability and latency in a long real chat, not the current zero-message fixture;
- old-message branch recovery with at least two later Campaign revisions;
- exact Context Capsule placement/adherence in representative Chat Completion and Text Completion models;
- weak-model Story Sync parsing, repair, and partial-result behavior;
- bounded growth policy for reverse revisions, events, Scene Archives, and unresolved Proposals.
