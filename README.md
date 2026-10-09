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

The desktop opens in **Desktop P2P** mode. Both people install Veil:

1. Enter your name and **Start peer session**, then **Generate invitation**.
2. Send the code privately to your friend. They enter their name, paste it into **Host invitation**, and choose **Create response**.
3. They send their response back. Paste it into the response field and choose **Connect friend**.
4. Edit together and open your local overlay. Generate a fresh invitation for each additional friend. There is no configured participant cap.

Codes expire after ten minutes and contain credentials and network addresses. No domain or mandatory external service is used. Empty **Network options** works only where direct connectivity permits. Across routers you may need explicitly configured STUN, or TURN for restrictive networks. You can operate both on your own reachable server; see [P2P networking](docs/p2p.md). This first slice requires a fresh code exchange to reconnect. Keep the guest session open to preserve unsent edits. **Ending/leaving loses the in-memory document.** Different-network internet and TURN acceptance remain manual.

For browser access, select **LAN / browser**. Switching modes ends the current session. The desktop command builds browser assets before launching. Choose **This computer only** (default) and click **Start session**. Enter your name and click **Join session** to edit. Copy the invitation into another browser to join the same document. No separate host or browser dev server is needed. The People panel shows participants and activity; Disconnect/Reconnect merges pending edits, and Leave session removes presence.

To join from another device on the same trusted LAN:

1. Run `ipconfig` on the host PC and find its private IPv4 address, such as `192.168.1.20`.
2. Select **Trusted LAN**, enter that address and the desired port (default **4445**), and acknowledge the unencrypted network setting.
3. Click **Start session**. If Windows prompts, allow Veil through the firewall for **private networks only**. The app does not modify firewall rules.
4. Send the invitation to your collaborator. They open it in a browser on the same LAN and enter a name. The host serves the bundled production editor directly.
5. Edit in both clients and verify bidirectional changes and presence.
6. Click **End session** to close all connections and listeners. Starting again creates a new document and invalidates the old invitation.

LAN HTTP traffic, including credentials, is unencrypted. Use only a trusted network. Do not forward this port or expose it through a public proxy. M2 accepts only loopback and explicitly selected RFC1918 IPv4 addresses. Network isolation and firewall policy may block another device even when local tests pass; see [networking](docs/networking.md).

There is no application-level participant cap. Invite holders can edit; permission roles remain later work. **Ending a session or closing Veil loses the document.** Reloading a browser removes its in-memory invitation and replica: reopen the original invitation or paste it into the join page. The browser removes the invitation fragment from visible history after reading it, but copies of the link remain credentials.

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

Select LAN / browser to start an M2 session from the control panel. Its embedded host is independent of the standalone M0 room.

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
