# Collaborative Overlay — Project Specification & Implementation Plan

> **Purpose:** A practical specification and build plan for Codex. Implement incrementally, keep the app runnable after each milestone, and avoid introducing unnecessary infrastructure.

## 1. Product vision

Build a **Windows-first desktop application** that displays a movable, resizable, semi-transparent, always-on-top window containing a live collaborative document. A user can host a session directly from the desktop application. Friends can join via a browser (no installation) or another desktop client. All participants can collaboratively edit the document, and each desktop user may choose to display it as an overlay.

The host's computer runs the session server; **there is no permanently hosted collaboration backend**. A separate static download/update endpoint may distribute installers and updates. Keep the architecture portable so macOS/Linux desktop support can be added later, but do not promise cross-platform screen-capture exclusion.

### Goals

- Windows desktop client with **Host** and **Join** modes.
- Browser-based client served by the host, with no installation required.
- No hardcoded participant cap by default; allow an optional host-configured maximum, with safe resource and abuse protections.
- Live, bidirectional, simultaneous editing of one shared document.
- Desktop overlay with adjustable opacity, position, size, always-on-top, and click-through mode.
- On Windows, optional **best-effort exclusion from compatible screen capture methods**; never claim universal invisibility.
- Session authentication and secure transport for remote access.
- Local document persistence and recovery on host.
- Downloadable Windows installer and signed, verified update packages with in-app update checks.
- Shared core and platform adapters so macOS/Linux may be added later.

### Non-goals for MVP

- Guaranteed connectivity from every network without a relay.
- Guaranteed invisibility in Teams, Discord, OBS, or any capture tool.
- Cloud accounts, public session directory, SaaS backend, mobile app, video/audio chat.
- Full Google Docs feature parity, comments, complex document formatting, or offline multi-user merge.
- Native macOS/Linux installers in the first release.

## 2. User journeys

### Host a session

1. Open desktop app and select **Host session**.
2. App starts an embedded HTTP/WebSocket service and creates a random session ID and high-entropy invitation secret.
3. App displays session address, connected-user list, and copyable invitation.
4. Friends open the URL in their browser or paste it into the desktop client.
5. Host approves or removes participants, can change permissions, and can open/hide the local overlay.
6. Changes to the shared document appear live in all clients and overlays.
7. Host ends session; server stops and local document is saved.

### Join in browser

1. Open host-provided HTTPS URL (or HTTP on trusted LAN for development).
2. Authenticate using invite secret or explicit join approval.
3. Edit the document with other participants.
4. See connection state and reconnect when the host becomes reachable.

### Join with desktop client

1. Open desktop app and select **Join session**.
2. Enter host URL and invitation credential.
3. Edit the shared document in the app and optionally open a local overlay.
4. Control local overlay appearance independently of other users.

## 3. Architecture

```text
                      Host PC (Tauri Desktop)
  +----------------------------------------------------------+
  | React control panel + local overlay (Tauri windows)      |
  | Rust host service: HTTP, WebSocket, auth, session state  |
  | Yjs-compatible sync provider + local persistence        |
  +---------------------------+------------------------------+
                              |
                   HTTP(S) + WebSocket(S)
                              |
          +-------------------+-------------------+
          |                   |                   |
   Browser editor      Desktop client      More clients
   React/Tiptap/Yjs    Tauri + same UI     (up to 6 remote)
```

The host is a **central peer-hosted server**, not a mesh P2P system. WebSocket is full-duplex: all clients can send and receive. For small groups, central fan-out is simple; larger groups require load testing, backpressure, and bandwidth monitoring. The host is a single point of availability: if it closes or loses connectivity, the session becomes unavailable.

### Network realities

