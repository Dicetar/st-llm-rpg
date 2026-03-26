# 06 — Why this is realistic in SillyTavern

This extension path is realistic because SillyTavern officially supports:

- UI extensions that can modify UI, call APIs, and interact with chat data
- persistent extension settings through `extensionSettings`
- chat-scoped metadata through `chatMetadata`
- slash-command infrastructure, including the newer `SlashCommandParser.addCommandObject(...)`
- generation interceptors registered in `manifest.json`

Those capabilities are enough for a **thin bridge layer**.

At the same time, SillyTavern’s own docs are explicit that some functionality belongs in server plugins or outside the browser, especially when you need server-side code or new endpoints.
That is why the extension in this pack does not try to own the real database or business rules.

This is exactly the right boundary for your project:

- ST = chat shell, slash commands, side panel, prompt injection
- backend = validation, mutation, state reads, logging
- LM Studio = narration and optional structured extraction
