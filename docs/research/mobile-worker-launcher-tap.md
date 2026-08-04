# Mobile Worker launcher tap failure

Date: 2026-08-01

Scope: `st-rpg-worker-routing-spike` on project-local SillyTavern commit `380e31e8c58d196969b6a0da74f431ba999c7e0a`

## Conclusion

Do not add more `z-index`, move the button again, or add a separate `touchend` action. Current Worker launcher works under Chromium mobile emulation with a real synthesized touch sequence. The unresolved failure is specific to the user's live mobile page/browser state. We need one device-side event/hit-test trace to distinguish three cases:

1. another element receives the tap;
2. the Worker button receives it but its listener is absent or the event is stopped before the target;
3. the listener runs, but opening fails or the workspace remains hidden.

Long-term, scrap the fourth independent floating launcher. SillyTavern already provides a supported mobile/keyboard extension surface: initialize through the SillyTavern lifecycle, then add a Worker entry to the native magic-wand `#extensionsMenu`. Official Gallery code uses that exact seam.

## What current code proves

- Worker mounts a normal `<button type="button">` directly under `document.body` and installs both a direct `click` listener and a document-delegated fallback. See [`prototypes/st-worker-routing-spike/index.js`](../../prototypes/st-worker-routing-spike/index.js), lines 143 and 606-638.
- Working `C`, `D`, and `R` launchers also mount under `document.body`, but rely only on document-delegated `click`. Worker therefore does **not** lack the handler style used by the working buttons.
- SillyTavern's global `touchstart mousedown` handler closes open drawers but does not call `preventDefault()`, `stopPropagation()`, or `stopImmediatePropagation()` on ordinary taps. See [SillyTavern `script.js`](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L12123-L12160).
- SillyTavern's long-press helper can stop a later click during capture, but only after a registered, selector-matched long press fires. Current registrations target persona/world-info/swipe controls, not `#rpgworker-launcher`. See [SillyTavern `utils.js`](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/utils.js#L3091-L3127).

### Local Chromium reproduction

Headless Chrome was run at a 360x800 mobile viewport against the live project server. Before input:

- `#rpgworker-launcher` occupied `(10, 460, 48, 48)`;
- computed `pointer-events` was `auto`;
- computed `z-index` was `2147481300`;
- `document.elementFromPoint(34, 484)` returned the launcher's child `<span>`;
- workspace display was `none` and `aria-expanded` was `false`.

A real DevTools `Input.dispatchTouchEvent` start/end generated `pointerdown`, `touchstart`, `pointerup`, `touchend`, and `click`. Afterward:

- launcher `aria-expanded` became `true`;
- workspace gained `is-open`;
- workspace display became `block`.

This disproves a universal Android/Chromium requirement for a special touch handler and disproves a universal layout overlap in the current files. It does not reproduce the user's Samsung/mobile browser environment.

## Platform facts