- **Same LAN:** connect using host's LAN address and port; host firewall must allow the listener.
- **Across internet:** host needs a reachable public address, firewall allowance, and commonly router port forwarding; CGNAT may prevent inbound connections.
- **IPv6:** may allow direct inbound access when routing/firewall policies permit.
- **No relay/server dependency:** cannot promise universal internet connectivity. Do not silently introduce a cloud relay or VPN requirement.
- **Security:** for internet sessions require HTTPS/WSS and a trusted certificate or a well-defined secure tunnel; do not expose an unauthenticated plaintext server publicly. Browser secure-context constraints and certificate trust must be considered.
- MVP networking: **localhost + LAN first**; add a documented, explicitly configured remote-access path after security review.
- The browser client assets are bundled into and served by the desktop host. No separate website deployment is necessary for editing.

## 4. Technology stack

| Area | Choice | Notes |
|---|---|---|
| Desktop shell | Tauri 2 | Windows first; macOS/Linux architecture preserved |
| Native code | Rust | Overlay integration, embedded host, persistence |
| Frontend | React + TypeScript + Vite | Shared browser/desktop UI |
| Package manager | pnpm workspaces | Monorepo |
| Collaborative editor | Tiptap + Yjs | Shared editor and CRDT state |
| Presence | Yjs awareness protocol | Cursor/name/presence; ephemeral |
| Transport | WebSockets | Browser and desktop clients |
| Embedded host | Tokio + Axum | HTTP static assets + WS endpoints |
| Sync provider | Yjs-compatible provider | Validate Rust interoperability before committing |
| Persistence | Local snapshots/updates | Atomic writes and recovery; SQLite optional |
| Distribution | Tauri bundler | Windows installer |
| Updates | Tauri updater plugin | Signed updates, HTTPS endpoint |
| CI/CD | GitHub Actions | Build/test/package/publish |

### Important Yjs interoperability decision

Yjs is implemented in TypeScript. The Rust host must **not** treat collaborative messages as arbitrary JSON text replacements. Choose and test one of these approaches early:

1. A compatible Rust implementation of the Yjs sync/awareness protocols (e.g., evaluate `yrs` and its sync ecosystem for current compatibility), with integration tests against browser Yjs clients; **or**
2. A transparent WebSocket relay for opaque Yjs updates plus a well-defined mechanism for initial state sync, reconnect, awareness fan-out, and durable snapshots (possibly a dedicated host-side JS collaboration component).

Do a **two-browser simultaneous-edit spike** before building a large editor abstraction. Confirm initial synchronization, concurrent inserts/deletes, reconnect, and host restart. Do not assume a Rust crate exposes the exact protocol required without testing it.

## 5. Repository layout

```text
collaborative-overlay/
├── apps/
│   ├── desktop/
│   │   ├── src/                 # React desktop shell
│   │   ├── src-tauri/
│   │   │   ├── src/
│   │   │   │   ├── main.rs
│   │   │   │   ├── commands/    # Tauri commands
│   │   │   │   ├── hosting/     # Axum, sessions, auth
│   │   │   │   ├── storage/     # snapshots/recovery
│   │   │   │   └── overlay/
│   │   │   │       ├── mod.rs
│   │   │   │       └── platform/
│   │   │   │           ├── windows.rs
│   │   │   │           ├── macos.rs
│   │   │   │           └── linux.rs
│   │   │   └── tauri.conf.json
│   │   └── package.json
│   └── web/
│       ├── src/                # Browser join flow
│       └── package.json
├── packages/
│   ├── editor/                 # Shared Tiptap UI
│   ├── collaboration/          # Yjs provider, awareness
│   ├── protocol/               # Typed app-level messages
│   └── ui/                     # Shared components/styles
├── docs/
│   ├── architecture.md
│   ├── networking.md
│   ├── security.md
│   └── testing.md
├── .github/workflows/
│   ├── ci.yml
│   └── release.yml
├── pnpm-workspace.yaml
└── README.md
```

Use shared packages for UI and collaboration, not for platform-specific code. Keep host networking independent from overlay window management.

## 6. Desktop windows and platform abstraction

### Windows

- **Control panel:** session management, editing, participant list, settings, update status.
- **Overlay window:** separate lightweight window displaying shared document, movable/resizable, always on top, adjustable opacity, optionally click-through.
- Overlay rendering should avoid editor toolbars and remote cursors by default. A local toggle may enable editing.
- Persist overlay bounds, opacity, and preferences **locally per device**, never in the shared document.
- Provide a tray icon or hotkey to regain control when click-through is enabled; prevent trapping the user in an unclickable window.

