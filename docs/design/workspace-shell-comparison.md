# Full-page Campaign Workspace shell comparison

Status: **prototype ready for human comparison; decision remains provisional.** Wayfinder #23 cannot close until the three shells are compared by the user and the preferred shell receives an actual-phone verdict near 360 CSS pixels. Desktop/static inspection below recommends a direction but does not substitute for that gate.

## Decision question

Which separate-page Workspace shell best supports Campaign Collections, joined Record/live-entry editing, Review Inbox, Context diagnostics, import diffs, backups, settings, and explicit recovery on desktop and phone while keeping Campaign authority in the companion?

The selected shell must preserve these accepted boundaries:

- Campaign Engine alone accepts Campaign and Binding Operations.
- Workspace loads bounded task documents and submits explicit intents.
- Browser drafts are non-canonical until a Save or other human action is accepted.
- Campaign Revision, Binding Revision, Campaign Anchor, conflicts, collisions, and maintenance states remain visible rather than being reconciled silently.
- Story Sync Proposals require human review and never apply automatically.
- Context is read-only; manual pins are Binding state; omissions and budgets remain inspectable.
- Import changes show a diff before one accepted batch.
- The separate Workspace is full-page responsive UI. It does not copy the fallback extension's body overlay or native-Popup architecture.

Primary evidence:

- [Current extension disposition](./current-extension-disposition.md) preserves Collections → Records → Editor, colocated create-and-attach, retained drafts, explicit lifecycle, Review Inbox, Context inspection, and phone one-column editing while replacing the implementation.
- [Companion runtime and module seams](./companion-runtime-and-module-seams.md) selects task-oriented Workspace documents/intents and React Router Data Mode without making React a domain authority.
- [Campaign authority, history, and Chat Binding lifecycle](./campaign-authority-history-and-bindings.md) requires structured conflict/collision/recovery sheets, independent Campaign and Binding history, explicit stale choices, and Store Epoch reset handling.
- [Context Focus retrieval and hidden-draft enrichment](./context-focus-retrieval-and-enrichment.md) requires visible ordered selections, omissions, token accounting, ambiguities, profile readiness, and complete manual pins.

## Prototype boundary

`prototypes/workspace-shells/` is disposable evidence. It uses one deterministic in-memory `CampaignEngine` and a task-document `Workspace` facade. The browser never edits the mock authority directly. The same records, revisions, proposals, diagnostics, import preview, and backups appear in every shell.

The mock covers:

- Campaign Home and Current Scene;
- People, Inventory, Abilities, Objectives, and World Collections;
- one joined Record editor with local draft retention;
- an accepted edit advancing Campaign Revision once;
- a stale edit returning `campaign_revision_conflict` without mutation;
- Review Inbox accept/reject actions;
- Context Tray selection, omission, budget, and manual-pin behavior;
- a pin change advancing Binding Revision without Campaign Revision;
- import preview and one accepted apply batch;
- backup creation and service/Binding state.

The prototype does not prove React component architecture, production routes, HTTP schemas, database behavior, browser persistence, Service Worker/offline behavior, or SillyTavern integration. Offline mutation remains out of scope.

## Shell A — Ledger

### Shape

Ledger uses a persistent left navigation rail, a second contextual Collection/index pane, and a large work canvas. It resembles a professional database or editor application and keeps nearby Records visible during desktop editing.

Desktop hierarchy:

```text
prototype selector + authority strip
┌──────────────┬───────────────────┬──────────────────────────────┐
│ section rail │ collection/index  │ task document or editor      │
└──────────────┴───────────────────┴──────────────────────────────┘
```

Phone hierarchy:

```text
prototype selector
horizontal section rail
one route document
sticky route actions
```

The Collection/index pane disappears on phone. Route navigation becomes authoritative; the phone never tries to preserve three visible columns.

### Strengths

- Fast scanning and switching among Records on a wide desktop.
- Strong sense of Campaign location because section and Collection context remain visible.
- Efficient for repeated edits across several Actors, Items, or World Records.
- Natural home for archived filters, dense lists, keyboard search, and optional desktop split view.

