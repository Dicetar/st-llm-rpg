# SillyTavern narrator-proxy contract

Research date: 2026-08-04

Pinned SillyTavern source: [`380e31e8c58d196969b6a0da74f431ba999c7e0a`](https://github.com/SillyTavern/SillyTavern/tree/380e31e8c58d196969b6a0da74f431ba999c7e0a)

Scope: Wayfinder issue #15. This note establishes what the pinned SillyTavern build actually sends to a Custom OpenAI-compatible endpoint, how extensions can attach Chat Binding metadata, and what the companion proxy must return. It does not choose the final bridge modules or implementation; those belong to the bridge-design and compatibility-prototype tickets.

Evidence labels:

- **Documented fact**: stated by official SillyTavern or LM Studio documentation.
- **Pinned-source fact**: observed at the exact project-local SillyTavern commit above.
- **Contract consequence**: behavior the bridge or proxy must preserve because of those facts.
- **Prototype obligation**: behavior that source inspection cannot prove end to end.

## Decision summary

Use SillyTavern's **Chat Completion → Custom (OpenAI-compatible)** connection with the companion proxy as its base URL. For the intended ports, the Custom URL is `http://127.0.0.1:8002/v1` when SillyTavern and the companion run on the same machine. Do not append `/chat/completions`; SillyTavern does that itself. Mobile browsers still send to SillyTavern at `:8001`; the SillyTavern Node process makes the server-to-server request to `:8002`, so the proxy does not need a browser CORS contract. SillyTavern documents both the Custom endpoint purpose and the base-URL rule. [Official Custom endpoint documentation](https://docs.sillytavern.app/usage/api-connections/openai/#custom-openai-compatible-endpoint)

The proxy surface required by the pinned build is:

```text
GET  /v1/models
POST /v1/chat/completions
```

LM Studio exposes the same OpenAI-compatible endpoints at `:1234`, so the companion can forward the normalized narrator request there after applying Campaign context and enrichment. [LM Studio OpenAI-compatible endpoints](https://lmstudio.ai/docs/developer/openai-compat), [LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions)

The bridge must add explicit per-request metadata because SillyTavern's browser request contains its generation `type`, but the pinned server rebuilds the upstream Custom body and does **not** forward that field. Missing metadata must be an error, not an implicit “unlinked” route; otherwise an extension failure could silently bypass Campaign handling.

For atomic final delivery while SillyTavern streaming is enabled, the proxy should finish its draft/retrieval/revision work before committing HTTP response headers, then emit the complete final reply as one ordinary OpenAI SSE content chunk followed by `data: [DONE]`. Changing only the outgoing body's `stream` property is not enough to change SillyTavern's already-selected browser response parser.

## 1. Actual request path

```text
SillyTavern browser extension
  → POST /api/backends/chat-completions/generate on SillyTavern :8001
  → POST /v1/chat/completions on companion :8002
  → POST /v1/chat/completions on LM Studio :1234
```

### Browser-side construction and hooks

- **Pinned-source fact:** SillyTavern builds a mutable `generate_data` object containing `type`, `messages`, `model`, samplers, `max_tokens`, `stream`, source, `n`, names, and other settings. [Request construction](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/openai.js#L2756-L2781)
- **Pinned-source fact:** for the Custom source it also copies `custom_url`, `custom_include_body`, `custom_exclude_body`, and `custom_include_headers` into that object. [Custom fields](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/openai.js#L2871-L2876)
- **Pinned-source fact:** immediately before posting to the SillyTavern backend, it awaits `CHAT_COMPLETION_SETTINGS_READY` with the mutable `generate_data` object. The subsequent `fetch` serializes that same object and uses an `AbortSignal`. [Final settings hook and fetch](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/openai.js#L3078-L3099)
- **Pinned-source fact:** after building the final OpenAI message array, SillyTavern also awaits `CHAT_COMPLETION_PROMPT_READY` with `{ chat, dryRun }`; mutations to the referenced `chat` array affect the outgoing prompt. [Final prompt hook](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/openai.js#L1603-L1622)
- **Documented fact:** event handlers are awaited, but event payloads are not uniform and extension authors are directed to verify the emitting source. [Official extension-event documentation](https://docs.sillytavern.app/for-contributors/writing-extensions/#events)
- **Pinned-source fact:** listener exceptions are caught and logged by the event emitter; they do not reject the generation path. [Event emitter](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/lib/eventemitter.js#L126-L158)

**Contract consequence:** `CHAT_COMPLETION_SETTINGS_READY` is the narrow hook for adding request metadata without rewriting SillyTavern. A thrown exception is not a fail-closed mechanism. The hook must catch its own errors, and the proxy must reject requests that do not carry an explicit route marker.

### Prompt interceptor and fail-closed guard

SillyTavern officially supports a manifest `generate_interceptor`. It runs for non-dry-run generations before the final request, receives the prompt-side chat array, context size, an explicit `abort()` callback, and the generation type. Interceptors run sequentially according to extension loading order. [Official Prompt Interceptors documentation](https://docs.sillytavern.app/for-contributors/writing-extensions/#prompt-interceptors)

At the pinned commit, the interceptor runner catches interceptor exceptions and continues unless the interceptor explicitly calls `abort`; `abort(true)` also stops later interceptors. [Interceptor runner](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L2008-L2040)

**Contract consequence:** a linked-chat guard may use the interceptor to block generation when the active API/source/Custom URL cannot reach the companion or when required binding state is invalid. It must catch failures and call `abort(true)`; throwing is insufficient. The proxy remains the final guard against absent or malformed metadata.

### SillyTavern server reconstruction

- **Pinned-source fact:** the server optionally post-processes the message list before choosing a backend. The proxy therefore receives the post-processed narrator prompt, not necessarily a byte-for-byte copy of chat records. [Prompt post-processing](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/backends/chat-completions.js#L2166-L2181)
- **Pinned-source fact:** for Custom, the server reads the configured base URL and key, parses the configured YAML into extra body fields and headers, and prepares OpenAI logprobs/structured-output fields. [Custom backend preparation](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/backends/chat-completions.js#L2318-L2345)
- **Pinned-source fact:** it selects `/chat/completions` for an array of chat messages and appends that suffix to the configured base URL. A model classified as a legacy text-completion model instead selects `/completions`. [Endpoint selection](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/backends/chat-completions.js#L2538-L2546)
- **Pinned-source fact:** the final Custom upstream body is rebuilt from a fixed field list: messages or prompt, model, samplers, token limits, stream, stop, seed, `n`, tool fields, response format, and merged Custom body fields. It does **not** include SillyTavern's `type`, user/character names, Custom configuration fields, or arbitrary properties added directly to `generate_data`. Custom exclusions are applied afterward. [Final upstream body](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/backends/chat-completions.js#L2548-L2603)
- **Pinned-source fact:** Custom YAML merge and exclusion silently ignore malformed YAML. Included body fields are merged late enough to override standard fields; included headers are spread after `Content-Type` and `Authorization`. [YAML merge and exclusion](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/util.js#L824-L879)

**Contract consequence:** generation type and Chat Binding data must be encoded through `custom_include_headers` or `custom_include_body`; merely adding `generate_data.rpg = ...` will be dropped. Prefer headers so routing metadata does not become an unknown LM Studio body field. Parse, merge, and reserialize the existing header YAML rather than replacing user/profile configuration.

## 2. Companion routing metadata

The exact header names are a bridge-design decision, but the wire contract requires these semantics on **every** narrator request:

| Required semantic | Why |
|---|---|
| Explicit route: `linked` or `unlinked` | Missing hook data must not be interpreted as safe pass-through. |
| Chat Binding ID for `linked` | Campaign authority resolves through the binding, not through a mutable SillyTavern file name. |
| Generation type | `continue` and `swipe` have different response/save semantics, but SillyTavern drops `type` before the Custom endpoint. |
| Unique request ID | Correlates SillyTavern errors with proxy/Workspace diagnostics. |
| Optional SillyTavern chat locator | Useful for diagnostics and copied-binding detection, but never Campaign identity. |

A concrete candidate for the later design ticket is:

```http
X-RPG-Route: linked
X-RPG-Chat-Binding: <binding-id>
X-RPG-Generation-Type: normal
X-RPG-Request-Id: <uuid>
X-RPG-ST-Chat-Id: <diagnostic-locator>
```

For an unlinked chat, the bridge must send `X-RPG-Route: unlinked` explicitly and omit the binding ID. The companion must reject a missing/unknown route instead of defaulting to unlinked. It must strip all `X-RPG-*` headers before forwarding to LM Studio.

The pinned context API exposes the current `chatId`, but it is the selected group chat ID or character chat name, not a guaranteed immutable UUID. [Current chat ID](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L541-L547), [extension context](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/st-context.js#L115-L139)

**Contract consequence:** the bridge reads canonical binding data from current chat metadata on every request. The raw `chatId` is diagnostic only. The future Campaign-authority design must settle copied-binding identity and revisions.

## 3. Request body visible to the companion

For the normal Custom Chat Completion path, the companion should accept this OpenAI-style subset and preserve unknown supported inference fields where practical:

```json
{
  "messages": [{ "role": "system|user|assistant|tool", "content": "..." }],
  "model": "model-identifier",
  "temperature": 0.7,
  "max_tokens": 800,
  "max_completion_tokens": null,
  "stream": true,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "top_p": 1,
  "top_k": 0,
  "stop": ["..."],
  "logit_bias": null,
  "seed": -1,
  "n": 1,
  "tools": [],
  "tool_choice": null,
  "response_format": null
}
```

The actual request omits undefined fields. LM Studio officially supports `model`, `messages`, `temperature`, `top_p`, `top_k`, `max_tokens`, `stream`, `stop`, penalties, `logit_bias`, and `seed`. [LM Studio Chat Completions parameters](https://lmstudio.ai/docs/developer/openai-compat/chat-completions#supported-payload-parameters)

Project constraints narrow this further:

- Narrator tools are disabled. The narrator profile/bridge should ensure `tools` and `tool_choice` are absent; otherwise SillyTavern can invoke returned tool calls and recurse into another generation.
- The first proxy supports Chat Completions only. The compatibility check must reject or prevent a model/source combination that makes SillyTavern select `/completions`.
- SillyTavern's Custom source can request `n > 1` for multi-swipe generation in some modes. Hidden-draft enrichment of multiple choices is not defined. Keep `n = 1` until the proxy prototype explicitly proves multi-choice handling.
- Custom prompt post-processing may merge or reorder roles before the proxy sees them. Retrieval must use Campaign/Chat Binding data rather than reverse-engineering canonical chat state from the final `messages` array.

## 4. Generation-mode semantics

All visible modes ultimately use the same awaited Custom settings hook and backend endpoint. The bridge must forward the browser-side type explicitly.

| Type | Pinned SillyTavern behavior before request | Required proxy interpretation |
|---|---|---|
| `normal` | Ordinary send records the user message, then builds the prompt and requests a new assistant message. Empty-send may become `continue` when that user option is enabled. [Send mode selection](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L1718-L1738), [user-message insertion](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L4370-L4432) | Return a complete new assistant reply. A proxy failure leaves the user's turn present and must not synthesize a fallback reply. |
| `regenerate` | If the last message is an assistant message, SillyTavern removes it from the in-memory chat and DOM before building the request. [Regenerate preparation](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L4370-L4386), [regenerate action](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L11600-L11613) | Return a complete replacement assistant reply. Do not assume the old reply is present in `messages`. Failure/stop behavior after the local deletion must be tested for chat recovery. |
| `continue` | The current assistant message remains in the prompt. SillyTavern treats the returned text as a suffix and appends it to the existing message. [Continue prompt handling](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L4729-L4785), [continue save handling](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L5479-L5509) | Return only the continuation suffix, never the full rewritten message. Any enrichment revision must preserve suffix semantics. |
| `swipe` | The final assistant message is removed from the prompt, while its existing alternatives remain on the chat message. A newly generated reply becomes another swipe candidate. [Swipe prompt exclusion](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L4467-L4473), [swipe generation](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L10284-L10296), [swipe save](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L6643-L6669) | Return a complete alternate reply. Do not treat the current displayed candidate as narrator history. |
| `quiet` / `impersonate` | Background or user-impersonation generations share the Chat Completion request machinery but have different rendering and tool rules. | The bridge-design ticket must decide whether they are companion-routed or explicitly bypassed. They must never be accidentally classified as ordinary linked narration. |

## 5. Streaming response contract and atomic delivery

### What SillyTavern parses

- **Pinned-source fact:** when `stream` is true, the browser passes the response body through its EventSource transform, reads `data` fields, stops on the exact string `[DONE]`, parses every other data value as JSON, and accumulates `choices[0].delta.content` for Custom sources. [Streaming reader](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/openai.js#L3100-L3129), [Custom reply extraction](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/openai.js#L3229-L3236)
- **Pinned-source fact:** events are separated by a blank line; multiple `data:` lines are concatenated, and unknown fields are ignored. [SSE parser](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/sse-stream.js#L8-L80)
- **Pinned-source fact:** the SillyTavern server pipes a successful upstream stream body to the browser and preserves its status/status text, but does not copy upstream response headers. It rewrites upstream `401` to `400` to avoid resetting SillyTavern Basic auth. [Response forwarding](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/util.js#L712-L760)

The proxy should produce standard framing:

```text
data: {"id":"req","object":"chat.completion.chunk","created":0,"model":"model","choices":[{"index":0,"delta":{"role":"assistant","content":"<complete final reply>"},"finish_reason":null}]}

data: {"id":"req","object":"chat.completion.chunk","created":0,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

```

For `stream: false`, return an ordinary OpenAI Chat Completion JSON document with `choices[0].message.content`.

### Atomic final reply

SillyTavern creates and incrementally edits a chat message after the browser `fetch` receives response headers and the streaming generator starts. [Streaming message start and progress](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L3595-L3718)

**Contract consequence:** to keep the hidden draft truly hidden and deliver only the final enriched reply:

1. Accept the request but do not flush successful response headers.
2. Run preflight context, draft, retrieval, and bounded revision internally.
3. If all work succeeds, commit headers and send one full content chunk plus `[DONE]`.
4. If work fails, return a non-success response before headers are committed.

Do not send an early SSE heartbeat: it resolves SillyTavern's browser `fetch` and causes its placeholder message to appear while internal work is still running. Do not reply with non-streaming JSON to a request whose `stream` is true; SillyTavern has already selected the SSE parser. A later prototype may compare globally disabling SillyTavern streaming, but that is a user/profile choice rather than a per-request proxy trick.

## 6. Stop and cancellation propagation

### Pinned path

1. SillyTavern's Stop action aborts the streaming processor and global generation controller, hides the Stop button, and emits `GENERATION_STOPPED`. [Stop action](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L5578-L5593)
2. Streaming Chat Completion fetch uses the streaming processor's `AbortSignal`; non-streaming uses the global generation controller's signal. [Generation request dispatch](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L6082-L6137)
3. The SillyTavern server installs a socket-close listener that aborts its fetch to the Custom endpoint. [Upstream abort bridge](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/backends/chat-completions.js#L2548-L2552), [fetch signal](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/backends/chat-completions.js#L2593-L2607)
4. During response piping, downstream socket close destroys the upstream response body. [Response close handling](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/util.js#L749-L760)

**Contract consequence:** the companion must attach one cancellation signal to client disconnect/abort and propagate it through every LM Studio call and enrichment stage. A non-cancellable CPU step may finish, but its result must be discarded. Cancellation must never create a Campaign mutation or send a delayed reply.

SillyTavern normally finalizes and saves already-received partial streaming text when Stop is pressed. [Streaming stop/finalization](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L3782-L3884) Buffering without committing response headers prevents any partial model text from reaching that path. Regenerate and swipe mutate local UI/chat state before the request; their exact cancellation recovery remains a prototype obligation.

## 7. Errors and diagnostics

Return an OpenAI-shaped error body whenever possible:

```json
{
  "error": {
    "message": "Campaign service unavailable",
    "type": "campaign_unavailable",
    "code": "RPG_CAMPAIGN_UNAVAILABLE",
    "request_id": "..."
  }
}
```

Important pinned behavior:

- For streaming requests, SillyTavern forwards a non-success upstream status and raw body before streaming begins; `401` alone is rewritten to `400`. The browser attempts to display `error.message`. [Server forwarding](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/util.js#L718-L747), [browser error parsing](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/openai.js#L1625-L1663)
- For non-streaming requests, a non-success response from the Custom endpoint is converted by the SillyTavern server into a successful SillyTavern HTTP response containing a generic `{ error: { message } }`; most structured detail is lost. [Non-stream error handling](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/backends/chat-completions.js#L2607-L2633)
- An error encoded as an SSE `data:` event after a successful HTTP status may show a toast but is not a reliable stream failure boundary; the parser's error helper catches its own parse/throw path and generation can finalize empty or partial content. Return failures before committing `200` headers. [Streaming error helper](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/openai.js#L1625-L1663)

**Contract consequence:** keep narrator streaming enabled for the first compatibility prototype even though the proxy emits one final chunk; it preserves better HTTP failure semantics. Always log the request ID in the companion and expose the same failure in Workspace diagnostics, because SillyTavern's non-streaming path can discard details. Do not misuse `200` for errors merely to work around this until the compatibility prototype measures the UX trade-off.

Suggested error categories for the design ticket—not yet locked status codes—are missing routing metadata, invalid/duplicate Chat Binding, stale binding choice required, pinned-context budget exceeded, Campaign service unavailable, narrator unavailable, enrichment failed with an unenhanced draft available, and internal timeout.

## 8. `/models` and connection checks

For Custom status checks, SillyTavern joins the configured base URL with `/models`, adds the Custom API key and static included headers, and expects an OpenAI-style models response. [Status request](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/backends/chat-completions.js#L1743-L1770), [models fetch](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/backends/chat-completions.js#L1991-L2006)

LM Studio exposes `GET /v1/models`. [LM Studio model-list documentation](https://lmstudio.ai/docs/developer/openai-compat/models)

**Contract consequence:** the companion should proxy or normalize `GET /v1/models` without requiring Chat Binding headers. Dynamic generation hooks do not run for this status request. Health/model listing is not narration and must not create Campaign activity.

## 9. Compatibility risks at the pinned seam

The current contract depends on source behavior more specific than the stable high-level extension API. Manual SillyTavern updates must run bridge checks for all of these:

1. `CHAT_COMPLETION_PROMPT_READY` is still awaited with a mutable final message array.
2. `CHAT_COMPLETION_SETTINGS_READY` is still awaited after `generate_data.type` is known and before serialization.
3. Custom included headers/body are still forwarded, and invalid YAML behavior has not changed.
4. Generation `type` is either still omitted upstream or, if newly forwarded, is handled compatibly without duplicate/conflicting metadata.
5. The Custom base URL still receives `/chat/completions` and `/models` suffixes.
6. Browser abort still closes the SillyTavern request and aborts the Custom upstream fetch.
7. Streaming still accepts ordinary OpenAI chunks plus `[DONE]`.
8. `normal`, `regenerate`, `continue`, and `swipe` still produce the prompt/save semantics described above.
9. A linked chat with the wrong API type, source, URL, missing hook, or disabled bridge is stopped rather than sent directly to LM Studio.

Other material risks:

- Event and interceptor exceptions are deliberately caught by SillyTavern. Fail-closed behavior must use explicit `abort()` plus proxy-side required metadata.
- Another extension can mutate the same Custom configuration or prompt after this extension depending on listener/interceptor ordering. The bridge should declare loading order and validate the final target in the compatibility spike.
- `custom_include_body` can override standard request fields. The bridge should reserve only namespaced headers and avoid using body overrides for routing.
- SillyTavern does not copy upstream response headers while piping. The proxy must rely on valid body framing and status, not a custom response header reaching the browser.
- Custom source compatibility is intentionally not guaranteed by SillyTavern. [Official warning](https://docs.sillytavern.app/usage/api-connections/openai/#custom-openai-compatible-endpoint)
- Real-phone behavior cannot be inferred from desktop emulation. The project invariant still requires an actual phone trace at roughly 360 CSS pixels.

## 10. Required compatibility prototype

The later ST-proxy prototype must exercise the project-local pinned instance, real LM Studio, and a real phone. Capture request/response fixtures and chat JSONL before and after each case.

1. **Ordinary send:** explicit linked metadata arrives; final reply is one assistant message; hidden drafts never appear.
2. **Unlinked send:** explicit `unlinked` route passes through with the same prompt/reply semantics as direct LM Studio.
3. **Missing metadata:** proxy rejects; it never assumes unlinked and never contacts LM Studio.
4. **Linked outage:** companion/Campaign failure produces no narrator reply and no direct bypass.
5. **Regenerate:** proxy sees history without the replaced assistant reply; success replaces it; stop/failure does not corrupt chat or swipes.
6. **Continue:** proxy returns only a suffix and SillyTavern appends it exactly once.
7. **Swipe:** proxy sees history without the current assistant candidate and SillyTavern records one new alternative.
8. **Stop before final headers:** disconnect cancels all LM/enrichment work and leaves no hidden/placeholder assistant message.
9. **Stop after response begins:** document the unavoidable final-chunk race and prove no later delayed write occurs.
10. **Streaming and non-streaming errors:** record exactly what SillyTavern displays and what diagnostics remain available.
11. **Model list/status:** `/v1/models` works without Chat Binding metadata and creates no Campaign event.
12. **No tools / `n = 1`:** narrator requests contain neither tool definitions nor multiple candidates.
13. **Mobile:** send, stop, regenerate, continue, and swipe work through `:8001` while the server-side proxy connection uses `:8002`.

## Final contract

The pinned SillyTavern build can be used without patching its core. A thin UI extension supplies explicit routing metadata through the awaited Custom settings hook and uses a prompt interceptor for visible fail-closed validation. The companion implements the OpenAI-compatible `/v1/models` and `/v1/chat/completions` surface, strips bridge headers, applies Campaign routing/enrichment, forwards to LM Studio, and returns either standard non-streaming JSON or standard SSE.

The essential traps are now explicit: SillyTavern drops generation type from the upstream Custom body; hook failures are swallowed; missing metadata therefore cannot mean unlinked; `continue` needs a suffix; Custom URL is a base URL; and atomic hidden-draft delivery requires withholding successful response headers until the final reply is ready.
