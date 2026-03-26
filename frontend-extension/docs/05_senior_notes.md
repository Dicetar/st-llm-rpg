# 05 — Notes for a senior-grade implementation

## What is solid in this skeleton

- canonical state stays outside the browser
- extension settings use the ST context storage model
- pending narration is stored in chat metadata, so it is scoped to the chat
- the extension remains thin and replaceable

## What is intentionally still rough

### Slash command registration
The extension tries to resolve the slash-command API defensively because SillyTavern internals can move.
If registration fails, the floating panel still works.

This is the main piece you should expect to harden once you test against your local ST build.

### Narration triggering
This skeleton injects authoritative narration context on the **next generation**.
It does not try to force-send a message or auto-trigger generation.

That is deliberate.
Automatic send/generate behavior inside ST is possible, but it is a worse first step than getting the state and prompt injection right.

### Prompt shaping
The narration block is deliberately verbose for debugging.
You should shorten it once the loop is stable.

## Hardening checklist

- debounce refresh calls
- add request timeout handling
- add backend availability indicator
- cache last successful overview
- include event IDs in the execution log UI
- add actor picker for multi-PC or companion control
- add scene close / journal write commands
- write versioned contract tests between extension and backend

## Long-term recommendation

Once this loop feels good, keep the same backend contract and decide between:

- continuing with a richer ST extension
- or building a custom frontend with the same backend API

That way you do not throw away the hard part.
