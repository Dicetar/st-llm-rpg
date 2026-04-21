# 05 - Senior maintenance notes

## What is solid in the current bridge

- canonical state stays outside the browser
- extension settings use the SillyTavern context storage model
- pending narration and review state live in chat metadata, so they stay scoped to the active chat
- the extension remains thin enough to replace later without rewriting backend rules

## What still needs hardening

### Slash-command registration drift

The bridge still resolves SillyTavern slash-command APIs defensively because internals can move between builds.
If registration breaks, the floating panel should remain usable, but command registration still needs periodic live verification.

### Request-reset expectations

Slow LM Studio generations can leave the user unsure whether the backend, the bridge, or the model is still doing work.
The next milestone should make reset, retry, and stale-context behavior clearer without changing backend authority rules.

### Extension runtime-path consistency

The repo should keep one canonical active extension sync target for local work.
Do not let docs and helper scripts drift between multiple runtime locations unless the script parameter explicitly overrides them.

## Hardening checklist

- keep the frontend smoke checklist aligned with the real bridge surface
- keep visible backend start, stop, and reset workflows documented and current
- keep extraction review action coverage aligned with supported backend command contracts
- include real warning and fallback states in `Last Executions`
- preserve versioned contract thinking between backend endpoints and bridge behavior

## Long-term recommendation

Continue treating the backend API as the stable product boundary.
That keeps future work flexible whether the project stays in SillyTavern longer or eventually moves to a custom frontend.
