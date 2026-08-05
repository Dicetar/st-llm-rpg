# Use SillyTavern's native modal layer for tool workflows

Story Sync and similar modal tools use `SillyTavern.getContext().Popup` rather than extension-owned fixed overlays. Workspace remains mounted underneath the modal, and closing the modal restores the same Workspace route and focus.

The rejected design used two independent full-screen roots, extreme `z-index` values, a cancelable cross-extension `CustomEvent`, source-panel closure, focus restoration, and delayed destination opening. Android repeatedly exposed chat between those transitions even when desktop and synthetic checks passed. Moving launchers, raising layers, and retiming the handoff did not remove the structural race.

Native Popup places a `<dialog>` in the browser top layer and lets SillyTavern own touch protection, viewport bounds, scrolling, focus, Escape behavior, backdrop, and teardown. Modal navigation must therefore use the native layer or an internal route owned by one controller. Cross-extension UI handoffs, arbitrary frame delays, and competing body overlays are not permitted.

Any change to this boundary must pass the architecture guard and an actual-phone acceptance pass. Desktop emulation is useful but cannot substitute for the phone verdict.
