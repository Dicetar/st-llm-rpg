# Mobile Workspace / Story Sync rebuild

## Decision

**Replace the separate custom Campaign Worker overlay with a native SillyTavern `Popup`. Do not close Workspace before opening Story Sync.**

The immediate safe shape is:

1. Workspace remains mounted and open.
2. Tapping **Sync Story** synchronously creates and shows one `Popup` with `POPUP_TYPE.DISPLAY`.
3. The modal contains worker setup, run state, diagnostics, and editable Proposals.
4. Closing the modal reveals the unchanged Workspace and restores focus to **Sync Story**.

The final rebuild should go one step further: one extension owns Workspace and Story Sync. Story Sync is either an internal Workspace route or a native Popup opened by that same controller. The separate `st-worker-routing-spike` UI, cross-extension `CustomEvent`, independent full-screen root, and close/`requestAnimationFrame`/open handoff should be removed.

This is not a claim that the exact Samsung failure was isolated to one browser instruction. The exact failure was not captured with device instrumentation. It is a design conclusion: the current handoff has several custom transition points, while SillyTavern already supplies a modal system designed to own stacking, mobile viewport bounds, focus, Escape, backdrop, and popup teardown.

## Evidence from the current implementation

The current Workspace and Worker are two unrelated modal systems:

- Workspace dispatches `st-rpg:story-sync-requested`, decides that cancellation means “handled,” and then closes itself (`prototypes/st-workspace-shell/index.js`, lines 391–395).
- Worker catches that document event, cancels it, and schedules `openWorker()` for another animation frame (`prototypes/st-worker-routing-spike/index.js`, lines 621–631).
- Workspace and Worker each append a full-screen fixed element directly to `document.body`, manage their own `is-open` class, `aria-hidden`, focus return, document-wide click handler, and Escape handler (`prototypes/st-workspace-shell/index.js`, lines 333–356 and 402–463; `prototypes/st-worker-routing-spike/index.js`, lines 566–639).
- The two surfaces use separate extreme `z-index` values rather than SillyTavern’s modal layer (`prototypes/st-workspace-shell/style.css`, lines 17–35; `prototypes/st-worker-routing-spike/style.css`, lines 18–31).

That transition has four independent state changes: dispatch, cancellation, Workspace close/focus restoration, and delayed Worker open. The observed Android result—Workspace disappears and chat is exposed—means the close succeeds while the second surface is not reliably visible. Retuning delays, sides, or `z-index` does not remove those transition points.

## Why SillyTavern Popup is safer

### 1. It uses the browser modal top layer

In SillyTavern 1.18.0, `Popup.show()` appends a `<dialog>` to `document.body` and calls `showModal()` ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/popup.js#L673-L702)). The HTML Standard defines `showModal()` as adding the dialog to the document’s top layer and making the rest of the document inert ([WHATWG HTML Standard](https://html.spec.whatwg.org/dev/interaction.html#modal-dialogs-and-inert-subtrees)). This is stronger and more predictable than competing with SillyTavern drawers and overlays through page-level `z-index` values.

### 2. SillyTavern explicitly protects Popup touches from drawer autoclose

SillyTavern has an `html`-level `touchstart mousedown` handler that closes unpinned drawers for outside interaction. The handler returns early when the target is within `.popup`; an arbitrary `.rpgworker` or `.rpgws` body overlay is not in that protected list ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L12123-L12162)). A native Popup therefore follows an interaction path SillyTavern itself recognizes on mobile.

### 3. It already handles mobile viewport bounds and scrolling

SillyTavern’s Popup CSS bounds dialogs with dynamic viewport units, caps width to the dynamic viewport, gives the body a constrained height, and makes `.popup-content` vertically scrollable when requested ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/css/popup.css#L8-L76)). Its `large` mode uses `90dvh` and `90dvw`, while `wider` scales down on narrow viewports ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/style.css#L3706-L3729)). Dynamic viewport units are defined to track the dynamic viewport, including retracting mobile browser UI ([CSS Values and Units Level 4](https://drafts.csswg.org/css-values-4/#dynamic-viewport-size)).

