# M1 Windows overlay

The desktop has two native windows: `main` is the control panel and collaborative editor; `overlay` is a compact editor for the same live document. Neither window starts the session host. The overlay has no editor toolbar or remote cursor decorations. Join in the control panel, then show the overlay. Disable click-through to write in it.

The main window owns the authenticated WebSocket connection. A desktop-only native relay sends initial Yjs state and subsequent incremental updates between the two WebViews. Independent CRDT replicas preserve simultaneous edits. Each editor keeps its own local cursor and activity; the active editor publishes through the main participant's network awareness identity. This prevents a blurred control-panel editor from clearing an overlay selection, and opening the overlay does not add a participant. Remote awareness updates reach the control-panel editor separately. Leaving clears the overlay; rejoining binds a fresh replica. No credentials pass through this relay, and documents and presence are not stored with preferences. Relay commands run off the UI thread to avoid startup IPC blocking native window creation; frontend queues preserve message order.

Desktop React code calls typed Tauri commands and listens for `overlay-changed`. Shared React accepts a control slot and contains no Tauri or Windows imports. Rust exposes the specification's `OverlayCapabilities` contract. Windows supports transparency, always on top, and click-through; capture exclusion is `unknown` until M4. Other platforms report unsupported window controls and reject their native commands with structured errors; their UI controls are disabled. They have not been runtime-tested.

The Windows adapter uses layered-window alpha (20–100%), z-order, and cursor-event controls. Slider values update immediately while native writes run serially, coalescing pending values. A native acknowledgment cannot overwrite a newer drag value, and sliders stay enabled throughout the gesture. Opacity-only changes update alpha directly; font-size changes avoid window style calls. Showing a window or changing toolkit styles can replace extended styles, so appearance is reapplied after those operations. Real compositor sampling is part of native acceptance; reading a successful API result alone is insufficient.

Ctrl+Alt+V restores interaction, shows the overlay, and brings back the control panel. Ctrl+Alt+Shift+V toggles visibility. Shortcuts are registered natively and work outside the WebView. A registration collision disables click-through and clears a saved click-through preference. There is no tray integration in M1 because the registered global recovery shortcut supplies the required escape path.

Settings include physical pixel bounds, opacity, topmost, click-through, font size, and visibility. They are validated and stored separately from documents in the app's configuration directory. Writes use a temporary file in the same directory followed by atomic replacement. Move/resize saves are debounced by 250 ms; clean shutdown flushes the current values. Corrupt or incompatible settings restore defaults with a visible message. Monitor work areas constrain saved bounds after monitor removal. Window events query current bounds to avoid replaying stale startup positions.

Native window-setting commands require the `main` window. The overlay can read settings, initiate its own drag/resize, and relay document updates and ephemeral editor presence to the main window. The relay accepts only the two known window labels and bounds message size. Capabilities permit local event subscriptions only. Click-through cannot be enabled without a registered recovery shortcut. Closing the control panel exits the app and closes the overlay.

## Verification

```powershell
pnpm --filter @veil/desktop tauri build --debug --no-bundle
cargo build -p veil-host
pnpm test:overlay
```

Run on an interactive Windows desktop, close other Veil instances and stop the demo host, and avoid moving the mouse during the test. Ports 4444, 9223 and 9224 must be free. The debug executable honors `VEIL_TEST_SETTINGS_DIR` solely for test isolation; release builds use the normal app configuration directory. The test process uses isolated WebView2 profiles and enables loopback remote debugging through its own environment.

The test connects Playwright to actual WebView2 targets and uses OS input and Win32 inspection. It verifies continuous native mouse drags of both sliders, bidirectional control-panel/overlay/browser editing, concurrent convergence, cursor/selection presence with one desktop identity, reconnect, leave/rejoin, separate windows, keyboard-operated settings, real drag/resize, opacity, compositor blending over another process, click interception/passthrough, global recovery and hide/show, atomic settings writes, non-default preferences after restart, and shortcut-collision rejection in both UI and Rust. Screenshots and isolated settings are saved under `target/overlay-acceptance`.

Unit tests cover atomic replacement, missing/corrupt files, invalid settings, and bounds fitting with removed and negative-coordinate monitors. Browser collaboration tests remain independent.

Multi-monitor/DPI hardware combinations and assistive technologies need a broader manual matrix. Capture exclusion, embedded hosting, durable documents, and distribution remain deferred.

API references: [Tauri global shortcuts](https://v2.tauri.app/plugin/global-shortcut/), [Tauri native windows](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html), and [Windows layered alpha](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setlayeredwindowattributes).
