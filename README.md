# Veil

A Windows-first collaborative document overlay. This repository implements **M0 and M1** from [PROJECT_SPEC.md](PROJECT_SPEC.md): a shared local collaborative editor and a separate configurable Windows overlay.

## Prerequisites

- Node.js 22.12+ and pnpm 10.30.1 (`corepack enable`, then `corepack pnpm --version`). If Corepack is unavailable, install the pinned pnpm version with `npm install -g pnpm@10.30.1`.
- Rust 1.99.0 with rustfmt and Clippy (selected by `rust-toolchain.toml`).
- Windows: Microsoft C++ Build Tools with **Desktop development with C++**, and Edge WebView2. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Run the collaboration demo

From the repository root:

```powershell
pnpm install
pnpm dev:host
```

In a second terminal:

```powershell
pnpm dev:web
```

Open **http://127.0.0.1:5173** in two browser windows. Enter different names and click **Join local session** in both. Write in either editor; both receive changes. Each collaborator has a named cursor and colored text selection. The People panel shows who is typing, selecting text, in the document, or away. **Disconnect** pauses one replica; edit both independently, then **Reconnect** to merge missing updates. Browser BroadcastChannel synchronization is disabled, so all remote changes travel through the Rust host.

Click **Roadmap** in the top bar to see what is built and what remains. See the [development roadmap](docs/roadmap.md) for the same milestone overview.

In a third terminal, optionally run the native shell:

```powershell
pnpm dev:desktop
```

The desktop editor joins the separately running M0 host. Host lifecycle commands and serving bundled browser assets belong to M2.

## Use the Windows overlay

Start `pnpm dev:desktop` or open `target/debug/veil-desktop.exe` after building it. The overlay works without starting a session host.

- Click **Show overlay**, then **Settings** to adjust opacity (20–100%), font size, always on top, and click-through.
- Drag the overlay header to move it. Drag an edge or corner to resize. **Reset position & size** returns it to a reachable default position.
- **Ctrl+Alt+V** disables click-through, shows the overlay, and restores the control panel. **Ctrl+Alt+Shift+V** hides or shows the overlay globally.
- If the recovery shortcut is already in use, click-through is disabled. The control panel can always show/hide the overlay.
- Bounds, appearance, visibility, and click-through are saved locally in `%APPDATA%/dev.veil.desktop/overlay.json`; they never enter the shared document. Removed monitors are handled by fitting saved bounds into an available work area.
- Closing the control panel exits both windows and saves preferences.

M1 displays local **preview text** in the overlay. Rendering the shared document there belongs to M3. Capture exclusion remains M4. See [overlay architecture and verification](docs/overlay.md).

The host binds only **127.0.0.1:4444**. Use these exact numeric loopback URLs: origins and Host headers are checked. There is one fixed demo room, no application-level participant cap, and no persistence. **Closing the host loses the document.** Leaving a client discards its local replica; disconnected changes are retained only while that client remains open. This is a local development demonstration, not LAN or internet hosting.

## Check and test

```powershell
pnpm build
pnpm --filter @veil/desktop tauri build --debug --no-bundle
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:overlay
```

`test:e2e` starts missing host and browser dev servers; locally it reuses servers already running on ports 4444 and 5173. Use an expendable demo session: tests replace its document. CI always starts fresh servers. Independent Chromium contexts verify simultaneous inserts, concurrent offline edits, reconnect convergence, late joins, awareness removal, authentication, named cursors, selections, activity, and the roadmap. `pnpm format` formats the repository.

`test:overlay` requires an interactive Windows desktop and the freshly built debug executable. Close other Veil instances first, leave ports 9223/9224 free, and avoid moving the mouse during the test. It uses actual WebView2 windows, OS mouse/keyboard input, and a separate test application. Preferences, browser profiles, and screenshots are isolated under `target/overlay-acceptance`; your normal settings are untouched. This native test is separate from hosted CI.

## Layout and status

- `apps/desktop`: Tauri 2 control-window shell and Vite frontend.
- `apps/web`: browser demo frontend.
- `packages/editor`, `collaboration`, `protocol`, `ui`: shared client code.
- `packages/host`: Axum/Tokio/Yrs loopback spike, independently testable from Tauri.
- `docs`: architecture, security boundaries, networking, and test notes.

See [architecture](docs/architecture.md) for the protocol decision and [testing](docs/testing.md) for verification. Embedded hosting, LAN invitations, durable documents, capture exclusion, remote access, installers, and updates remain later milestones.
