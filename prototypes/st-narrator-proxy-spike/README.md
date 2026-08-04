# ST narrator proxy compatibility spike

**THROWAWAY PROTOTYPE - never treat this as the production companion.**

## Question

Can pinned SillyTavern `380e31e8c58d196969b6a0da74f431ba999c7e0a` describe each real Chat Completion request to a local proxy at `:8002`, while the proxy preserves explicit-unlinked LM Studio behavior and linked normal/regenerate/continue/swipe/Stop semantics without corrupting saved chat state? The spike also checks that linked Campaign outage fails before LM Studio and that a complete linked reply can be withheld until it is atomically ready.

The extension and proxy deliberately implement only enough behavior to answer that question. There is no SQLite Campaign, Context retrieval, production authentication, durable recovery, or polished Workspace.

## Run

From the repository root:

```powershell
npm run prototype:proxy
```

The command installs the throwaway bridge into the project-local SillyTavern runtime and starts the proxy on `0.0.0.0:8002`. Reload SillyTavern after the first install and enable **RPG Narrator Proxy Spike** if it is not already enabled.

Configure SillyTavern's ordinary Custom Chat Completions URL as:

```text
http://127.0.0.1:8002/v1
```

The bridge refuses any linked or unlinked generation if Custom Chat Completions is not selected or the URL differs. It never silently rewrites the profile.

The proxy forwards live requests to:

```text
http://127.0.0.1:1234/v1
```

## Controls

The proxy terminal always redraws its complete bounded state.

```text
[o] toggle Campaign available/outage
[f] toggle live LM Studio/deterministic fixture
[d] toggle zero/10-second linked delay
[c] clear attempt history
[q] stop proxy
```

The extension adds a small **RPG Narrator Proxy Spike** section to SillyTavern's Extensions settings. Use **Link this chat** or **Make this chat unlinked**. A linked marker contains only a throwaway Binding ID. The current character avatar/group ID and chat ID are presented separately as mutable locator evidence.

Machine-readable state is available on the trusted LAN at:

```text
GET  http://127.0.0.1:8002/prototype/state
POST http://127.0.0.1:8002/prototype/control
```

Example control body:

```json
{
  "campaignAvailable": true,
  "upstreamMode": "fixture",
  "linkedDelayMs": 10000
}
```

No prompt or generated prose is persisted by default. State records only IDs, hashes, roles, counts, byte sizes, timings, stages, and errors. Selected test-chat traces must be reviewed and sanitized before they become repository evidence.

## Expected answer format

The verdict in `docs/research/sillytavern-narrator-proxy-prototype.md` must distinguish:

- directly observed pinned-ST and LM Studio behavior;
- deterministic fixture evidence;
- inferred behavior that remains unproved;
- desktop automation versus real-phone evidence;
- any design in issue #19 that the prototype contradicts.
