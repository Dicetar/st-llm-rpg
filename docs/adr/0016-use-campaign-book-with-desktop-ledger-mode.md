# Use Campaign Book as the Workspace shell with desktop-only Ledger mode

Status: accepted by Wayfinder #23 after actual mobile comparison.

The full-page companion Workspace uses **Campaign Book** as its base information architecture: stable URL-owned chapters and one bounded task document per route across desktop and mobile. **Command Deck** contributes status and work-queue cards to Campaign Home and other explicitly operational surfaces. **Ledger** is retained only as an optional regular desktop Collection index/detail mode; it is not a mobile shell and must collapse to ordinary Collection → Record routes below the wide-layout breakpoint.

The actual mobile verdict found Campaign Book and Command Deck usable, while Ledger belongs in the regular desktop UI. This confirms the provisional recommendation without forcing the dense tri-pane layout through a structurally different phone adaptation.

Campaign Book therefore owns route identity, draft ownership, Back/Forward behavior, pending/error boundaries, and bookmarkable recovery surfaces. Command Deck patterns may summarize Current Scene pressure, Review Inbox, Context budget, Binding state, model/job readiness, imports, backups, and service health. Ledger may improve repeated desktop Record editing, but it cannot become a second navigation authority or retain a hidden mobile-only interpretation.

All widths preserve one authoritative route and primary heading. Mobile uses one content column, labelled chapter navigation, touch-sized controls, stacked diffs, and route-specific sticky actions. Desktop may add dense rows, two-column short-field layouts, and optional Collection split panes while keeping the same routes, intents, revisions, and recovery contracts.

Full comparison evidence and the final human verdict are recorded in [Workspace shell decision](../design/workspace-shell-decision.md). The earlier [shell comparison](../design/workspace-shell-comparison.md) remains prototype evidence; this ADR supersedes its provisional status.