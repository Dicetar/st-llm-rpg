# Context Capsule model screening

Research date: 2026-08-01

## First result

The first six-variant screening selected **XML · near system** as the provisional winner on the user's active SillyTavern model.

Observed winning result:

- four of five scored facts;
- no context-markup leakage;
- no repeated contradictory claims;
- 3,932 ms generation time;
- 1,338-byte outgoing prompt.

The model correctly used Mage Hand, retained the active “Find the witness” objective, identified precision as Lavir's value, and marked rope absent. It returned `carried key = withdrawn` rather than `wardrobe key`.

## Benchmark correction

The failed key check is not clean evidence of context non-adherence. The original narrative request asked the model to retrieve a ledger behind a locked wardrobe from across the room, which let it bypass the lock with Mage Hand. The check label `key` was also semantically ambiguous.

The benchmark was corrected to:

- require the exact carried key to unlock a lock that explicitly cannot be magically or physically bypassed;
- use the available Ability only after the wardrobe is open;
- rename the scored field to `carried_key`;
- preserve the same contradictory dialogue and five-fact scoring.

XML/near-system remains provisional until the corrected comparison is run. This avoids choosing a production context format from a benchmark whose task admits an alternative solution.

## Cross-model finding

Changing from `melody1437-26b-a4b-v2.0` to `gemma-4-31b-styletune-heretic-ara-i1` reversed the apparent XML result. Therefore, capsule format and placement are a **model profile**, not a global application setting. The production system must keep a conservative plain-text fallback and associate any screened winner with the exact connection and model ID.

## Qwen Channel Error diagnosis

With `qwen3.5-9b-uncensored-hauhaucs-aggressive`, LM Studio returned:

> Error rendering prompt with jinja template: "No user query found in messages."

A minimized role-order matrix isolated the cause. The synthetic benchmark placed an assistant contradiction before the first user turn. User-only, system/user, normal alternating history, multiple system messages, a near-response system message, and adjacent user messages were accepted; assistant-before-user was rejected.

The benchmark now establishes a user turn before the assistant contradiction. The corrected prompt reaches the model successfully, so this particular Channel Error was a benchmark bug rather than evidence that Qwen cannot receive a Context Capsule.

## Remaining Qwen incompatibility

The corrected Qwen request returned HTTP 200 but no visible response:

- at a 220-token allowance, all output was hidden reasoning and the finish reason was `length`;
- `/no_think`, `reasoning_effort: none`, and `chat_template_kwargs.enable_thinking: false` did not change that behavior through LM Studio's OpenAI-compatible endpoint;
- at a 1,024-token allowance, the model still spent the entire allowance on reasoning and returned no final answer;
- one six-request replay also ended with `Model unloaded`; a later status check showed the model loaded with a 20-minute TTL, so that unload is recorded as a separate transient until reproduced.

LM Studio's model listing exposes no public reasoning configuration for this model (`reasoning` is absent/null). The model lab should not guess that increasing the token budget will cure this. It now reads the raw SillyTavern response, distinguishes reasoning-only output from transport/template errors, shows the exact model ID, stops after the first incompatible result, and refuses to mix results if the selected model changes during a run.

## Product consequence

Do not hard-code XML or any other capsule serialization. Use this order:

1. exact model/connection profile when a complete screening exists;
2. plain labeled capsule near the final instruction as the unevaluated fallback;
3. explicit incompatibility when the model produces no final answer, rejects valid role history, or disappears during generation.

The RPG workflow should prefer non-thinking narration/extraction presets for frequent state work. A reasoning model is acceptable only when its reasoning mode can be controlled reliably and it still returns a final answer within a bounded latency/token budget.

## Qwen 3.6 confirmation

`qwen3.6-27b-fable-fusion-711-uncensored-heretic-nm-dau-neo-max-mtp` reproduced the same incompatibility. The first UI run took 83 seconds and returned reasoning without a final answer. With the model already loaded, two controlled 220-token requests produced the same outcome:

- `reasoning_effort: high`: 53.4 seconds, 894 reasoning characters, zero visible characters, `finish_reason: length`;
- `reasoning_effort: none`: 53.1 seconds, 962 reasoning characters, zero visible characters, `finish_reason: length`.

The local LM Studio model record exposes no `reasoning` options, and changing the request-level effort did not affect behavior. This is not a Capsule-format result and should not be scored as one.

The lab now runs a 40-token visible-answer readiness probe before the real comparison. A thinking-only or otherwise answerless model stops there, avoiding a full 220-token benchmark call and all remaining variants. Passing models proceed to the unchanged six-format comparison.
