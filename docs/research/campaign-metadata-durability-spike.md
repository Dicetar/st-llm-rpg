# Campaign metadata durability spike — first device result

Research date: 2026-08-01

## Question

Can a UI-only extension persist a representative Campaign and matching Context Capsule in SillyTavern chat metadata while keeping the previous verified state usable through failed and conflicting writes?

## Environment

- project-local SillyTavern 1.18.0 on port 8001;
- real mobile client connected over the local network;
- character chat with zero narrative messages;
- Campaign durability spike installed as a third-party UI extension.

## Observed result

The user created the representative Campaign and exercised normal commit, deliberately failed commit, server verification, candidate restoration/discard, sync-boundary creation, and history checking.

Observed state transitions included:

- normal candidate: pending → verified;
- deliberately failed save: pending → failed with previous revision retained;
- subsequent verification with a recoverable candidate: checking → stale, blocking overwrite;
- candidate restoration as editable draft;
- candidate discard without changing the verified Campaign;
- a later normal revision verified successfully;
- the zero-message sync boundary reported clean.

Independent read-only inspection of the saved chat file found:

- 191 Campaign Records;
- Campaign revision 5 with five revision-trail entries;
- cached Context Capsule commit identity matching Campaign revision 5;
- 72,101-byte complete chat file;
- zero narrative messages.

The deterministic fixture itself measured about 68.6 KiB for revision 1 and 12.2 KiB for the Context Capsule before the SillyTavern chat header and later reverse revisions were added.

## What this proves

- A representative normalized Campaign fits comfortably in current chat metadata at zero-message scale.
- The public metadata-save path can be wrapped in a recoverable pending-candidate workflow.
- A failed save need not replace the last verified Campaign or Context Capsule.
- Direct server readback can distinguish the candidate, previous commit, and an unrelated/stale commit.
- The UI can block blind overwrite and preserve user input for manual recovery.

## What this does not prove

- save/load/switch latency in a multi-thousand-message chat;
- branch recovery from a genuinely older message prefix;
- history divergence after real edits, deletions, and swipes;
- browser reload during an in-flight save;
- bounded metadata growth across a long campaign;
- correct Context Capsule delivery or model adherence.

The zero-message history check is mechanically correct but provides no evidence about mutation detection.

## Architectural implication

The UI-only storage hypothesis remains viable, but immediate durable acknowledgement currently uses SillyTavern's internal `/api/chats/get` route because the public `saveMetadata()` promise swallows save failure. That dependency must be isolated behind the Campaign Session storage adapter.

Before accepting UI-only storage, compare two production choices:

1. retain internal readback with a declared SillyTavern compatibility floor and degraded pending-until-reload behavior if readback breaks;
2. ship a small SillyTavern server plugin that owns acknowledged Campaign transactions and avoids whole-chat rewrites.

Reliability, long-chat save latency, and installation burden—not preference for fewer modules—should decide between them.
