# SillyTavern narrator-proxy compatibility prototype

Research date: 2026-08-05

GitHub issue: #20

## Question

Can a throwaway bridge and proxy at `:8002` preserve real pinned SillyTavern and LM Studio behavior for send, regenerate, continue, swipe, Stop, outages, and mobile access without corrupting chat state?

## Interim verdict

**Go for the bridge/proxy shape, pending the mandatory real-phone trace.** Desktop pinned-ST evidence and live LM Studio evidence support the single versioned exchange from #19:

- the generation interceptor plus awaited settings hook can attach one request description that survives SillyTavern's Custom Chat Completions reconstruction;
- an explicit unlinked request can remain a transparent one-call LM Studio pass-through;
- a linked request can buffer every upstream chunk and commit only one complete result;
- one client disconnect can cancel linked buffered work without committing bytes and can preserve normal partial-stream behavior for an unlinked request;
- linked authority failure can stop before LM Studio while explicit unlinked chat remains usable;
- normal, regenerate, continue, and swipe use SillyTavern's own chat mutation and save behavior correctly;
- request metadata and hidden text do not enter the saved chat JSONL.

This is not acceptance yet. The ticket requires a real phone at roughly 360 CSS pixels. Desktop emulation is deliberately not substituted for that evidence.

The prototype is disposable. Run it with:

```powershell
npm run prototype:proxy
```

## Environment

| Component | Observed value |
|---|---|
| SillyTavern | 1.18.0 at `380e31e8c58d196969b6a0da74f431ba999c7e0a` |
| SillyTavern endpoint | `:8001` |
| Throwaway proxy | `:8002` |
| LM Studio | `:1234` |
| Live compatibility model | `mistralai/mistral-nemo-instruct-2407` |
| Browser automation | installed Google Chrome through Playwright before the later environment permission block |
| Phone | not yet run |

## Directly observed through pinned SillyTavern

The spike created one synthetic Assistant chat and used SillyTavern's real generation APIs and save path.

| Action | Saved result |
|---|---|
| Explicit-unlinked normal | one user message and one full assistant message |
| Linked normal | one user message and one full assistant message |
| Linked regenerate | replaced the assistant message once |
| Linked continue | appended one suffix to the existing assistant message |
| Linked swipe | retained the earlier candidate and added one selected alternative |
| Linked Stop during a 10 s held request | cancelled in 123 ms; no assistant bytes; no delayed reply after 10.5 s |
| Linked Campaign outage | `503`, zero LM Studio calls, no assistant message |
| Explicit unlinked during Campaign outage | completed successfully |

The linked live-model request buffered five upstream SSE chunks (1,502 bytes) for 4,491 ms, then SillyTavern saved exactly `LIVE_LINKED_OK`. The explicit-unlinked live request streamed and saved `LIVE_UNLINKED_OK` through one LM Studio call.

One deliberately under-budgeted linked live request produced no visible model content. The proxy did not invent an answer or retry, and SillyTavern saved no assistant message. The corrected contract classifies empty visible output as `502 RPG_EMPTY_REPLY`.

### Failure semantics discovered

SillyTavern records the submitted user message before the generation interceptor and upstream request finish. Therefore fail-closed behavior means:

- no linked request can silently bypass Campaign authority;
- no failed request produces an assistant message;
- the user's submitted turn remains visible and retryable.

The production UI must explain that state. It must not claim that a failed send rolls the user message back.

## Direct proxy and LM Studio evidence

The same live narrator request was cancelled at two delivery stages:

| Route and Stop point | Result |
|---|---|
| Linked, after LM Studio returned response headers but before final buffering | cancellation observed in 4 ms; one upstream call; zero client bytes; response never committed |
| Explicit unlinked, after first streamed chunk | cancellation observed in 2 ms; one upstream call; 899 client bytes already forwarded; partial response remained committed |

`GET /v1/models` returned 12 models and changed neither Campaign attempt count nor narration attempt count.

