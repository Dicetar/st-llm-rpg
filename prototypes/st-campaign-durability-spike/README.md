# THROWAWAY PROTOTYPE — Campaign durability spike

## Question

Can a UI-only SillyTavern extension keep a realistically sized Campaign document and its matching deterministic Context Capsule in chat metadata while clearly distinguishing draft, pending, verified, failed, stale, corrupt, and branch-mismatch states? Can it retain a recoverable candidate and the previous known-good capsule when a save or verification fails?

This is a measurement lab, not v2 production code. It deliberately uses SillyTavern's current `/api/chats/get` endpoint for server readback so we can decide whether that dependency is acceptable or whether acknowledged storage requires a server plugin.

## Install

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File prototypes/st-campaign-durability-spike/install.ps1
```

Restart the project-local SillyTavern, open a normal character chat, then use the floating gold **D** button.

## Human checks

1. Create the representative Campaign. Confirm it reports about 190 records and a much smaller compiled capsule.
2. Change the first item's quantity or description and commit. Confirm `Pending` becomes `Verified` only after server readback.
3. Make another change and use **Simulate failed commit**. Confirm the previous revision remains active and the candidate is recoverable.
4. Restore the candidate and retry the commit.
5. Mark a sync boundary, then edit or swipe an older SillyTavern message. Run the history check and confirm the earliest changed message is reported.
6. Reload the browser and switch away/back. Confirm the verified Campaign returns.
7. Create a SillyTavern branch from before a later Campaign commit. Confirm the lab detects the inherited future Campaign and offers point-in-time recovery instead of silently accepting it.

## Deliberate limits

- Character chats only; group-chat persistence is not tested here.
- No model call and no production editor.
- No automatic server-plugin fallback.
- No tests or framework abstractions: this code exists only to answer the durability question.
