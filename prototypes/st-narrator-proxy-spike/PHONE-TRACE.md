# Physical-phone narrator-proxy acceptance test

This procedure proves the SillyTavern behaviors required by Wayfinder #20 on a real Android browser. It is not a generic tap-through checklist. Each step below states the starting state, the exact action, the expected visible result, the contract being proved, and the failure conditions.

Use one disposable saved character chat. Run in portrait orientation at a phone-sized viewport. Leave the normal SillyTavern Custom Chat Completions endpoint unchanged; the bridge redirects only the individual test request through the throwaway proxy.

## Start

On Windows, from the repository root:

```powershell
npm run test:proxy-phone-evidence
npm run prototype:proxy
```

Completely close and reopen the Android SillyTavern tab so the current bridge loads. Open the disposable chat, then open Extensions → **Phone proxy test**.

For every step:

1. Read the complete step below before touching the UI.
2. Tap **Prepare**. This resets the proxy attempt trace and configures the exact route, fixture, delay, and Campaign state required for that step.
3. Return to the chat and perform the stated SillyTavern action.
4. Verify the visible result yourself.
5. Return to **Phone proxy test** and tap **Capture**.

A failed capture remains on the same step. Do not advance until the visible behavior matches the expected result.

## 1. Linked normal generation

**Starting state after Prepare**

- Chat is linked.
- Campaign is available.
- Deterministic fixture mode is active.
- No artificial delay is active.

**Action**

Send one ordinary user message using SillyTavern's normal Send button.

**Expected visible result**

- One assistant message appears.
- Its visible text is `PHONE_NORMAL`.
- The user message and assistant message are both present once.

**What this proves**

The bridge intercepts an ordinary linked Chat Completion, preserves the linked route and generation mode, reaches the proxy exactly once, and commits one complete assistant result back through SillyTavern.

**Failure conditions**

No assistant appears; the text is not `PHONE_NORMAL`; more than one assistant result appears; or the request bypasses the proxy.

## 2. Linked Regenerate

**Starting state after Prepare**

- The chat remains linked and Campaign is available.
- The current assistant message is the result from step 1.

**Action**

Use SillyTavern's **Regenerate** command on the current assistant response.

**Expected visible result**

- The selected assistant result becomes `PHONE_REGENERATE`.
- SillyTavern does not append a second ordinary assistant message below it.

**What this proves**

The bridge preserves the `regenerate` generation type and SillyTavern applies the proxy result using its native replacement/regeneration behavior rather than treating it as a new normal turn.

**Failure conditions**

The old response remains selected; a new ordinary assistant turn is appended; the result is not `PHONE_REGENERATE`; or the proxy records the request as `normal`.

## 3. Linked Continue

**Starting state after Prepare**

- The selected assistant response is the regenerated response from step 2.
- Chat is linked and Campaign is available.

**Action**

Use SillyTavern's **Continue** command on that assistant response.

**Expected visible result**

- `PHONE_CONTINUE` is appended to the selected assistant message.
- SillyTavern does not create a separate assistant turn.

**What this proves**

The bridge preserves the `continue` generation type and SillyTavern applies the returned text with its native continuation mutation.

**Failure conditions**

A new assistant turn appears; the selected message is replaced instead of extended; `PHONE_CONTINUE` is absent; or the proxy records another generation type.

## 4. Linked swipe alternative

**Starting state after Prepare**

- Chat is linked and Campaign is available.
- The current assistant message already has its existing selected candidate.

**Action**

Use SillyTavern's swipe-generation control to request a new alternative for the current assistant message.

**Expected visible result**

- The new selected alternative contains `PHONE_SWIPE`.
- The message has at least two swipe candidates.
- The prior candidate remains available when swiping back.

**What this proves**

The bridge preserves the `swipe` generation type and SillyTavern stores the result as an alternative candidate rather than overwriting the only existing response or appending a new turn.

**Failure conditions**

There is only one candidate; the prior candidate disappears; a new assistant turn is appended; or `PHONE_SWIPE` is absent.

## 5. Linked Stop before atomic commit

**Starting state after Prepare**

- Chat is linked.
- Campaign is available.
- The proxy intentionally holds the linked result for ten seconds before delivery.

**Action**

Send one new ordinary user message. While SillyTavern is still generating, press **Stop** before ten seconds have elapsed. Then wait until more than ten seconds have elapsed from the original send.

**Expected visible result**

- The submitted user message remains in the chat.
- No new assistant message appears.
- `PHONE_DELAYED_NORMAL` never appears, including after the full delay has elapsed.

**What this proves**

SillyTavern cancellation reaches the linked proxy request before success commit, the proxy does not deliver a late buffered result, and linked delivery remains atomic from the user's perspective.

**Failure conditions**

An assistant message appears before or after Stop; `PHONE_DELAYED_NORMAL` appears later; or the proxy reports a completed request instead of a cancelled request.

## 6. Linked Campaign outage

**Starting state after Prepare**

- Chat is linked.
- Campaign availability is deliberately disabled.
- Fixture mode remains active, but a linked request must be rejected before any upstream call.

**Action**

Send one new ordinary user message.

**Expected visible result**

- The user message remains as the last chat message.
- No assistant response is added.
- SillyTavern may show a generation error/toast; that is expected.

**What this proves**

Linked narration fails closed when Campaign authority is unavailable. The failure occurs before the model/fixture upstream is called, and the already-saved user turn remains visible and retryable.

**Failure conditions**

Any assistant response appears; `PHONE_OUTAGE_NORMAL` appears; the user turn is removed; or the proxy records an upstream call.

## 7. Explicit-unlinked outage bypass

**Starting state after Prepare**

- Campaign remains unavailable.
- The test explicitly removes the Chat Binding, making the chat unlinked.
- Fixture mode remains active.

**Action**

Send one new ordinary user message.

**Expected visible result**

- One assistant response appears with `PHONE_OUTAGE_NORMAL`.
- The request succeeds even though Campaign remains unavailable.

**What this proves**

Explicit-unlinked chats bypass Campaign authority and remain usable during a Campaign outage, while still making exactly one upstream request.

**Failure conditions**

The request is blocked by Campaign outage; no assistant appears; the result is not `PHONE_OUTAGE_NORMAL`; or the route remains linked.

## Completion

The panel must show:

```text
7/7 passed · PASS
```

Tap **Copy PASS JSON**. The report contains phone environment data, fixed sentinel counts, structural chat state, and sanitized proxy outcomes. It excludes ordinary chat prose, prompts, Campaign content, locators, hashes, and generated prose beyond the fixed test sentinels.
