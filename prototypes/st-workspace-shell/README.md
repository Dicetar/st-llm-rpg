# THROWAWAY PROTOTYPE — SillyTavern Workspace C boundary spike

This installable UI extension answers one question: can Workspace C live safely inside SillyTavern without rewriting or reparenting SillyTavern's own chat UI?

It proves:

- a full-height extension-owned Campaign workspace;
- independently hideable Collections, Records, and Chat Peek panels;
- automatic editor expansion when panels are hidden;
- panel visibility remembered locally;
- per-chat editable drafts retained while closing the workspace or switching chats;
- a read-only preview of recent SillyTavern messages;
- one-click return to the native SillyTavern chat;
- a one-panel-at-a-time layout below 800px.

It deliberately does not persist Campaign data, inject prompts, or replace the SillyTavern composer. **Sync Story** calls the Campaign Worker service directly and opens its editable proposal UI in SillyTavern's native modal while Workspace remains mounted underneath.

## Install for testing

For the SillyTavern installation used by this project, run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File prototypes/st-workspace-shell/install.ps1
```

The installer validates the target and refuses to overwrite an extension with a different manifest.

Alternatively, copy or directory-link this `st-workspace-shell` folder into SillyTavern's third-party extension directory:

```text
SillyTavern/public/scripts/extensions/third-party/st-rpg-workspace-spike
```

Restart SillyTavern, enable **RPG Workspace C — Boundary Spike**, open any chat, and use the floating **Campaign** button.

## Human checks

1. Open the workspace and hide Collections, Records, and Chat Peek in different combinations.
2. Edit the selected record, return to chat, then reopen it. The unsaved draft should remain.
3. Switch to another SillyTavern chat, edit a record, then switch back. Each chat should recover its own draft.
4. Narrow the browser to about 360px. Only the selected mobile section should be visible and no form should overflow horizontally.
5. Confirm that Return to chat restores focus and the native SillyTavern composer remains untouched.

Reloading the browser preserves panel visibility but session drafts last only for the current browser tab/session. Delete the extension folder after the verdict.
