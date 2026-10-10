# Veil

A Windows-first collaborative document overlay. This repository implements **M0–M2 and P1** from [PROJECT_SPEC.md](PROJECT_SPEC.md): shared editing, Windows overlay, authenticated LAN/browser hosting, and desktop P2P.

## Prerequisites

**For testers:** download the setup EXE from [public Veil Releases](https://github.com/ahmad-fatayerji/veil/releases/latest). Windows 10/11 x64; no development tools needed. Follow the attached `TESTING.md` or [tester guide](docs/tester-guide.md). The installer is not Windows publisher-signed. Signed updater packages and GitHub updates are configured; documents remain temporary. The prerequisites below are for development.

- Node.js 22.12+ and pnpm 10.30.1 (`corepack enable`, then `corepack pnpm --version`). If Corepack is unavailable, install the pinned pnpm version with `npm install -g pnpm@10.30.1`.
- Rust 1.99.0 with rustfmt and Clippy (selected by `rust-toolchain.toml`).
- Windows: Microsoft C++ Build Tools with **Desktop development with C++**, and Edge WebView2. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Host and join a session

```powershell
pnpm install
pnpm dev:desktop
```

The desktop uses automatic P2P with self-hosted signaling and selective relay:

1. An operator deploys [veil-server](https://github.com/ahmad-fatayerji/veil-server). The host enters the HTTPS server address and operator-issued credential once.
2. Enter your name and choose **Create session**, then **Create invitation** and **Copy invitation**.
3. Your friend installs Veil, enters their name, pastes the invitation and chooses **Join**. They need no server setup or account.
4. Make a fresh invitation for each friend. Edit together and open your local overlays. The host must stay open.

Every connection tries direct/STUN first for six seconds, then requests TURN only if needed. A six-user session may have three direct friends and two relayed friends; healthy links remain independent. The displayed Direct/Relayed path comes from WebRTC statistics. No default third-party service or application participant cap is configured.

Invitations are single-use and expire after ten minutes. **Leave/End discards the in-memory document.** Signaling outages keep healthy peer links running; local content remains visible if server registration ends. See [automatic networking](docs/automatic-networking.md) for security, deployment, recovery and validation boundaries. Existing manual/LAN infrastructure is debug regression tooling only; never expose its HTTP listener publicly.

## Run the local development spike

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

The legacy native M2/manual UI is available only in debug acceptance runs with `VEIL_TEST_LEGACY=1`. Normal desktop sessions use automatic networking.

## Use the Windows overlay

Start `pnpm dev:desktop` or open `target/debug/veil-desktop.exe` after building it. Start a session, enter your name, and join it in the control panel.

- Click **Show overlay**, then **Settings** to adjust opacity (20–100%), font size, always on top, and click-through.
- Write directly in the overlay or control-panel editor. Both show the same live document and share one participant identity. Browser collaborators receive edits, cursors, and selections from either window.
- Drag the overlay header to move it. Drag an edge or corner to resize. **Reset position & size** returns it to a reachable default position.
- **Ctrl+Alt+V** disables click-through, shows the overlay, and restores the control panel. **Ctrl+Alt+Shift+V** hides or shows the overlay globally.
- If the recovery shortcut is already in use, click-through is disabled. The control panel can always show/hide the overlay.
- Bounds, appearance, visibility, and click-through are saved locally in `%APPDATA%/dev.veil.desktop/overlay.json`; they never enter the shared document. Removed monitors are handled by fitting saved bounds into an available work area.
- Closing the control panel exits both windows and saves preferences.

The overlay has no formatting toolbar or remote cursor decorations. Turn off **Click-through** to edit; enable it to let clicks reach the app underneath. Before joining, it explains how to open the control panel. Capture exclusion remains M4. See [overlay architecture and verification](docs/overlay.md).

The standalone M0 demo binds only **127.0.0.1:4444** and keeps its fixed development room and trusted-origin credential bootstrap. The embedded M2 host uses port **4445** by default, fresh sessions, and invitation authentication. Its router never exposes the M0 bootstrap.

## Check and test

```powershell
pnpm build
cargo build -p veil-host
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm --filter @veil/desktop tauri build --debug --no-bundle
pnpm test:overlay
pnpm test:host
pnpm test:peer
pnpm test:installer
```

`test:e2e` starts missing host and browser dev servers; locally it reuses servers already running on ports 4444 and 5173. Use an expendable demo session: tests replace its document. CI always starts fresh servers. Independent Chromium contexts verify simultaneous inserts, concurrent offline edits, reconnect convergence, late joins, awareness removal, authentication, named cursors, selections, activity, and the roadmap. `pnpm format` formats the repository.

`test:overlay` requires an interactive Windows desktop and a freshly built desktop debug executable. Close other Veil instances; leave ports 4445/9223/9224 free, and avoid moving the mouse during the test. It starts an embedded session through the real control panel and joins through the bundled browser editor. It uses actual WebView2 windows, OS input, a Chromium collaborator, and a separate test application. Preferences and screenshots are isolated under `target/overlay-acceptance`; normal settings are untouched.

`test:host` uses real Tauri/WebView2 controls and Chromium to check bind failure recovery, hosting, authentication, bundled assets, live updates, presence, stop/restart and invitation rotation. Close other Veil instances and leave ports 4445/9225 free. Artifacts are isolated under `target/host-acceptance`. Optionally set `$env:VEIL_TEST_LAN_ADDRESS = '192.168.1.20'` to this PC's real private IPv4 address before running it. That exercises the private interface on this PC; a second physical device remains manual. Both native scripts run separately from hosted CI.

## Layout and status

Run the Tauri debug build **after Cargo tests and before native acceptance scripts**. Cargo integration tests can replace `target/debug/veil-desktop.exe` with a development-server build. Rebuilding with the Tauri CLI restores the embedded-assets test executable.

Use `pnpm package:windows` to build the production NSIS installer and updater signature. Gitflow branches, required CI, reviewed version proposals, beta/stable publication, private key backup and update safety are documented in [releasing](docs/releasing.md). Source remote points to private `Veil-source`; public `veil` contains downloads only. Request betas explicitly; merging a finalized release PR approves stable publication. App updates offers separate stable and beta channels.

`test:peer` launches three real desktop/WebView2 peers with isolated profiles. It requires a freshly built debug executable and free ports 9231–9233. It checks credential rejection, direct transport, fragmented updates, offline merge after fresh signaling, presence, P2P overlay editing and shutdown. Redacted screenshots are under `target/peer-acceptance`. This native script runs separately from hosted CI; internet and TURN checks remain manual.

- `apps/desktop`: Tauri 2 control-window shell and Vite frontend.
- `apps/web`: browser demo frontend.
- `packages/editor`, `collaboration`, `protocol`, `ui`: shared client code.
- `packages/host`: reusable Axum/Tokio/Yrs host library and loopback-only M0 demo. Browser assets are compiled into the library after `pnpm build`. A bare Cargo build can compile without assets, but embedded hosting then reports an error until browser assets are built and Rust is rebuilt.
- `docs`: architecture, security boundaries, networking, and test notes.

See [architecture](docs/architecture.md) for the protocol decision and [testing](docs/testing.md) for verification. Durable documents, permissions, capture exclusion, different-network/relay acceptance and automatic signaling remain later work. M6 installers and signed updates are available for testing; clean-VM acceptance remains manual.