### Native capability contract

Expose a typed capability result to the frontend:

```ts
export interface OverlayCapabilities {
  transparency: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  captureExclusion: 'supported' | 'unsupported' | 'unknown';
}
```

Implement platform-specific native behavior behind Rust functions/traits and conditional compilation (`cfg(target_os = "windows")`, etc.). Unsupported operations return a structured error; the UI disables or explains unavailable controls. **Do not hardcode Windows APIs into shared React code.**

### Capture exclusion: best effort, not security

On Windows, evaluate `SetWindowDisplayAffinity` with `WDA_EXCLUDEFROMCAPTURE` for the overlay's top-level native window, with correct Windows API crate features, supported OS versions, and handle ownership. It may not be honored by all capture paths. On macOS/Linux initially return unsupported/unknown; future implementations require platform-specific research.

- A successful API call does **not** prove that every screen-share app excludes the overlay.
- Test supported capture modes in OBS, Teams, Discord, and Windows capture tools where feasible.
- Include a **Capture compatibility test** screen and clear user-facing limitations.
- Do not market the overlay as undetectable, guaranteed invisible, or suitable for circumventing supervision.
- If the app cannot confirm exclusion, display a non-alarming but explicit status rather than falsely asserting protection.

## 7. Collaboration model

- One shared Yjs document per session, with a named rich-text fragment for Tiptap.
- Every participant may edit by default; host can set **viewer/editor** roles.
- Use CRDT updates for document edits; do **not** send the entire document on each keystroke.
- Awareness/presence is ephemeral; throttle frequent cursor updates and remove stale peers.
- Host is authoritative for **authorization and session lifecycle**, not for arbitrary last-write-wins document text.
- Late joiners receive a consistent initial state and subsequent updates.
- On reconnect, synchronize missing state safely and avoid duplicate/corrupt edits.
- Participant cap: **unlimited by default** (no application-level numeric ceiling). Hosts may optionally configure a positive maximum; reject joins only when that optional limit is reached or safety/resource controls require it.
- Start with plain text + basic formatting (paragraphs, headings, bold, bullets); avoid complex embeds.

### App-level protocol examples (illustrative)

```json
{"type":"session.join","sessionId":"...","credential":"..."}
{"type":"participant.list","participants":[{"id":"...","role":"editor"}]}
{"type":"session.end"}
{"type":"error","code":"SESSION_FULL","message":"Host-configured participant limit reached"}
```

Yjs binary sync/awareness messages should use their established protocol and framing, not be invented as the JSON examples above. Never log invitation secrets or sensitive document contents.

## 7A. Scalability and observability (no hardcoded participant cap)

- **Default participant limit: unlimited** (represented internally as `None` / `null`, not a large magic number). Hosts can optionally configure a positive maximum.
- Do not advertise unlimited *capacity*: real limits come from upload bandwidth, CPU, memory, WebSocket connections, document size, and client rendering performance.
- Each WebSocket connection must have a bounded outgoing queue and explicit slow-consumer behavior (coalesce ephemeral presence updates; disconnect persistently stalled peers without blocking others).
- Use asynchronous per-room fan-out and avoid holding a global lock across network I/O. Keep rooms isolated.
- Rate-limit edits, awareness/presence updates, and authentication attempts independently. Enforce message-size and document-size safeguards; these are not participant caps.
- Batch/coalesce updates when appropriate, but preserve Yjs sync correctness. Throttle awareness/cursor traffic and avoid rendering an unbounded number of cursors on clients.
- Add a host dashboard showing connected users, process CPU, memory, upload/download throughput, outbound queue pressure, disconnect/reconnect counts, and measured sync round-trip latency (label measurement clearly).
- Warn on sustained resource pressure, but do not silently change the participant limit. The host may choose to stop accepting new participants.
- Benchmark at 10, 50, 100, and 500 simulated clients, with both mostly idle/viewer and actively editing workloads. Record hardware, network conditions, message rate, p95/p99 synchronization latency, memory, and bandwidth. These are test targets, **not supported-capacity promises**.
- No mandatory central relay or cloud service. Internet access still requires a reachable host and secure HTTPS/WSS; CGNAT may prevent direct access.

