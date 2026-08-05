# SillyTavern mobile extension mount failure

Research date: 2026-08-01

Target: project-local SillyTavern `1.18.0`, commit [`380e31e8`](https://github.com/SillyTavern/SillyTavern/tree/380e31e8c58d196969b6a0da74f431ba999c7e0a), with global extension `third-party/st-rpg-workspace-spike`.

## Conclusion

The extension is discovered, enabled, loaded, and mounted on mobile. Its UI is absent because SillyTavern's mobile layout gives the extension's fixed-position elements a zero-height containing block.

The exact interaction is:

1. SillyTavern applies `translateZ(0)`, `backface-visibility: hidden`, and `perspective: 1000` to `html` ([`public/style.css` lines 143-147](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/style.css#L143-L147)).
2. At widths up to 1000 px, SillyTavern applies `position: fixed` to `body` ([`public/css/mobile-styles.css` lines 1-2 and 250-254](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/css/mobile-styles.css#L1-L2)). The relevant body rule is at [lines 250-254](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/css/mobile-styles.css#L250-L254).
3. A non-`none` transform makes the element a containing block for fixed descendants, including an identity transform such as `translateZ(0)`. A non-`none` perspective does the same. These are specified behaviors, not Chrome quirks: [CSS Transforms Level 1, containing block rule](https://www.w3.org/TR/css-transforms-1/#transform-rendering) and [CSS Transforms Level 2, perspective rule](https://www.w3.org/TR/css-transforms-2/#perspective-property).
4. With the mobile `body` fixed and therefore out of normal flow, the live `html` box measured 0 px high. The extension mounts both fixed elements as direct `body` children. The launcher is bottom-anchored by `bottom: 112px`, so Chrome resolves it against the 0 px-high `html` containing block and places it above the viewport.

This directly explains both attachments: SillyTavern is usable and the extension manager marks the RPG extension active, but there is no visible Campaign launcher.

## Reproduction evidence

A clean headless Chrome 150 page load against the live project server at `http://127.0.0.1:8001/`, at a mobile media-query width, produced:

| Item | Measured state |
| --- | --- |
| Viewport | `innerWidth=500`, `innerHeight=705`, `devicePixelRatio=1` |
| Extension module | present as `script#third-party_st-rpg-workspace-spike-js` |
| Extension stylesheet | present, parsed, and attached as `link#third-party_st-rpg-workspace-spike-css` |
| Workspace DOM | `#rpg-workspace-boundary-spike` present |
| Launcher DOM | `#rpgws-launcher` present |
| Launcher computed style | `display:flex`, `visibility:visible`, `opacity:1`, `position:fixed`, `right:12px`, `bottom:112px`, `z-index:2147481000` |
| Launcher rectangle | `x=440`, `y=-160`, `width=48`, `height=48`, `bottom=-112` |
| `html` | rectangle height `0`; `transform: matrix(1,0,0,1,0,0)`; `perspective:1000px` |
| `body` | rectangle height `705`; `position:fixed`; no transform |

The launcher is therefore rendered correctly but entirely above the visual viewport. Its very high z-index cannot help because this is a geometry failure, not stacking.

Two temporary, non-persistent diagnostic mutations isolated the cause:

- Setting only `html { transform:none !important }` left the launcher at `y=-160`, because `perspective:1000px` still established the zero-height containing block.
- Setting both `transform:none !important` and `perspective:none !important` moved the launcher to `y=545`, `bottom=593`, exactly 112 px above the 705 px viewport bottom.
- With the screenshot-time workspace rule (`position:fixed; inset:0`) forced open, its rectangle was `500 x 0`. With both containing-block properties temporarily disabled, it became `500 x 705`.

This is a causal A/B result. It also means merely changing launcher z-index, extension loading order, or chat state cannot repair the bug.

## Extension load trace

### Discovery and global/local paths

SillyTavern defines global extensions at `public/scripts/extensions/third-party` ([`src/constants.js` lines 1-7](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/constants.js#L1-L7)). The installed extension is at:

`D:\Projects\st-llm-rpg\.runtime\SillyTavern\public\scripts\extensions\third-party\st-rpg-workspace-spike`

The `/api/extensions/discover` endpoint enumerates built-in extensions, user-local extensions under `data/<user>/extensions`, and global extensions under the public third-party directory. It prefixes both external types with `third-party/` and lets a user-local folder win on a name collision ([`src/endpoints/extensions.js` lines 476-515](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/endpoints/extensions.js#L476-L515)). The server's extension file handler likewise checks the user-local path first and falls back to the global path ([`src/users.js` lines 1092-1115](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/src/users.js#L1092-L1115)).

On the live instance:

- `/api/extensions/discover` returned `third-party/st-rpg-workspace-spike` as type `global`.
- The manifest, JS, and CSS URLs under `/scripts/extensions/third-party/st-rpg-workspace-spike/` all returned HTTP 200 with the correct MIME types.
- There is no user-local folder with the same name, so no local/global shadowing occurs.

### Manifest and URL resolution

The screenshot-time manifest declared `js: "index.js"`, `css: "style.css"`, `loading_order: 200`, and `minimum_client_version: "1.18.0"` in `prototypes/st-workspace-shell/manifest.json` lines 1-10. The installation script copies those files to the global directory (`prototypes/st-workspace-shell/install.ps1` lines 5-7 and 26-30).

The client fetches each manifest from `/scripts/extensions/${name}/manifest.json` ([`public/scripts/extensions.js` lines 533-561](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L533-L561)). For an eligible extension, it builds both asset URLs from the same name and manifest fields ([activation at lines 568-664](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L568-L664), [CSS loader at lines 775-805](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L775-L805), [module loader at lines 807-840](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L807-L840)). The observed script and link nodes used those correct URLs.

### Disabled and active state

`D:\Projects\st-llm-rpg\.runtime\SillyTavern\data\default-user\settings.json` lines 454-463 list only `tts`, `third-party/tts-pause-resume`, and `third-party/llm-rpg-bridge` in `disabledExtensions`; the RPG workspace is not disabled.

The manager checkbox is stronger evidence than simple discovery. SillyTavern checks the box only when `activeExtensions.has(name)` is true; a discovered but inactive and non-disabled extension receives a disabled "Cannot enable extension" control ([`public/scripts/extensions.js` lines 890-970](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L890-L970)). The checked, bold RPG row in Photo 1 therefore means SillyTavern considered it active.

### Lifecycle timing

Lifecycle timing is not the failure. SillyTavern's main module waits for the page `load` event before application initialization ([`public/script.js` lines 336-345](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L336-L345)). Settings loading then awaits `loadExtensionSettings()` ([`public/script.js` lines 7991-8004](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/script.js#L7991-L8004)), which discovers, loads manifests, and activates extensions ([`public/scripts/extensions.js` lines 1783-1808](https://github.com/SillyTavern/SillyTavern/blob/380e31e8c58d196969b6a0da74f431ba999c7e0a/public/scripts/extensions.js#L1783-L1808)).

The extension's own `mount()` unconditionally appends the workspace and launcher to `document.body` (`prototypes/st-workspace-shell/index.js` lines 438-447). Its ready-state guard mounts immediately unless the document is still loading (lines 464-468). Because SillyTavern does not begin this stage until window load, the normal path is immediate mount. It does not require a selected character or an existing chat.

## Mobile CSS interaction in the extension

The extension's screenshot-time styles made both critical surfaces fixed descendants of the transformed `html` root:

- `.rpgws`: `position:fixed; inset:0` (`prototypes/st-workspace-shell/style.css`, screenshot-time lines 17-29).
- `#rpgws-launcher`: `position:fixed; right:12px; bottom:calc(112px + env(safe-area-inset-bottom, 0px))` (`prototypes/st-workspace-shell/style.css`, screenshot-time lines 343-355).

At `max-width:800px`, the extension deliberately hides only the launcher's text label and keeps the 48 px launcher button (`prototypes/st-workspace-shell/style.css`, screenshot-time mobile block beginning at line 400). There is no mobile rule that sets the launcher to `display:none`, `visibility:hidden`, zero opacity, or zero size.

The extension's full-screen workspace suffers the same containing-block problem. Even if the off-screen launcher were invoked programmatically, the screenshot-time `inset:0` root resolves to a 0 px-high grid on mobile.

## Ranked causes

1. **Confirmed — zero-height fixed-position containing block created by SillyTavern mobile CSS.** This matches the source, the W3C positioning rules, the screenshots, the measured negative launcher rectangle, the 0 px workspace height, and the two-property A/B probe.
2. **Possible only after a future fix — stale browser assets.** A mobile browser could keep an older extension file after an implementation change. It did not cause the reported screenshot: the live screenshot-time CSS itself deterministically positions the launcher above the viewport. Verify actual `script.src`, `link.href`, and loaded response bodies before clearing data.
3. **Ruled out for this report — wrong global/local URL resolution or disabled setting.** Discovery, file responses, settings, and the active manager row all contradict it.
4. **Ruled out for this report — mount lifecycle race or "no chat" gating.** SillyTavern loads extensions after window load; `mount()` is unconditional; the clean page contained both DOM nodes.
5. **Ruled out for this report — z-index, hidden mobile rule, or extension exception.** Computed visibility/display/opacity/size were normal and the node existed. It was simply off-screen.

## Concrete probes for Android Chrome

Run these in remote DevTools against the affected phone. They are read-only unless marked otherwise.

```js
const launcher = document.querySelector('#rpgws-launcher');
const workspace = document.querySelector('#rpg-workspace-boundary-spike');
({
  launcherExists: Boolean(launcher),
  workspaceExists: Boolean(workspace),
  launcherRect: launcher?.getBoundingClientRect(),
  launcherStyle: launcher && Object.fromEntries(
    ['display', 'visibility', 'opacity', 'position', 'top', 'right', 'bottom', 'zIndex']
      .map(key => [key, getComputedStyle(launcher)[key]]),
  ),
  htmlRect: document.documentElement.getBoundingClientRect(),
  htmlTransform: getComputedStyle(document.documentElement).transform,
  htmlPerspective: getComputedStyle(document.documentElement).perspective,
  bodyRect: document.body.getBoundingClientRect(),
  bodyPosition: getComputedStyle(document.body).position,
});
```

Expected failing signature: both nodes exist; launcher `display:flex`; launcher bottom is negative; `html` height is 0; `html` transform is a matrix; `html` perspective is `1000px`; `body` is fixed.

Check asset identity separately:

```js
({
  script: document.querySelector('script[id*="st-rpg-workspace-spike"]')?.src,
  style: document.querySelector('link[id*="st-rpg-workspace-spike"]')?.href,
  styleParsed: Boolean(document.querySelector('link[id*="st-rpg-workspace-spike"]')?.sheet),
});
```

For diagnosis only, not as a permanent fix, temporarily disable both containing-block properties and re-read the rectangles:

```js
document.documentElement.style.setProperty('transform', 'none', 'important');
document.documentElement.style.setProperty('perspective', 'none', 'important');
document.querySelector('#rpgws-launcher')?.getBoundingClientRect();
```

Disabling only one property is not a valid test because either property independently establishes the containing block. Reload the page to discard the temporary change.

## Implementation implications (no implementation changed by this research)

The extension must not rely on viewport-relative `position:fixed` behavior through SillyTavern's transformed/perspectived zero-height root on mobile. Any fix should be validated for both surfaces:

1. The launcher rectangle is inside the visual viewport at phone widths and after the Android address bar expands/collapses.
2. Opening the workspace yields a non-zero rectangle matching the visual viewport.
3. Desktop geometry remains correct.
4. The extension still mounts once, remains keyboard accessible, and does not alter SillyTavern's global `html` transform/perspective as a side effect.

Changing only z-index, cache-busting the JS, or waiting for a chat will not address the verified geometry failure.