### 4. `POPUP_TYPE.DISPLAY` fits a long-lived tool surface

`POPUP_TYPE.DISPLAY` hides the stock OK/Cancel footer and exposes only the close control, leaving the extension’s own actions inside the content ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/popup.js#L451-L487)). This fits Story Sync: Test, Analyze, Stop, edit Proposal, accept, or discard are application actions, not generic dialog results.

### 5. Complex editable extension UIs already use Popup

The built-in Quick Reply extension passes a real DOM editor into `Popup`, uses `wide: true` and `large: true`, then binds its interactive controls ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions/quick-reply/src/QuickReply.js#L384-L417)). The built-in Stable Diffusion extension also hosts an editable workflow editor in a large Popup and uses `onClosing` to capture the edited value ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions/stable-diffusion/index.js#L4764-L4804)). These are first-party precedents for an editable, multi-control tool surface.

### 6. Popup owns focus and lifecycle hooks

The Popup constructor applies autofocus, remembers focused descendants, and exposes `onClosing`, `onClose`, and `onOpen` hooks ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/popup.js#L188-L269), [focus source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/popup.js#L528-L557)). It performs close animation, closes and removes the dialog, and restores focus to an underlying Popup when dialogs are stacked ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/popup.js#L814-L852)). The RPG controller should still explicitly refocus the Sync Story button when the only Popup closes.

## Exact rebuild shape

### One extension and one controller

Merge the Workspace UI and Campaign Worker UI into one extension module. Keep worker routing as a service used by Workspace, not as a second extension-owned modal. One controller owns:

- `surface`: closed, workspace, or story-sync;
- active Workspace route;
- selected Campaign Worker profile;
- worker request state and `AbortController`;
- Proposal draft and dirty state;
- the element that receives restored focus.

There must be no document-level custom event for opening Story Sync and no second full-screen root.

### Native Popup invocation