## 8. Session security

- Cryptographically random session identifiers and high-entropy invite credentials.
- Separate host/admin permissions from guest/editor/viewer permissions.
- Validate authentication **before** granting WebSocket document access.
- Verify origin and use explicit CORS/host restrictions where appropriate; protect against cross-site WebSocket hijacking.
- Use bounded queues, payload-size limits, message-rate limits, and unauthenticated-attempt throttling. Do not impose a fixed participant count by default; allow emergency admission control under resource pressure.
- Never bind the server to a public interface by default without an explicit user choice and security warning.
- For internet access require encrypted transport and certificate validation; avoid encouraging users to click through browser certificate warnings.
- Avoid credentials in URLs where possible because URLs can leak through history/logs/referrers; if using invite links, minimize exposure and allow revocation.
- Validate and sanitize rich-text rendering and imported content; never execute user-provided HTML.
- Store secrets securely, and do not include them in diagnostic logs.
- Provide **End session**, **Revoke invite**, **Kick participant**, and **Regenerate invite** actions.
- Document threat model: malicious invite holder, LAN attacker, internet scanner, compromised host, untrusted document content.

## 9. Persistence and recovery

- Host owns the authoritative persisted document for a session.
- Save Yjs state in a durable format, with schema/version metadata and safe atomic writes.
- Debounce saves, save on clean shutdown, and recover after an unexpected process exit.
- Handle document migrations carefully as the editor schema evolves.
- Store app preferences separately from shared documents.
- MVP: local-only history/snapshots; advanced version history is a later feature.
- Decide whether ending a session archives its document or deletes it, and expose that behavior in the UI.

## 10. Installation and updates

- Produce a Windows installer through Tauri's bundler; choose installer format based on current Tauri support and deployment needs.
- Use the Tauri updater plugin for update checks, download, signature verification, and installation.
- Sign update artifacts using the updater's required key mechanism; protect private signing keys in CI secrets.
- Use HTTPS for update manifests/packages. Verify authenticity, platform, architecture, and version.
- Check on startup and through a **Check for updates** action; do not interrupt active sessions automatically.
- Offer **Download now / Restart after session** or equivalent.
- Publish release notes and a direct download link on the product website.
- Code signing for Windows reputation/SmartScreen is a separate concern from updater signatures; investigate it before broad public distribution.
- CI builds release tags, tests, packages, signs, and publishes; do not commit secrets to the repo.
- Updates may depend on the distribution endpoint, but collaborative sessions should not depend on it.

## 11. Development milestones and acceptance criteria

### M0 — Bootstrap and architectural spike

- [ ] Initialize pnpm workspace, Tauri 2 desktop, React web app, Rust crates/modules.
- [ ] Shared UI renders in browser and desktop.
- [ ] CI runs format, lint, typecheck, Rust checks, and basic tests.
- [ ] Prove Yjs interoperability with two browser tabs editing concurrently.
- [ ] Record selected Rust sync implementation and rationale in `docs/architecture.md`.

**Done when:** two browser clients converge after simultaneous edits and reconnect.

### M1 — Windows overlay

- [ ] Create separate control panel and overlay windows.
- [ ] Drag/resize, opacity slider, always-on-top, click-through toggle.
- [ ] Restore overlay controls via hotkey/tray.
- [ ] Save and restore local overlay settings.
- [ ] Add platform capability abstraction.

**Done when:** overlay is usable over another app without blocking normal workflow.

### M2 — Embedded host + browser join

- [ ] Start/stop Axum server from desktop UI.
- [ ] Serve bundled browser editor assets.
- [ ] Add LAN listener configuration and explicit exposure settings.
- [ ] Implement session creation, invite/authentication, join/leave, presence.
- [ ] Display network address and connected users.

