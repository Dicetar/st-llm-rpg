# SillyTavern narrator-proxy compatibility prototype

Research date: 2026-08-05

GitHub issue: #20

## Question

Can a throwaway bridge and proxy at `:8002` preserve real pinned SillyTavern and LM Studio behavior for normal send, regenerate, continue, swipe, Stop, outages, and mobile access without corrupting SillyTavern chat semantics?

## Final verdict

**Go. The bridge/proxy shape is compatible with the pinned SillyTavern target and passed the required physical-phone trace.**

The accepted result combines three evidence classes:

1. pinned-SillyTavern desktop traces through its real generation and save paths;
2. live LM Studio HTTP/SSE and cancellation traces;
3. a real Android Chrome trace at a 384 × 692 CSS-pixel viewport over the trusted network.

The evidence supports the one-versioned-exchange and one-deep-`Narration.respond` contract selected in #19:

- each Chat Completion can carry explicit route, Binding, generation type, request label, and Chat Locator metadata to the proxy;
- explicit-unlinked traffic remains a one-call pass-through and remains usable during Campaign outage;
- linked traffic verifies Binding/Campaign state, buffers one complete result, and commits atomically;
- normal, regenerate, continue, and swipe retain SillyTavern's native chat mutation semantics;
- linked cancellation prevents success commit and late delivery;
- linked Campaign outage rejects before the upstream model call while retaining the user's submitted turn;
- routing metadata and hidden context are not written into ordinary chat messages.

The prototype is disposable evidence, not the production companion.

## Environment

| Component | Observed value |
|---|---|
| SillyTavern | 1.18.0 at `380e31e8c58d196969b6a0da74f431ba999c7e0a` |
| SillyTavern endpoint | `:8001` |
| Throwaway proxy | `:8002` |
| LM Studio | `:1234` |
| Live compatibility model | `mistralai/mistral-nemo-instruct-2407` |
| Physical phone browser | Chrome 148 mobile on Android |
| Physical phone viewport | 384 × 692 CSS px, DPR 2.8125 |
| Physical phone path | trusted network to `10.8.1.2:8001` |

## Physical Android acceptance

The redacted report completed all seven required steps with no missing, failed, retry, environment, or viewport failures.

| Step | Physical-phone result | Contract proved |
|---|---|---|
| Linked normal | one completed linked request and selected `PHONE_NORMAL` assistant result | ordinary linked generation reaches the proxy once and commits one complete reply |
| Linked regenerate | selected result became `PHONE_REGENERATE` without a new ordinary assistant turn | generation type survives and native replacement semantics are preserved |
| Linked continue | `PHONE_CONTINUE` was appended to the selected assistant message | native continuation mutation is preserved |
| Linked swipe | selected `PHONE_SWIPE` alternative with two retained candidates | native swipe candidate history is preserved |
| Linked Stop | cancelled after 1,174 ms, zero upstream calls, zero visible characters, no success commit, no delayed sentinel | cancellation propagates before commit and prevents late buffered delivery |
| Linked Campaign outage | rejected with `RPG_CAMPAIGN_UNAVAILABLE`, zero upstream calls, user turn remained last, no outage assistant | linked narration fails closed before model work without deleting the submitted user turn |
| Explicit-unlinked outage bypass | completed one unlinked upstream call and saved `PHONE_OUTAGE_NORMAL` | unlinked chat remains usable while Campaign is unavailable |

The machine-readable physical-phone report is stored at:

- [`phone-compatibility-summary.json`](../../prototypes/st-narrator-proxy-spike/evidence/phone-compatibility-summary.json)

The report contains only fixed sentinels, structural chat counts, sanitized proxy outcomes, and phone environment metadata. It contains no ordinary prompt or generated prose, Campaign content, Binding/Chat/Request identifiers, locators, or hashes.

## Desktop pinned-SillyTavern evidence

The spike created a synthetic Assistant chat and exercised SillyTavern's real generation APIs and save path.

| Action | Saved result |
|---|---|
| Explicit-unlinked normal | one user message and one full assistant message |
| Linked normal | one user message and one full assistant message |
| Linked regenerate | replaced the assistant message once |
| Linked continue | appended one suffix to the existing assistant message |
| Linked swipe | retained the earlier candidate and added one selected alternative |
| Linked Stop during a held request | cancelled with no assistant bytes and no delayed reply |
| Linked Campaign outage | zero LM Studio calls and no assistant message |
| Explicit unlinked during Campaign outage | completed successfully |

