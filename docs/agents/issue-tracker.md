# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with suitable filters.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Label**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

The map is one issue labelled `wayfinder:map`; decision tickets are child issues.

- Create child issues with one `wayfinder:<type>` label: `research`, `prototype`, `grilling`, or `task`.
- Prefer GitHub native sub-issues. If unavailable, add the child to a task list in the map and begin its body with `Part of #<map>`.
- Prefer GitHub native issue dependencies. If unavailable, begin the blocked ticket with `Blocked by: #<n>, #<n>`.
- The frontier is the map's open, unblocked, unassigned children in map order.
- Claim a ticket before work with `gh issue edit <n> --add-assignee @me`.
- Resolve with an answer comment, close the ticket, and add a linked one-line gist to the map's Decisions-so-far.