### Risks

- The persistent rail plus index consumes substantial width before the editor begins.
- The desktop and phone compositions differ significantly, increasing responsive implementation and testing cost.
- A global second pane can tempt the implementation toward client-held replicated Collection state and ad hoc cross-route coordination.
- Dense layout may obscure human-review boundaries and recovery guidance if status information becomes another narrow column.

### Appropriate retained pattern

A Collection page may use a desktop-only optional index/detail split after the production routes and draft ownership are proven. The global Workspace shell should not require this pane for every route.

## Shell B — Command Deck

### Shape

Command Deck leads with Campaign health, scene pressure, Review Inbox count, Context use, and task lanes. Navigation is broad and horizontal; each selected task opens in a bordered work surface. A bottom command bar offers frequent actions.

Desktop hierarchy:

```text
service/authority header
prototype selector
horizontal task lanes
status instruments
selected work surface
command bar
```

Phone hierarchy:

```text
compact header
horizontal task lane rail
scrollable status cards
one work surface
three-action bottom bar
```

### Strengths

- Excellent Campaign-at-a-glance orientation and operational status.
- Review, failed jobs, binding mismatch, stale tabs, backup warnings, and service outage can surface prominently.
- Task cards suit occasional administration and recovery work.
- Strong separation between status and the selected task surface.

### Risks

- Long-form Record editing feels embedded inside a dashboard rather than owned by a stable document route.
- Persistent status and command bars compete with browser chrome and touch keyboards on a 360 px phone.
- Horizontal lanes and instrument cards create intentional sideways movement that may become tiring.
- It can overemphasize system health over the Campaign's actual content.

### Appropriate retained pattern

The Campaign Home should borrow its status cards: Current Scene pressure, pending Review Inbox, Context budget, stale Binding state, job/model readiness, import warnings, and backup health. These belong on Home rather than surrounding every editor.

## Shell C — Campaign Book

### Shape

Campaign Book treats top-level Workspace areas as stable chapters. Each route owns one bounded document: Home, Collection, Record editor, Review Inbox, Context Tray, Import Diff, or maintenance. Wide screens gain space and richer grids inside the page; the route hierarchy remains the same on phone.

Desktop hierarchy:

```text
Campaign identity + authority strip
prototype selector
chapter tabs
centered task document
```

Phone hierarchy:

```text
Campaign identity + authority strip
scrollable chapter tabs
full-width task document
sticky route actions when required
```

### Strengths

- The same navigation and ownership model survives desktop and phone.
- URL-owned route documents align directly with React Router loaders, actions, pending states, and error boundaries.
- Draft ownership is easy to explain: one editor route owns one draft until Save, Cancel, navigation choice, or conflict recovery.
- Review, Context, import, Binding recovery, and maintenance can each use a purpose-built document without squeezing into a universal pane.
- Heading hierarchy, landmark navigation, keyboard focus, browser Back/Forward, and 200% zoom behavior are straightforward.
- Mobile implementation requires fewer structural substitutions than Ledger or Command Deck.

### Risks

- Repeated desktop editing across many Records may require more navigation than a persistent split pane.
- Users who prefer dense database tools may perceive the centered document as spacious or slow.
- Home must carry enough operational status to prevent important queues and outages from hiding inside chapters.

### Provisional recommendation

Use **Campaign Book as the base shell**, subject to user comparison and real-phone acceptance. Add two bounded patterns from the alternatives:

1. Campaign Home adopts Command Deck status cards for scene pressure, Review Inbox, Context budget, Binding state, jobs/model readiness, import warnings, and backup health.
2. Collection routes may offer an optional wide-screen Ledger index/detail mode, but route ownership, editor URLs, drafts, errors, and actions remain valid without it.

This hybrid keeps one stable information architecture while allowing density where it genuinely benefits Collection work. It rejects a permanent global tri-pane requirement and a dashboard frame around every task.

## Provisional information architecture

Top-level chapters:

