# Use parallel previewed cutover with a preserved fallback

Status: accepted provisionally and logic-proven by Wayfinder #25. Real process, bridge, backup, update, and device traces remain required before the fallback can be retired.

Legacy `chat_metadata.stLlmRpgCampaign` is imported through a verified preview into a self-contained SQLite Campaign at Revision 1 plus an explicit Chat Binding. Migration never converts or deletes the legacy envelope in place. Exact re-import is idempotent; copied sources require a human choice; the Binding remains blocked until its SillyTavern marker is written and read back.

One visible `Wayfinder.cmd` supervisor owns project-local SillyTavern on `:8001` and the companion on `:8002`, observes but never owns LM Studio on `127.0.0.1:1234`, blocks occupied required ports, and stops only identity-matched children it started. Workspace remains available in a degraded state when LM Studio is absent.

External JSON files are reconciled by full-directory hash scans into persisted Import Candidates. Filesystem events never mutate Campaign truth. A user-visible diff plus exact manifest hash and Campaign Revision is required; a validated backup precedes one accepted atomic addon batch. Missing rows never delete accepted Campaign subjects.

Compatibility updates stage a reviewed SillyTavern runtime beside the active one, back up first, run compatibility checks, switch atomically, and restore the prior runtime after failed smoke checks. Project source updates remain user-controlled Git operations.

Fallback remains one command and preserves both stores. Before switching, it backs up/exports companion truth and records divergence. It resumes from untouched legacy metadata; any later companion-only Events are not silently downgraded, and continued fallback play is explicitly a divergent history.

Full rationale, command/health contracts, migration flow, backup retention, update procedure, and real-campaign acceptance trace are in [Migration, launcher, updates, and cutover](../design/migration-launcher-updates-and-cutover.md).