The linked live-model request buffered five upstream SSE chunks totaling 1,502 bytes for 4,491 ms, then SillyTavern saved exactly `LIVE_LINKED_OK`. The explicit-unlinked live request streamed and saved `LIVE_UNLINKED_OK` through one LM Studio call.

One deliberately under-budgeted linked live request produced no visible model content. The proxy did not invent an answer or retry, and SillyTavern saved no assistant message. Empty or hidden-reasoning-only linked output is therefore classified as `502 RPG_EMPTY_REPLY`, not dependency unavailable and not an automatic retry condition.

## Failure semantics discovered

SillyTavern saves the submitted user message before the interceptor and upstream request finish. Fail-closed behavior therefore means:

- no linked request silently bypasses Campaign authority;
- no failed linked request produces an assistant message;
- the submitted user turn remains visible and retryable.

Production recovery UX must describe that state accurately. It must not claim that a failed send rolls the user message back.

## Direct proxy and LM Studio evidence

The same live narrator request was cancelled at two delivery stages:

| Route and Stop point | Result |
|---|---|
| Linked, after LM Studio returned response headers but before final buffering | cancellation observed in 4 ms; one upstream call; zero client bytes; response never committed |
| Explicit unlinked, after first streamed chunk | cancellation observed in 2 ms; one upstream call; 899 client bytes already forwarded; partial response remained committed |

`GET /v1/models` returned 12 models and changed neither Campaign attempt count nor narration attempt count.

Admission probes rejected missing, malformed, duplicate, and reused metadata; linked `n=2`; linked tools; and a copied Binding presented from a different Chat Locator. Every rejection occurred with zero new upstream calls. The sanitized desktop results are stored in:

- [`compatibility-summary.json`](../../prototypes/st-narrator-proxy-spike/evidence/compatibility-summary.json)

## Saved-chat audit

The final synthetic desktop JSONL contained one header and thirteen messages. Searches found zero occurrences of:

- `X-ST-RPG-Exchange`;
- `Narration Draft`;
- `Context Capsule`;
- the deliberately delayed Stop fixture;
- the deliberately blocked outage fixture.

The physical-phone report independently confirms that the Stop and linked-outage steps added no assistant result to the live chat structure. The report is not a byte-for-byte export audit and is not represented as one.

## Contract corrections from the prototype

1. The bridge host label belongs in SillyTavern's server-saved extension settings, not browser `localStorage`.
2. Browser-facing status/control requests use the current SillyTavern hostname at port `8002`; browser loopback is invalid on the phone.
3. The user's saved Custom Chat Completions endpoint remains unchanged. The bridge redirects only the transient generated request object through `127.0.0.1:8002/v1`.
4. Empty visible linked output is an upstream protocol failure (`502`), never Campaign unavailable (`503`) and never an automatic retry.
5. Linked Stop is atomic only before success commit. Explicit-unlinked Stop intentionally retains direct streaming and partial-response behavior.
6. A failed normal generation retains the already-saved user turn. Recovery and retry UX must start from that fact.
7. Human acceptance procedures must state the starting state, exact action, expected visible result, contract being proved, and failure conditions. A generic tap-loop is insufficient.

None of these corrections replaces the selected one-envelope, one-`Narration.respond` architecture.

## Scope limits

This compatibility result proves the SillyTavern bridge/proxy seam. It does not prove:

- Campaign SQLite reads or authority revision pinning;
- Context selection quality;
- hidden-draft entity enrichment or recovery quality;
- Story Sync semantics;
- production supervisor/update behavior;
- model loading and preemption limits on the final 20–40B target models.

Those concerns remain assigned to their own Wayfinder tickets and final architecture verification seams.

## Artifacts

- [Explicit physical-phone procedure](../../prototypes/st-narrator-proxy-spike/PHONE-TRACE.md)
- [Physical Android evidence](../../prototypes/st-narrator-proxy-spike/evidence/phone-compatibility-summary.json)
- [Desktop and live-model evidence](../../prototypes/st-narrator-proxy-spike/evidence/compatibility-summary.json)
- [Proxy and bridge README](../../prototypes/st-narrator-proxy-spike/README.md)
- [Proxy implementation](../../prototypes/st-narrator-proxy-spike/proxy.mjs)
- [Redacted state reducer](../../prototypes/st-narrator-proxy-spike/exchange-state.mjs)
- [Accepted bridge/proxy design](../design/sillytavern-bridge-and-narrator-proxy.md)
