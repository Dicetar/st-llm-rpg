# RPG Companion Bridge

This is the production bridge entry point introduced by tracer #32. In this tracer it only adds **Campaign Book** to SillyTavern's Extensions menu and opens the companion at the current browser hostname on port `8002` after a bounded health check.

It does not intercept generation, read or write Campaign state, or replace `extension/st-rpg-campaign`. Narrator routing is introduced only in tracer #37.

Install into the project-local SillyTavern runtime:

```powershell
powershell -ExecutionPolicy Bypass -File extension/st-rpg-bridge/install.ps1
```