- HTML defines button activation through the `click` event; disabled or inert controls are the relevant exceptions. A normal mobile button does not require a parallel `touchend` activation path. [WHATWG HTML activation behavior](https://html.spec.whatwg.org/multipage/interaction.html#activation-behavior)
- Pointer Events requires user agents to support `click`; compatibility mouse events and click targeting can still depend on hit-testing and gesture processing. [W3C Pointer Events compatibility mapping](https://www.w3.org/TR/pointerevents/#compatibility-mapping-with-mouse-events)
- `document.elementFromPoint()` returns the topmost hit-tested element at viewport coordinates; elements with `pointer-events: none` are skipped. [MDN `elementFromPoint`](https://developer.mozilla.org/en-US/docs/Web/API/Document/elementFromPoint)
- `pointer-events: none` removes an element itself from pointer targeting and is inherited. [MDN `pointer-events`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/pointer-events)
- A capture listener that calls `stopImmediatePropagation()` can prevent the event from ever reaching target listeners. [MDN `stopImmediatePropagation`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopImmediatePropagation)
- Chromium performs input hit-testing through compositor layers before routing the event into the DOM. Visible pixels alone do not prove which DOM element owns a tap. [Chromium compositor hit testing](https://www.chromium.org/developers/design-documents/compositor-hit-testing/)

## Ranked causes and falsifiable tests

### 1. Live device is not executing the same Worker module/handler — most likely

Why ranked first: exact installed source works under Chromium touch emulation. SillyTavern loads extension JS and CSS from stable bare URLs without a version query, and Worker uses raw `DOMContentLoaded` plus an early `if (root exists) return`. A stale/mixed asset or surviving orphan DOM can therefore show the button without proving the expected listener is attached. SillyTavern's loader constructs the bare script URL here: [SillyTavern `extensions.js`](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L813-L832).

Test on device:

```js
const w = document.querySelector('#rpgworker-launcher');
({
  exists: !!w,
  connected: w?.isConnected,
  expanded: w?.getAttribute('aria-expanded'),
  listeners: getEventListeners(w),
  workerRoots: document.querySelectorAll('#rpgworker-root').length,
  workerButtons: document.querySelectorAll('#rpgworker-launcher').length,
});
```

Expected current build: one root, one button, and at least one target `click` listener. `getEventListeners()` is a DevTools console utility, documented by Chromium. [Chrome DevTools console utilities](https://developer.chrome.com/docs/devtools/console/utilities/)

### 2. Different live-device hit target or capture interception

Why second: visibility does not establish hit target. A browser/content-blocker/user stylesheet or live overlay can change hit-testing only on the device. Moving left/right and increasing `z-index` did not classify this.

Run this in remote DevTools, then tap W once:

```js
globalThis.__wTrace = [];
for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) {
  window.addEventListener(type, event => {
    const point = event.changedTouches?.[0] ?? event;
    globalThis.__wTrace.push({
      type,
      target: event.target?.id || event.target?.tagName,
      hit: document.elementFromPoint(point.clientX, point.clientY)?.id ||
        document.elementFromPoint(point.clientX, point.clientY)?.tagName,
      path: event.composedPath().slice(0, 5).map(node => node.id || node.tagName),
      defaultPrevented: event.defaultPrevented,
    });
  }, { capture: true, passive: false });
}
```

Then inspect `__wTrace`. No entries means browser/OS gesture routing, not Worker JS. Entries whose `hit`/`path` omit `rpgworker-launcher` prove overlay/hit-test failure. Capture entries followed by no button/click entry prove propagation interception. Chrome documents real-device inspection through `chrome://inspect#devices`. [Chrome remote debugging Android devices](https://developer.chrome.com/docs/devtools/remote-debugging)

### 3. Click runs, but open path fails or CSS keeps root hidden

Why third: user reports “no reaction,” but current UI gives no visible acknowledgement before opening. A thrown exception or mismatched root/class can look identical.

Test:

```js
const w = document.querySelector('#rpgworker-launcher');
const root = document.querySelector('#rpgworker-root');
monitorEvents(w, ['pointerdown', 'pointerup', 'click']);
w.click();
({
  expanded: w.getAttribute('aria-expanded'),
  className: root?.className,
  display: root && getComputedStyle(root).display,
  pointerEvents: root && getComputedStyle(root).pointerEvents,
});
```

Interpretation:

- `w.click()` opens it: model/state is fine; physical hit/event route is fault.
- click is logged but `expanded` stays `false`: installed listener/module mismatch.
- `expanded:true` plus missing `is-open`: open function/module mismatch.
- `is-open` plus `display:none`: CSS/version/cascade mismatch.
- exception in console: fix that exact exception; do not add touch handlers.

`monitorEvents()` is also an official Chrome DevTools console utility. [Chrome DevTools console utilities](https://developer.chrome.com/docs/devtools/console/utilities/)

### 4. Browser-specific synthesized-click behavior — low probability

Why low: normal button activation works in Chromium mobile emulation and three sibling buttons work on the same phone. A dedicated `touchend` handler would mask evidence and risks running the action twice when both touch and synthesized click fire. Test only after causes 1-3 are excluded, using pointer/click trace above.

## Supported SillyTavern replacement

Independent fixed launchers are prototype debt. Worker should use SillyTavern's native extension menu:

1. Wait for SillyTavern `APP_INITIALIZED` or `APP_READY`, not raw `DOMContentLoaded`. Official extension guidance assigns UI modifications to the application lifecycle. [SillyTavern extension initialization guidance](https://docs.sillytavern.app/for-contributors/writing-extensions/#best-practices-for-extension-initialization)
2. Append one menu row to `#extensionsMenu` containing an icon with `extensionsMenuExtensionButton`.
3. Attach a direct click listener to that row.
4. Keep the existing full-screen Worker workspace and model-routing code; replace only entry-point/mounting seam.

Why this is preferred:

- SillyTavern itself creates the magic-wand launcher and `#extensionsMenu`, mounts them into supported UI locations, and owns dismissal behavior. [SillyTavern native extension menu](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L688-L724)
- Official Gallery extension appends its action to `#extensionsMenu` and attaches a direct click listener. [SillyTavern Gallery extension](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions/gallery/index.js#L799-L818)
- SillyTavern keyboard navigation explicitly recognizes `#extensionsMenu` rows containing `.extensionsMenuExtensionButton`. [SillyTavern keyboard support](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/keyboard.js#L30-L34)

## Recommended next action

Capture one real-device trace first. It should take one tap and classify fault. Then remove standalone W and register Worker in native SillyTavern extension menu using `APP_READY`. Do not spend another iteration on launcher coordinates.

## Implemented outcome

Worker `0.0.8` removes both the standalone floating `W` and the failed duplicate magic-menu entry. **Workspace → Story Sync** is the single canonical route. The mobile handoff now cancels the Story Sync event, lets Workspace close and restore its focus, then opens Worker on the next animation frame. A regression check asserts that Worker cannot open before Workspace has had the opportunity to close. The manifest keeps versioned asset URLs so the mobile browser cannot mix this build with cached files.