**Done when:** another device on the same LAN joins in a browser and exchanges live updates.

### M3 — Collaborative document + desktop guest

- [ ] Integrate Tiptap + Yjs in shared editor package.
- [ ] Sync edits among multiple remote clients and host; test concurrent editors and larger viewer populations.
- [ ] Render shared document in overlay.
- [ ] Desktop client can join another desktop host.
- [ ] Enforce viewer/editor permissions and optional host-configured participant limit (default unlimited).
- [ ] Persist/recover document state.

**Done when:** simultaneous edits converge, late joiners sync, and a host restart restores saved content.

### M4 — Windows capture compatibility

- [ ] Implement Windows capture-exclusion adapter.
- [ ] Surface supported/unsupported/error state in UI.
- [ ] Build manual capture compatibility test procedure.
- [ ] Verify overlay behavior with supported recording/sharing modes.
- [ ] Document limitations and failure cases.

**Done when:** behavior is verified for a documented test matrix; no universal guarantee is claimed.

### M5 — Secure remote access

- [ ] Document port forwarding, CGNAT, IPv6, and TLS constraints.
- [ ] Add robust access controls, rate limits, origin checks, and payload limits.
- [ ] Support a documented HTTPS/WSS deployment path without a mandatory managed backend.
- [ ] Test connection loss, reconnection, revoked invites, and malicious input.

**Done when:** remote deployment is explicit, authenticated, encrypted, and documented; unreachable networks fail clearly.

### M6 — Installer, updater, release

- [ ] Package Windows installer.
- [ ] Configure signed updater and HTTPS update feed.
- [ ] Build GitHub Actions release workflow.
- [ ] Add update UI and safe restart behavior.
- [ ] Publish installer and release notes on website.

**Done when:** a clean Windows VM can install version N and update to N+1 without losing local preferences/documents.

### Future — macOS/Linux

- [ ] Implement/test platform adapters for windowing and native integration.
- [ ] Keep unsupported capture-exclusion capability explicit.
- [ ] Add platform CI, packaging, signing/notarization where required.
- [ ] Validate overlay behavior under macOS and Linux X11/Wayland separately.

## 12. Testing plan

### Automated

- Unit: session auth, roles, optional capacity configuration (default unlimited), protocol validation, local settings.
- Integration: Yjs convergence under concurrent inserts/deletes, join-late, disconnect/reconnect, awareness cleanup.
- Integration: host lifecycle, save/restart/recovery, malformed WebSocket frames, oversized messages.
- UI: host/join flows, editing, opacity settings, disabled unsupported features.
- Release: signed update metadata and package verification in a staging channel.

### Manual matrix

| Scenario | Expected result |
|---|---|
| Host + one browser on localhost | Live bidirectional edits |
| Host + 6, 10, 50, 100, and 500 simulated clients (staged load tests) | Convergent edits and stable presence |
| Desktop guest + browser guests | All share same document |
| Two people edit same paragraph | No lost changes after convergence |
| Guest reconnects | State catches up without corruption |
| Host restarts | Saved document recovers |
| Unauthorized guest attempts access | Rejected |
| Guest is kicked | Connection closes and access is revoked |
| Overlay click-through enabled | User can recover controls via shortcut/tray |
| Windows screen capture | Exclusion tested per capture mode; limitations reported |
| Windows clean install + update | Installer and update complete successfully |

## 13. UX guidelines

- Separate **session controls** from **overlay display**.
- Display whether the app is hosting, connected, reconnecting, or offline.
- Make it obvious when a session is exposed beyond localhost/LAN.
- Show participant names and roles; let host remove participants.
- Offer a simple browser join page with minimal friction.
- Keep overlay clean: document text only by default, with optional small status indicator.
- Make opacity, position, font size, and click-through local-only settings.
- Use accessible controls and keyboard navigation; allow a global emergency hide/show shortcut.
- Never imply capture exclusion is infallible.

## 14. Known risks and decisions to validate early