Admission probes rejected missing, malformed, duplicate, and reused metadata; linked `n=2`; linked tools; and a copied Binding presented from a different Chat Locator. Every rejection occurred with zero new upstream calls. The sanitized machine-readable results are in [compatibility-summary.json](../../prototypes/st-narrator-proxy-spike/evidence/compatibility-summary.json).

## Saved-chat audit

The final synthetic JSONL contained 14 lines: one header and 13 messages. It retained the linked marker and had SHA-256 `59CE70F8E6698228533BF0C3FE7895589E94D58D9AC8F27C786AA4364B422F49`.

Searches found zero occurrences of:

- `X-ST-RPG-Exchange`;
- `Narration Draft`;
- `Context Capsule`;
- the deliberately delayed Stop fixture;
- the deliberately blocked outage fixture.

The proxy diagnostics retained only route, locator, request IDs, model, body hash/size, message roles and sizes, stages, timings, byte counts, commit state, and Problem code. They contained no prompt or reply prose.

## Contract corrections from the prototype

1. The bridge host ID belongs in SillyTavern's server-saved `extension_settings`, not browser `localStorage`. Desktop, phone, and multiple tabs must present the same host identity for one pinned ST installation.
2. Browser-facing status requests use the current ST hostname at port `8002`; only the ST server-facing Custom endpoint uses `127.0.0.1:8002/v1`. Using browser loopback made phone status inherently wrong.
3. Empty or hidden-reasoning-only linked output is an upstream protocol failure (`502`), never dependency unavailable (`503`) and never an automatic retry.
4. Linked Stop is atomic only before success commit. Explicit-unlinked Stop intentionally retains direct streaming/partial-response behavior.
5. A failed normal generation retains the already-saved user turn. Recovery/retry UX must work from that fact.

None of these corrections requires replacing the selected one-envelope, one-`Narration.respond` architecture.

## Fixture evidence versus production claims

The deterministic fixture proved exact SillyTavern mutation behavior and made Stop/outage timing repeatable. Live LM Studio proved real HTTP/SSE buffering, transparent forwarding, empty-output handling, cancellation, and recovery of the model catalog after cancellation.

The fixture does not prove Campaign SQLite reads, Context selection, hidden-draft enrichment, volatile recovery, authority revision pinning, or Story Sync. Those dependencies intentionally do not exist in this throwaway spike. Hidden-draft fidelity and recovery remain Wayfinder #22 work.

The prototype decoder also implements only the adversarial cases needed for this compatibility decision. Production still requires the canonical schema and complete malformed/oversized/unknown-field suite specified in #19.

## Real-phone acceptance trace still required

On the physical phone connected to the same LAN/VPN:

1. Reload ST at `http://10.8.1.2:8001` and confirm **RPG Narrator Proxy Spike** reports proxy and Campaign state rather than `proxy unavailable`.
2. Confirm its displayed eight-character host prefix matches desktop.
3. In one disposable chat, run linked normal, regenerate, continue, swipe, and Stop while delay is enabled.
4. Toggle Campaign outage and confirm linked send retains the user turn but creates no assistant; make the chat explicitly unlinked and confirm generation still works.
5. Return the final visible results and any error/toast wording. The saved JSONL will then be audited once more.

Do not close #20 until this physical-device trace passes. Emulation and code inspection are insufficient under the repository's mobile invariant.

## Artifacts

- [Proxy and bridge README](../../prototypes/st-narrator-proxy-spike/README.md)
- [Proxy implementation](../../prototypes/st-narrator-proxy-spike/proxy.mjs)
- [Redacted state reducer](../../prototypes/st-narrator-proxy-spike/exchange-state.mjs)
- [Sanitized compatibility evidence](../../prototypes/st-narrator-proxy-spike/evidence/compatibility-summary.json)
- [Provisional bridge/proxy design](../design/sillytavern-bridge-and-narrator-proxy.md)
