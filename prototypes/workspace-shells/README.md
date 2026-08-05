# Campaign Workspace shell comparison

**THROWAWAY PROTOTYPE — this is decision evidence for Wayfinder #23, not production companion code. It stores disposable mock state only in browser memory.**

## Question

Which separate full-page Workspace shell best supports Campaign Collections, editing, Review Inbox, Context diagnostics, import diffs, backups, settings, conflict recovery, and one-column phone use without turning React into a second Campaign authority?

The prototype compares three deliberately different shells over the same mock `CampaignEngine` and task-oriented `Workspace` interface:

- **Ledger** — a dense desktop rail, collection index, and work canvas;
- **Command Deck** — status-first task lanes and work queues;
- **Campaign Book** — document-centric chapters with one focused route surface.

All shells expose the same mock Campaign Revision, Binding Revision, Records, Proposals, Context Plan diagnostics, import preview, and backup state. Switching shells preserves the route and mock authority so the comparison concerns navigation and interaction rather than data differences.

## Run

From the repository root:

```powershell
npm run prototype:workspace
```

Equivalent direct command:

```powershell
node prototypes/workspace-shells/server.mjs
```

Desktop URL:

```text
http://127.0.0.1:4173
```

Phone URL over the trusted LAN or VPN:

```text
http://<PC-LAN-or-VPN-IP>:4173
```

Windows Firewall may ask for permission because the prototype binds to `0.0.0.0`. Permit only the trusted network profile used for the test.

A shell may be selected directly:

```text
http://127.0.0.1:4173/?shell=ledger
http://127.0.0.1:4173/?shell=deck
http://127.0.0.1:4173/?shell=book
```

## Comparison trace

Run the same trace in each shell, first on desktop and then on the actual phone near 360 CSS pixels:

1. Open **Campaign**, identify the Current Scene, the Review Inbox count, and current Context budget.
2. Open **People**, select **Seraphine Vale**, edit the reviewed summary, and save.
3. Repeat the edit, choose **Simulate stale tab**, and save. Confirm the draft remains visible with an actionable revision-conflict surface.
4. Open **Review Inbox**. Read, edit, accept, and reject a Proposal. Confirm the UI never implies automatic application.
5. Open **Context Tray**. Explain the tier order, omissions, and token budget. Toggle the Seraphine manual pin and confirm only Binding Revision advances.
6. Open **Import Diff**. Distinguish creates, updates, warnings, and unchanged entries before applying one batch.
7. Open **Backups & Settings**. Create a validated backup and find the Binding and service state.
8. Rotate the phone, use browser Back/Forward, and return from an editor without losing route comprehension.

Record for each shell:

- time or hesitation before finding each workflow;
- whether the current Campaign/Binding revision is understandable;
- whether long Records and Proposal editing remain comfortable;
- whether sticky actions cover content or browser controls;
- whether horizontal scrolling is required anywhere except intentional tab rails;
- whether focus, labels, tap targets, and error recovery are usable;
- which shell you would choose for a real hour-long Campaign maintenance session.

## Keyboard and accessibility checks

- `Tab` reaches every navigation item, form control, and action with visible focus.
- `/` focuses a collection filter when one is available.
- The skip link moves focus to the route work surface.
- Headings remain hierarchical and each navigation surface exposes an accessible name.
- Reduced-motion preference disables the loading animation.
- Text and controls remain usable at 200% browser zoom.

## Tests

```powershell
npm run test:workspace-prototype
```

The focused suite verifies required task documents, accepted and stale mutation behavior, separate Campaign/Binding revision effects, the three shell variants, required workflow hooks, responsive breakpoints, focus styling, reduced motion, and touch-target policy.

## Artifact boundary

- `mock-workspace.mjs` is a deterministic in-memory authority and task-document facade.
- `app.mjs` renders and operates all three shells without production framework commitments.
- `styles.css` contains shell-specific desktop and phone behavior.
- `server.mjs` is a dependency-free LAN server for real-phone evaluation.
- `workspace-shells.test.mjs` is prototype evidence only.
- Durable findings and the provisional information architecture live in `docs/design/workspace-shell-comparison.md`.

No file in this directory should be imported into the production companion. Production Workspace implementation remains React, TypeScript, Vite, and React Router Data Mode after the shell decision is accepted.
