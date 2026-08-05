# THROWAWAY PROTOTYPE — Interaction shells

Question: which of three structurally different SillyTavern interaction shells best supports play, state inspection/editing, contextual creation, search, Story Sync, Advance Scene, and recovery on desktop and roughly 360px mobile?

Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File prototypes/interaction-shells/serve.ps1
```

Open `http://127.0.0.1:4173/?variant=A`. Switch variants with the floating bar, keyboard left/right arrows, or `?variant=A`, `B`, and `C`.

All state is in memory. Reloading resets it. This is not production architecture or reusable production UI.
