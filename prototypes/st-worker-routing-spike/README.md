# THROWAWAY PROTOTYPE — Campaign Worker routing

> Retired: the accepted routing and native Popup behavior now live in `extension/st-rpg-campaign/story-sync.js`. Do not install this prototype alongside production; it remains only as implementation evidence.

This installable SillyTavern UI extension proved that Story Sync can use a separate analysis model without changing the model used by normal chat.

It provides:

- a colocated one-click setup for an LM Studio **RPG Campaign Worker** Connection Profile;
- a worker-profile picker stored in SillyTavern extension settings, so desktop and mobile share it;
- a short exact-JSON connection check;
- bounded analysis of at most the 12 most recent non-empty messages and 14,000 source characters;
- one repair attempt for malformed JSON;
- editable proposal cards, manual add/remove, raw diagnostics, and JSON copy;
- cancellation and stale-result rejection when the chat or narrator connection changes;
- an explicit guarantee that this spike writes no Campaign state, chat messages, or Sync Boundary.

The browser sends worker calls to SillyTavern. SillyTavern uses its Connection Manager service to proxy them to LM Studio, so a mobile browser does not need direct access to port 1234.

## Install

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File prototypes/st-worker-routing-spike/install.ps1
```

Refresh SillyTavern. Open Workspace and select **Sync Story**. Story Sync opens in SillyTavern's native modal and returns to the unchanged Workspace when closed.

## First run

1. Open **Set up local Campaign Worker**.
2. Confirm the LM Studio URL and `mistralai/mistral-nemo-instruct-2407` model ID.
3. Select **Create or update worker profile**.
4. Select **Test worker**. The result must say the worker replied correctly and the narrator remained unchanged.
5. In a non-empty chat, select **Analyze recent chat** and edit/remove the proposed changes.

This is a routing and weak-model-output spike. It deliberately does not accept Proposals into a production Campaign Session yet.

`node prototypes/st-worker-routing-spike/check-native-popup-surface.mjs` rejects the old custom-overlay/event handoff and verifies the native Popup architecture.
