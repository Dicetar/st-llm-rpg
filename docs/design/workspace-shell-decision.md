# Workspace shell decision

Status: accepted by Wayfinder #23.

## Human verdict

The actual mobile comparison produced this result:

- **Campaign Book:** acceptable on mobile.
- **Command Deck:** acceptable on mobile.
- **Ledger:** belongs in the regular desktop UI, not the mobile UI.

The exact browser, CSS viewport width, and LAN/VPN path were not recorded in the verdict. The result is nevertheless actual mobile-use evidence rather than desktop emulation. Later implementation acceptance still measures the production Workspace near the required 360 CSS pixel target and records the exact device/browser path.

## Selected shell

Use **Campaign Book** as the base Workspace shell.

Campaign Book provides one stable information architecture across desktop and mobile:

- one URL-owned route and bounded `WorkspaceDocument` per task;
- explicit draft ownership by the editor route;
- normal browser Back/Forward behavior;
- route-level pending, stale, unavailable, and recovery surfaces;
- consistent heading, focus, and accessibility structure;
- one-column mobile documents without inventing a second mobile application.

Borrow **Command Deck** patterns for operational information, especially on Campaign Home:

- Current Scene pressure and open threads;
- pending Review Inbox and failed/interrupted Worker Jobs;
- Context budget, ambiguity, and profile readiness;
- Chat Binding mismatch/collision state;
- LM Studio and companion readiness;
- addon/import warnings;
- backup and maintenance health.

Retain **Ledger** only as an optional wide-desktop Collection presentation:

- persistent Collection index beside the selected Record;
- dense scanning, filters, archive views, and keyboard-oriented repeated edits;
- the same canonical Collection and Record routes underneath;
- no Ledger tri-pane requirement outside eligible wide Collection pages.

Ledger does not receive a separate mobile adaptation. At narrow widths it collapses to the Campaign Book Collection → Record route sequence. No Record, editor, action, status, or recovery path may exist only inside the desktop split view.

## Final information architecture

Top-level chapters remain:

1. Campaign
2. People
3. Inventory
4. Abilities
5. Objectives
6. World
7. Review
8. Context
9. Import
10. System

`Advance Scene` remains a guarded workflow inside Campaign rather than a top-level chapter. Binding reconciliation is a dedicated recovery route reached from the affected task and System/Binding catalog.

## Responsive contract

### Mobile and narrow layouts

- Campaign Book route structure only.
- One content column.
- Labelled horizontally scrollable chapter rail with the active chapter visible.
- Collection lists navigate to full-width Record routes.
- No Ledger index/detail pane.
- Command Deck status cards stack vertically and appear only where operational status is useful.
- Native controls and at least 44 × 44 CSS pixel action targets.
- Sticky route actions must remain visible with safe-area and virtual-keyboard constraints.
- Import diffs and diagnostic tables provide stacked labelled representations.
- No essential hover, right-click, drag, or precision-pointer interaction.

### Regular desktop and wide layouts

- Campaign Book remains the global shell and route authority.
- Campaign Home may use Command Deck card grids.
- Collection routes may opt into Ledger index/detail mode when width permits.
- Long prose, repeaters, references, lifecycle warnings, and recovery surfaces remain full-width inside the selected task document.
- Optional two-column forms are limited to short independent fields.

## Authority and state rules

The shell decision does not change the accepted companion boundaries:

- Campaign Engine alone accepts Campaign and Binding Operations.
- Workspace loads task-oriented documents and submits explicit intents.
- Browser drafts are non-canonical until accepted.
- Stale edits preserve the draft and never silently merge.
- Story Sync Proposals remain human-reviewed.
- Context diagnostics are read-only; pins are Binding state.
- Import applies only after a visible diff as one accepted batch.
- Ledger, Command Deck, and Campaign Book are presentation patterns, never separate stores or authorities.

## Acceptance carried forward

Wayfinder #23 is complete at the shell-decision level. Production implementation must still verify on the actual phone near 360 CSS pixels:

- chapter reachability and active-tab visibility;
- editor and Review Inbox usability with the keyboard open;
- sticky-action clearance;
- no unintended horizontal page scrolling;
- stacked import/context diagnostics;
- retained drafts through navigation and structured Problems;
- focus restoration and 200% zoom behavior.

Any production failure revises the implementation, not the chosen information architecture, unless evidence shows Campaign Book itself cannot satisfy the route contract.