Use the stable context API rather than new direct imports. SillyTavern’s contributor guide recommends `SillyTavern.getContext()` for compatibility, and the 1.18.0 context exposes `Popup`, `POPUP_TYPE`, `eventSource`, `eventTypes`, and `ConnectionManagerRequestService` ([official guide](https://docs.sillytavern.app/for-contributors/writing-extensions/#using-getcontext), [1.18.0 context source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/st-context.js#L115-L139), [Popup exports](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/st-context.js#L185-L228), [worker service export](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/st-context.js#L285-L295)).

Recommended call shape:

```js
const { Popup, POPUP_TYPE } = SillyTavern.getContext();
const content = buildStorySyncView();
bindStorySyncView(content);

const popup = new Popup(content, POPUP_TYPE.DISPLAY, '', {
  wide: true,
  large: true,
  allowVerticalScrolling: true,
  leftAlign: true,
  allowEscapeClose: false,
  onClosing: guardDirtyOrRunningState,
  onClose: () => syncButton.focus(),
});

void popup.show();
```

Opening must happen synchronously in the Sync Story click handler. **Do not call `closeWorkspace()`, do not wait for `requestAnimationFrame`, and do not restore focus to the chat launcher during open.** Workspace remains visible underneath but is inert while the modal is open, as required by the HTML modal-dialog model ([WHATWG HTML Standard](https://html.spec.whatwg.org/dev/interaction.html#modal-dialogs-and-inert-subtrees)).

If the entire Workspace is rebuilt as a Popup, Story Sync should be an internal route in that same Popup rather than a nested Popup. A nested Popup should be reserved for destructive confirmations or compact sub-editors.

### Lifecycle

Register lightweight synchronous wiring in the manifest `activate` hook, then build UI-dependent state at `APP_INITIALIZED`. SillyTavern’s official guidance assigns synchronous loading-phase setup to `activate`, setup after all extensions and UI exist to `APP_INITIALIZED`, and non-blocking asynchronous work to `APP_READY` ([official guide](https://docs.sillytavern.app/for-contributors/writing-extensions/#best-practices-for-extension-initialization)). SillyTavern emits `APP_INITIALIZED` after settings/extensions initialize and `APP_READY` after the loader and viewport fix complete ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L692-L789)).

Declare the built-in `connection-manager` as a manifest dependency. SillyTavern does not activate an extension when a declared dependency is missing or disabled ([official guide](https://docs.sillytavern.app/for-contributors/writing-extensions/#dependencies), [loader source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L568-L664)). The request service itself rejects when Connection Manager is disabled and validates the selected profile before routing through the correct completion service ([source](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions/shared.js#L392-L492)).

### Event ownership

- Bind `click`, `input`, `change`, and keyboard handling to the Story Sync content root, not `document`.
- Use one delegated root handler with `closest('[data-action]')`.
- Stop the worker only through its owned `AbortController`.
- Disable close while a request is running, or make `onClosing` ask whether to stop and keep the draft.
- Preserve form values in controller state before any render.
- Render an error/status block inside the modal; do not rely on repeated toasts.
- Never make a successful UI transition depend on `CustomEvent.preventDefault()`.

## Mobile layout constraints

- One scroll owner: the Popup content. Avoid nested `height: 100vh`/`overflow: auto` roots inside it.
- Use a one-column form below 700–800 CSS pixels.
- Controls must be at least 44 CSS pixels high.
- Keep primary actions in a sticky bottom bar padded with `env(safe-area-inset-bottom)`.
- Use `min-width: 0` for every grid/flex child and `overflow-wrap: anywhere` for model names, URLs, and diagnostics.
- No horizontal scrolling in normal use.
- Keep Setup collapsed after a valid profile exists; keep diagnostics collapsed unless an error occurs.
- Proposal edits are local drafts until explicitly accepted.
- The running state, failure state, malformed output, and cancellation must all leave the Campaign unchanged, preserving ADR 0003.

## Acceptance checks

Run all checks on the actual phone at `10.8.1.2:8001`, not only desktop emulation.

### Surface transition

1. Open `R` and Workspace.
2. Tap **Sync Story** once.
3. A Story Sync modal is visible within one rendered frame; chat is never exposed between surfaces.
4. Workspace DOM remains mounted underneath and cannot receive taps while the Popup is open.
5. Close Story Sync; the same Workspace route and scroll position remain, and focus returns to **Sync Story**.
6. Repeat 20 times with no blank view, return-to-chat, double-open, or stuck backdrop.

### Touch and viewport

1. Verify at approximately 360 px and 540 px CSS widths, portrait and landscape.
2. Tap every action using the button label and its icon/child element.
3. Open the on-screen keyboard in URL, model, and Proposal fields; focused controls and sticky Save/Stop actions remain reachable.
4. Rotate while the modal is open; no content becomes permanently clipped.
5. Confirm no horizontal page scroll.

### Worker state

1. Missing/disabled Connection Manager produces one actionable in-modal error and no navigation failure.
2. Missing profile keeps Setup open and all entered fields editable.
3. Test, Analyze, Stop, malformed output, timeout, and network failure preserve the Proposal draft and verified Campaign.
4. Closing with a running request is guarded.
5. Closing with dirty edits is guarded; canceling the guard returns to the same field with its value intact.

### Accessibility

1. Only the Popup is interactive while open.
2. Initial focus lands on the Story Sync heading or first useful control.
3. Tab/Shift+Tab remain within the modal.
4. Escape follows the dirty/running guard.
5. Close restores focus to **Sync Story**.
6. Status updates use `role="status"`; errors use an appropriate live announcement without repeated toast spam.

## Bottom line

The native Popup should replace the custom Worker overlay. For the first repair, leave Workspace open underneath and show Story Sync directly as `POPUP_TYPE.DISPLAY`; do not perform an overlay-to-overlay handoff. For the full rebuild, make Workspace and Story Sync one extension-controlled surface and delete the separate Worker UI shell.

## Confirmed outcome

On 2026-08-02 the Worker overlay was replaced with SillyTavern's native `Popup`, Workspace was kept mounted underneath, the delayed custom-event handoff was removed, and Worker was exposed as a directly called service. The user confirmed on the actual Android phone that `R → Sync Story` now opens successfully. This phone result—not desktop emulation—is the acceptance verdict for the repair.