1. **Campaign** — Campaign identity, Current Scene, player condition, immediate pressure, recent accepted changes, pending queues, and service readiness.
2. **People** — Player Character and NPC Actor Records, Relationships, scene presence, archive, and reference impact.
3. **Inventory** — Item Records and joined Possession state.
4. **Abilities** — Ability Records and joined Learned Ability state.
5. **Objectives** — Quest Records, ordered steps, stakes, status, and outcomes.
6. **World** — Facts, Places, World Objects, connections, and Scene-related world state.
7. **Review** — unresolved Proposals, source ranges, editable candidate changes, job status, and accept/reject actions.
8. **Context** — current/past volatile diagnostic summaries, manual pins, ordered selection tiers, omissions, ambiguities, token accounting, and model-profile readiness. Prompt text and hidden drafts remain absent.
9. **Import** — addon/file source status, validation, preview diff, warnings, and explicit one-batch apply.
10. **System** — backups, restore, migration/update readiness, ports/services, Binding catalog/recovery, model profiles, and destructive maintenance.

`Advance Scene` belongs to the Campaign/Current Scene document as a guarded workflow rather than a permanent top-level chapter.

### Route sketch

```text
/
/campaigns
/campaigns/:campaignId
/campaigns/:campaignId/people
/campaigns/:campaignId/people/:actorId
/campaigns/:campaignId/inventory
/campaigns/:campaignId/inventory/:itemId
/campaigns/:campaignId/abilities
/campaigns/:campaignId/abilities/:abilityId
/campaigns/:campaignId/objectives
/campaigns/:campaignId/objectives/:questId
/campaigns/:campaignId/world
/campaigns/:campaignId/world/:recordId
/campaigns/:campaignId/review
/campaigns/:campaignId/context
/campaigns/:campaignId/import
/campaigns/:campaignId/system
/bindings/:bindingId/reconcile
```

Exact production URLs remain an implementation specification concern. The design requirement is that route identity, draft ownership, revision pins, and error recovery are explicit and bookmarkable where safe.

## Task-document rules

Every route loader requests one bounded `WorkspaceDocument`. Every action submits one explicit `WorkspaceIntent`. The browser does not call SQLite-shaped CRUD endpoints or synthesize Campaign Events.

A document includes only the authority evidence needed for that task:

- Campaign ID, Campaign Revision, Store Epoch, and document version;
- relevant Binding ID, Binding Revision/facet revisions, Campaign Anchor, and collision/mismatch state;
- paginated Records or one joined editor projection;
- available actions and exact expected revisions;
- structured Problems and valid Recovery Actions;
- refresh hints or an invalidation cursor.

A Save action returns the accepted revision/receipt or a structured Problem. The Workspace retains the draft after validation, reference, stale, service, or unknown-outcome failures. V1 does not silently merge stale fields.

## Draft and navigation behavior

- Multi-field editors own a route-local draft separate from loader data.
- Browser Back, chapter navigation, Campaign switching, Store Epoch reset, and service restart detect dirty drafts and require an explicit choice.
- A successful Save replaces loader authority with the accepted receipt and then revalidates the route document.
- A stale Save keeps the draft and offers: inspect current Campaign changes, reload canonical fields while preserving a copy, or cancel the attempt.
- Immediate counters/status actions remain explicit intents with revision-safe Undo when the Campaign Operation supports it.
- Creating a referenced Record from an editor uses a nested route/sheet owned by the same Workspace flow; returning restores the original draft and meaningful focus.
- No canonical draft is stored only in transient component state. The production implementation must define bounded browser draft recovery, while ensuring recovery material is never confused with accepted Campaign state.

## Responsive rules

### All widths

- One authoritative route and one primary heading.
- Campaign/Binding revision evidence remains reachable without opening developer diagnostics.
- Sticky actions appear only on routes that need them.
- Horizontal scrolling is limited to intentional chapter/tab rails and wide diff tables that also provide a stacked phone representation.
- Long prose wraps; individual fields are never clipped to preserve a card height.
- Loading, empty, stale, unavailable, canceled, migration, backup, and recovery states replace the affected document rather than appearing as transient toast-only feedback.

### Wide desktop

