# RPG Companion Bridge

This production bridge adds **Campaign Book** and **Sync Story** to SillyTavern's Extensions menu and routes each transient Custom Chat Completion through the companion at the current browser hostname on port `8002`.

Chats carrying the verified additive `stLlmRpgBinding` marker are fail-closed linked requests. Chats without that marker are explicitly unlinked and pass through once to LM Studio. The bridge does not mutate Campaign state, create bindings, inject prompts, or overwrite the saved SillyTavern connection URL.

**Sync Story** captures the bounded visible chat source and starts a durable Companion job. It opens that Campaign's Review Inbox in a separate page. Configure the Campaign Worker model in the same Review Inbox before the first run. Worker proposals remain editable drafts and cannot change Campaign truth automatically.

Install into the project-local SillyTavern runtime:

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-bridge/install.ps1
```
