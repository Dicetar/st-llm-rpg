# Companion v1 completion matrix — 2026-08-13

This matrix compares the production tree with the normative v1 specification and final architecture. “Shipped” means executable production behavior with a durable regression or named evidence. It does not convert prototype evidence into completion.

| Capability | State | Evidence or remaining gap |
|---|---|---|
| Campaign-independent SQLite authority | Shipped | Immutable accepted Events, revisions, projections, reconstruction, restart, stale-write rejection, integrity checks, and migrations are covered by the Companion suite. |
| Campaign lifecycle | Shipped | Preview.22 adds archive/restore, exact-revision branching, lineage, archived fail-closed editing/narration/Story Updates, and v12→v13 verified pre-migration backup coverage. |
| Core Campaign records | Shipped | Actors, Items, Abilities, learned state, Relationships, Quests, Places, Facts, Scene Features, Current Scene, immutable Past Scenes, and Actor Trackers have structured CRUD or guarded lifecycle operations. |
| Human Workspace | Shipped for daily preview | Separate Campaign Book, grouped Play/Library/Automation/Campaign navigation, search, quick capture, detailed editors, guarded drafts, bounded lists, history, recap, handbook, recovery copy, desktop and 360px automated coverage. |
| Chat Binding | Shipped | Linking is explicit, Campaign-independent, marker-readback verified, collision/mismatch aware, revision anchored, and never advances automatically. |
| Deterministic Context Plan | Shipped | Scene, exact mention, FTS5, bounded relation expansion, visibility, manual pins, budgets, omissions, tracker detail, and dry-run inspection are covered. No vectors or narrator tools. |
| Narrator proxy | Shipped | One preflight plan and one narrator call; linked replies buffer atomically; unlinked forwarding is transparent; Stop and status/recovery seams are covered. Real pinned-ST and LM Studio desktop traces are recorded separately. |
| Story Updates | Shipped | Durable bounded worker jobs, editable evidence-linked proposals, narrator-priority inference lane, explicit accept/reject, one atomic human-applied mutation, and safe stop/resume/discard. |
| Backups and recovery | Shipped | Daily and labelled verified SQLite backups, retention, restore preview, pre-restore safety backup, migration/import backups, and rollback checks. |
| External JSON authoring | Partially shipped | Watched additive addon files have explicit diff/review/apply. Preview.22 exports current canonical Campaign truth, lineage, and history index. Full Campaign JSON re-import is still missing. |
| Legacy migration and fallback | Shipped as transition path | Reviewed fallback import, verified marker, explicit companion/fallback modes, divergence report, and preserved fallback extension remain available. |
| Permanent player journey | Shipped for deterministic browser boundaries | `npm run test:player-journey` covers the main Campaign Book lifecycle and 360px layout. It uses deterministic ST/worker fixtures, not production chat/model processes. |
| Physical-phone cutover | Open, owner-deferred | Narrow-browser behavior is automated, but the required real Android workflow has not been rerun and is not claimed. Issue #40 remains the cutover gate. |

## Honest release position

Preview.22 is a credible daily-use **cutover candidate**, not final v1. The system’s core authority, editing, retrieval, narration, reviewed automation, recovery, and lifecycle paths exist. The two material release gaps are full portable Campaign JSON re-import and an accepted real-phone cutover trace. Until both are resolved or explicitly descoped, keep the fallback installed and do not call the companion final.