- Maximum readable document width around 70–80rem depending on task.
- Collections may use denser rows and an optional index/detail split.
- Editors may use two columns only for short independent fields; long prose, repeaters, references, lifecycle, and recovery remain full width.
- Review and Context may use two balanced columns when each column remains independently understandable.

### Phone near 360 CSS pixels

- One content column.
- Chapter navigation is a horizontally scrollable labelled rail with the active chapter visible.
- Forms use native controls, visible labels, and at least 44 × 44 CSS pixel targets; the prototype uses 46 px.
- Sticky Save/Cancel actions account for safe-area and virtual-keyboard obstruction in production testing.
- Tables become labelled stacked rows; before/after import values remain distinguishable.
- Record/index split mode collapses to normal Collection → Record routes.
- No essential action depends on hover, right click, drag, or precision pointer input.

## Accessibility behavior

- Use `header`, labelled `nav`, `main`, headings, forms, lists, and tables according to semantics rather than visual wrappers alone.
- Provide a skip link and move focus to the route heading/main surface after navigation when appropriate.
- Visible focus must survive every theme and high-contrast state.
- Every input has a persistent label; placeholder text is supplementary.
- Problems use programmatic alert/status semantics, identify the failed action, retain the draft, and expose labelled recovery actions.
- Validation summaries link to fields while inline messages explain correction.
- Changes in pending/accepted status use polite live announcements without stealing focus.
- Respect `prefers-reduced-motion`; no workflow requires animation.
- Support keyboard-only operation and 200% zoom without lost actions or two-dimensional page scrolling.
- Color supplements labels and icons; it never carries Create/Update/Warning, status, visibility, or conflict meaning alone.

## Human comparison matrix

The following weights are proposed before user testing. Scores must be recorded by the user after running the same trace on desktop and phone.

| Criterion | Weight | Ledger | Command Deck | Campaign Book |
|---|---:|---:|---:|---:|
| Phone comprehension and reachability | 25 | pending | pending | pending |
| Long-form editing and draft recovery | 20 | pending | pending | pending |
| Collection scanning on desktop | 15 | pending | pending | pending |
| Review/diagnostic clarity | 15 | pending | pending | pending |
| Navigation continuity and browser history | 10 | pending | pending | pending |
| Accessibility and zoom resilience | 10 | pending | pending | pending |
| Implementation locality / state simplicity | 5 | pending | pending | pending |

Use a 1–5 score and record concrete friction, not aesthetic preference alone. A shell cannot be accepted if any critical workflow is unusable on the actual phone even when its weighted total is highest.

## Required actual-phone verdict

Wayfinder #23 remains open until the user records:

- phone/browser and approximate viewport width;
- LAN or VPN path used;
- verdict for each shell on the eight-step comparison trace;
- any inaccessible control, overflow, covered sticky action, lost draft, confusing route, or focus failure;
- preferred base shell and any pattern to borrow from another shell;
- explicit **accept**, **revise**, or **reject** verdict for the provisional Campaign Book recommendation.

Desktop responsive emulation may find defects earlier. It is not final evidence.

## Verification completed in this branch

The dependency-free focused suite verifies:

- every required task document loads from the mock Workspace;
- an accepted edit advances Campaign Revision exactly once;
- a stale edit returns a structured conflict and leaves canonical state unchanged;
- manual pins advance Binding history without advancing Campaign history;
- all three shell renderers and required workflow hooks exist;
- viewport, skip link, live region, visible focus, reduced motion, phone breakpoint, and touch policy are present.

The prototype server is suitable for LAN/phone evaluation. No claim is made yet about a real-phone result, visual regression, React implementation, or Node 24-specific behavior.

## Decision after human gate

After the comparison and phone verdict:

1. revise this document with observed evidence and the selected shell;
2. create an accepted ADR for the Workspace shell and route/draft ownership;
3. update `CONTEXT.md` only if new canonical domain terms are introduced;
4. add the one-line decision gist to Wayfinder #11;
5. close #23 as completed;
6. carry remaining implementation details into #25–#28 rather than expanding the throwaway prototype.
