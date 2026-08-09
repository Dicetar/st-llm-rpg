# RPG Companion Bridge

This production bridge adds **Campaign Book** to SillyTavern's Extensions menu and routes each transient Custom Chat Completion through the companion at the current browser hostname on port `8002`.

Chats carrying the verified additive `stLlmRpgBinding` marker are fail-closed linked requests. Chats without that marker are explicitly unlinked and pass through once to LM Studio. The bridge does not mutate Campaign state, create bindings, inject prompts, or overwrite the saved SillyTavern connection URL.

Install into the project-local SillyTavern runtime:

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-bridge/install.ps1
```
