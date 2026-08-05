# Use a separate Campaign Worker connection profile

Status: superseded for the companion architecture by [Require human review for model-assisted Campaign changes](./0009-require-human-review-for-model-assisted-campaign-changes.md). This profile-based integration remains the decision for the working fallback extension.

Normal narration uses the connection currently active in SillyTavern. Story Sync and other bounded analysis jobs use an explicitly selected **Campaign Worker** profile through SillyTavern's `ConnectionManagerRequestService`; they never apply that profile or switch the active chat connection.

The Workspace owns only the selected worker-profile ID. SillyTavern remains responsible for connection URLs, models, presets, and secrets. The first-run UI may create a clearly named local LM Studio worker profile after an explicit user action, but it must leave `connectionManager.selectedProfile` and the active narration settings unchanged.

A worker request receives a bounded source snapshot and minimal relevant Campaign state. Its response is parsed and validated into editable Proposals. It cannot mutate the Campaign, advance the Sync Boundary, or write chat messages. If the source chat or narrator connection changes while a request is running, the result is discarded. Missing profiles, disabled Connection Manager, malformed output, cancellation, and model failure all leave the verified Campaign untouched and preserve a manual editing path.

This adds optional setup complexity, but it isolates creative narration from conservative extraction and lets each model use an appropriate preset. Mobile browsers continue to call only SillyTavern; SillyTavern proxies the named-profile request to LM Studio.
