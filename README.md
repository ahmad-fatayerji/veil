# Veil

A Windows-first collaborative document overlay. This repository implements **M0 only** from [PROJECT_SPEC.md](PROJECT_SPEC.md): a pnpm monorepo, Tauri 2 shell, shared React/Tiptap editor, and a local Yjs ↔ Rust/Yrs interoperability spike.

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

The desktop uses the same editor and joins the separately running M0 host. Host lifecycle commands, serving bundled browser assets, and overlay windows are deferred to their specified milestones.

The host binds only **127.0.0.1:4444**. Use these exact numeric loopback URLs: origins and Host headers are checked. There is one fixed demo room, no application-level participant cap, and no persistence. **Closing the host loses the document.** Leaving a client discards its local replica; disconnected changes are retained only while that client remains open. This is a local development demonstration, not LAN or internet hosting.

## Check and test

```powershell
pnpm build
pnpm --filter @veil/desktop tauri build --debug --no-bundle
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

`test:e2e` starts missing host and browser dev servers; locally it reuses servers already running on ports 4444 and 5173. Use an expendable demo session: tests replace its document. CI always starts fresh servers. Independent Chromium contexts verify simultaneous inserts, concurrent offline edits, reconnect convergence, late joins, awareness removal, authentication, named cursors, selections, activity, and the roadmap. `pnpm format` formats the repository.

## Layout and status

- `apps/desktop`: Tauri 2 control-window shell and Vite frontend.
- `apps/web`: browser demo frontend.
- `packages/editor`, `collaboration`, `protocol`, `ui`: shared client code.
- `packages/host`: Axum/Tokio/Yrs loopback spike, independently testable from Tauri.
- `docs`: architecture, security boundaries, networking, and test notes.

See [architecture](docs/architecture.md) for the protocol decision and [testing](docs/testing.md) for verification and deferred work. No overlay, capture exclusion, public access, installer, updater, or durable storage is included in M0.
