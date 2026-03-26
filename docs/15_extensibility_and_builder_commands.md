# 15 — Extensibility and Builder Commands

## Why builder commands exist

The project is no longer small enough to depend on hand-editing JSON every time a new capability is needed. Runtime systems grow better when they have a controlled way to define and extend state from inside play.

Builder commands are the first step toward that goal.

They provide a practical surface for adding or refining:
- inventory items
- spells
- custom skills

without having to stop play, open seed files, and patch state by hand.

## Design principle

These commands are intentionally implemented as **upserts**.

That means they are not only for creating new entries. If the target already exists, the command updates it.

That gives the system a safe and simple growth path:
- define something quickly
- refine it later
- keep the same command surface

## Supported commands

### Generic builder
- `/new custom_skill | swimming | 3 | Competent in water movement and breath control.`
- `/new spell | feather fall | 1 | Slow the fall of nearby creatures. | transmutation`
- `/new item | rope | 2 | tool | 50 feet of braided hemp rope.`

### Direct aliases
- `/new_custom_skill swimming | 3 | Competent in water movement and breath control.`
- `/new_spell feather fall | 1 | Slow the fall of nearby creatures. | transmutation`
- `/new_item rope | 2 | tool | 50 feet of braided hemp rope.`

## Positional format

The commands use pipe-separated fields because it is much easier to parse reliably inside a chat shell.

### `new_custom_skill`
`name | value | description`

### `new_spell`
`name | level | description | school`

### `new_item`
`name | quantity | kind | description`

## Why this matters for maintainability

The builder surface lowers the cost of extension. New content no longer has to arrive through hidden local edits alone. It can be expressed through a command contract that the backend validates, logs, and persists.

This is one of the most useful forms of modularity in a system like this: not just splitting files, but creating reliable ways for the system to change itself through explicit interfaces.
