# M0/M1 verification

Run the commands in the README. Windows CI builds both frontends, checks formatting/lint/types, checks and lints both Rust crates, runs unit tests, and runs Chromium interoperability tests against the real Rust host. CI execution on GitHub is separate from local validation.

## Local verification — 9 October 2026

Verified on Windows x64 with Node 22.13, pnpm 10.30.1, and Rust 1.99:

| Command                                                       | Result                                                                                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                  | Both Vite production frontends built                                                                                                                                                                           |
| `pnpm --filter @veil/desktop tauri build --debug --no-bundle` | Embedded-assets Windows executable built at `target/debug/veil-desktop.exe`                                                                                                                                    |
| `pnpm check`                                                  | Prettier, rustfmt, ESLint, TypeScript, workspace Cargo check and Clippy passed                                                                                                                                 |
| `pnpm test`                                                   | 3 TypeScript tests, 2 Rust host tests, and 2 desktop settings tests passed                                                                                                                                     |
| `pnpm test:e2e`                                               | 4 Chromium tests passed: concurrent edits, reconnect, late join, authentication, named cursors, selections, activity, cleanup, roadmap and mobile layout                                                       |
| `pnpm test:overlay`                                           | Real Windows/WebView2 acceptance passed: separate windows, native drag/resize, opacity/compositor, topmost, cross-app click-through, global shortcuts, non-default preference restart, and shortcut collisions |

Browser screenshots and real native control-panel/overlay screenshots were inspected. The native acceptance script used a separate WinForms process to verify transparency and input passthrough; it did not mock Tauri. Desktop-to-browser collaboration still needs the manual smoke check below. Hosted CI does not run the interactive native script. Vite reports a large editor bundle warning (approximately 769 kB uncompressed / 244 kB gzip in desktop); code splitting is a later optimization. Debug WebView2 logs can print a window-class cleanup diagnostic on exit; the acceptance runs exit successfully and report no JavaScript errors.

## Automated acceptance

- Protocol validation rejects invalid credentials, incompatible versions and invalid optional participant limits; null means no cap.
- Rust checks trusted HTTP Host/Origin pairs and rejects malformed/custom binary messages.
- Independent Chromium clients edit the same paragraph concurrently and converge through Rust. No BroadcastChannel shortcut is enabled.
- Both clients disconnect, edit and delete against the same initial state, then reconnect and converge without losing either insertion or resurrecting deleted characters.
- A fresh third client receives the full document.
- Departing clients disappear from awareness; unauthenticated socket upgrades fail.
- Named remote cursors and selections follow their author. Typing activity settles after idle and remote changes do not mark a receiving client as typing. Leaving removes the participant and cursor.
- The roadmap displays seven milestones, closes with Escape, and restores focus. The mobile join layout does not overflow horizontally.
- Local overlay settings replace atomically; invalid/corrupt values are rejected. Removed-monitor and negative-coordinate bounds are covered by unit tests.
- [Native overlay acceptance](overlay.md) checks actual Win32 attributes, compositor pixels, mouse drag/resize, another process receiving clicks, recovery outside the WebView, all changed settings after restart, and click-through rejection when its hotkey is taken.

## Manual development checks

1. Run host and web; join in two browser windows with different names.
2. Edit, format with bold/heading/bullets, disconnect one editor, edit both, then reconnect.
3. Start `pnpm dev:desktop`; confirm the native WebView displays the shared editor and receives browser edits.
4. Close the host: clients should show disconnection and retry. Restart it: process credentials rotate, so leave and rejoin to bootstrap a fresh connection. Restart recovery is deferred; this intentionally loses the document.
5. Close all clients and restart the host: document should be empty; this is expected for M0.

Broader multi-monitor/DPI and assistive-technology checks remain manual. Document restart persistence, live overlay document rendering, capture testing, LAN joining, capacity load targets, installers and updates belong to later milestones. Local overlay preference restart is verified in M1.