1. **Yjs/Rust protocol compatibility:** validate before implementing complex editing.
2. **Browser access across networks:** no universal direct access without reachable host or relay.
3. **TLS certificate UX:** internet browser access requires a trustworthy secure origin.
4. **Tauri overlay transparency:** test native window/WebView composition early on Windows.
5. **Click-through recovery:** must always provide an escape path.
6. **Capture exclusion:** compatible Windows capture paths only, no guarantee.
7. **Tauri updater signing:** release signing and OS trust are distinct concerns.
8. **Version compatibility:** older/newer clients must reject incompatible protocols gracefully.
9. **Host shutdown:** session ends when host exits; local persistence does not provide availability.

## 15. Instructions for Codex

You are implementing the project described above. **Do not attempt all milestones in one change.**

1. Start with **M0**. Inspect the repository and explain what exists before modifying files.
2. Propose the minimal folder structure and exact commands to bootstrap it.
3. Implement a small vertical slice: shared editor with two-browser Yjs synchronization test.
4. Keep the repository buildable and tests runnable at the end of each milestone.
5. Prefer maintained libraries and current official documentation; verify APIs instead of guessing.
6. Keep platform-specific code behind interfaces, with Windows implementation first and safe unsupported fallbacks.
7. Never expose unauthenticated services publicly by default.
8. Add a short README explaining how to run the desktop app, browser app, tests, and host/join demo.
9. Document tradeoffs, unfinished work, and manual verification steps.
10. Ask for a decision only when it changes architecture materially; otherwise choose simple, maintainable defaults and state them.

### First Codex task

> Read `PROJECT_SPEC.md`. Implement milestone **M0 only**: bootstrap the monorepo, create the Tauri 2 desktop shell and React browser app, create shared packages, configure formatting/typechecking/tests, and build a minimal Yjs collaboration proof of concept with two browser clients. Verify concurrent editing and reconnect behavior. Do not implement public internet hosting, screen-capture exclusion, installers, or automatic updates yet. Explain how to run and test the result locally.

## 15A. How to work with Codex

1. Create a Git repository and place this specification at its root as `PROJECT_SPEC.md`.
2. Ask Codex to inspect the repository and implement **M0 only**. Do not ask it to build the entire product in one prompt.
3. Require a short plan before code changes, a runnable end-to-end demonstration, tests, and a list of unresolved issues.
4. Review the diff, run the commands locally, and commit the milestone when it works. Then request M1, M2, etc. in separate tasks.
5. Keep an `AGENTS.md` at the root with concise standing rules: follow this spec; preserve Windows-first/macOS-Linux-ready abstractions; default to no participant cap; do not expose services publicly without auth/TLS; do not claim universal capture exclusion; keep tests passing; avoid unrelated changes.
6. For milestones that require external access, secrets, signing keys, router changes, or OS-specific capture testing, Codex should document manual steps and **never fabricate successful validation**.
7. Before each milestone, ask Codex to state which acceptance criteria it will implement and which it will defer. At the end, require exact commands, tests/results, and remaining risks.

Suggested initial prompt:

> Read `PROJECT_SPEC.md` fully. First inspect the repository and propose a brief implementation plan. Implement **M0 only** with the smallest working vertical slice. Keep the monorepo buildable, run relevant tests, and document how I can run the demo on Windows. Do not start M1 or later milestones. Respect the unlimited-by-default participant policy and platform adapter boundaries. Report what was verified versus what requires manual testing.

Suggested next-milestone prompt:

> Read `PROJECT_SPEC.md` and inspect the current implementation. Implement **M1 only**, preserving all existing behavior. Show acceptance criteria, implement and test them, then summarize changes, commands, test results, and remaining issues. Do not proceed to M2.

## 16. Definition of MVP success

The MVP is successful when one Windows user can host a session, invite participants without a hardcoded application-level cap on a reachable network, collaborate in a shared document from browser or desktop clients, display the document in a configurable local overlay, save/recover the session document, and distribute a signed installer/update. Capture exclusion is a documented **best-effort Windows feature**, not a guarantee. The architecture remains ready for future macOS/Linux adapters.
