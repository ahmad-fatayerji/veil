# M0 verification

Run the commands in the README. Windows CI builds both frontends, checks formatting/lint/types, checks and lints both Rust crates, runs unit tests, and runs Chromium interoperability tests against the real Rust host. CI execution on GitHub is separate from local validation.

## Local verification — 9 October 2026

Verified on Windows x64 with Node 22.13, pnpm 10.30.1, and Rust 1.99:

| Command                                                       | Result                                                                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                  | Both Vite production frontends built                                                                                                                     |
| `pnpm --filter @veil/desktop tauri build --debug --no-bundle` | Embedded-assets Windows executable built at `target/debug/veil-desktop.exe`                                                                              |
| `pnpm check`                                                  | Prettier, rustfmt, ESLint, TypeScript, workspace Cargo check and Clippy passed                                                                           |
| `pnpm test`                                                   | 3 TypeScript tests and 2 Rust host tests passed; desktop test harness compiled and linked                                                                |
| `pnpm test:e2e`                                               | 4 Chromium tests passed: concurrent edits, reconnect, late join, authentication, named cursors, selections, activity, cleanup, roadmap and mobile layout |

The browser UI screenshot was inspected. Native WebView/window rendering and desktop-to-browser interaction still require the manual check below; a successful executable build is not a visual runtime check. GitHub CI has been configured but has not been run remotely. Vite reports a large editor bundle warning (approximately 762 kB uncompressed / 242 kB gzip); code splitting is a later optimization.

## Automated acceptance

- Protocol validation rejects invalid credentials, incompatible versions and invalid optional participant limits; null means no cap.
- Rust checks trusted HTTP Host/Origin pairs and rejects malformed/custom binary messages.
- Independent Chromium clients edit the same paragraph concurrently and converge through Rust. No BroadcastChannel shortcut is enabled.
- Both clients disconnect, edit and delete against the same initial state, then reconnect and converge without losing either insertion or resurrecting deleted characters.
- A fresh third client receives the full document.
- Departing clients disappear from awareness; unauthenticated socket upgrades fail.
- Named remote cursors and selections follow their author. Typing activity settles after idle and remote changes do not mark a receiving client as typing. Leaving removes the participant and cursor.
- The roadmap displays seven milestones, closes with Escape, and restores focus. The mobile join layout does not overflow horizontally.

## Manual development checks

1. Run host and web; join in two browser windows with different names.
2. Edit, format with bold/heading/bullets, disconnect one editor, edit both, then reconnect.
3. Start `pnpm dev:desktop`; confirm the native WebView displays the shared editor and receives browser edits.
4. Close the host: clients should show disconnection and retry. Restart it: process credentials rotate, so leave and rejoin to bootstrap a fresh connection. Restart recovery is deferred; this intentionally loses the document.
5. Close all clients and restart the host: document should be empty; this is expected for M0.

Native window visual validation and WebView-specific networking must be reported separately from successful Rust compilation. Overlay/capture testing, restart persistence, LAN device joining, capacity load targets, installers and updates are deferred to their corresponding milestones.
