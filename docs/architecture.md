# Architecture

Veil's normal desktop experience creates a temporary local document, then attaches
sharing when the user chooses Share. Hosts use a self-hosted HTTPS signaling
server; guests join through reusable session links. There is no bundled public
service or cloud document store.

## Shared editor and peer transport

Both frontends reuse the React/TypeScript UI, Tiptap editor, typed protocol, and
Yjs collaboration packages. The editor uses a named `document` XML fragment and
collaboration undo; ordinary StarterKit undo is disabled. Documents start empty
so concurrent initial synchronization does not duplicate seeded content. Vite
deduplicates Yjs and React.

`packages/collaboration/src/automatic.ts` coordinates authenticated admission,
signaling, recovery, and selective relay. `peer.ts` carries standard Yjs sync and
awareness over ordered WebRTC data channels. The host connects to each guest and
forwards updates in a star; there is no host-independent mesh or migration.
Direct negotiation precedes per-link TURN fallback. Healthy links remain active
while other links recover. Message and queue limits bound transport resources,
while state vectors recover missing edits after reconnect.

Reusable invitations pin the host identity. Host-signed key exchange establishes
independent signaling keys per admitted guest link. Native Rust commands perform
server operations and credential access. See [automatic networking](automatic-networking.md)
and [security](security.md) for the protocol and trust boundaries.

## Desktop and overlay

Tauri owns separate `main` and `overlay` windows. Windows-specific operations live
under `apps/desktop/src-tauri/src/overlay`; shared React never invokes Windows APIs.
The control panel owns session, settings, credential, and update administration.
The overlay edits a local Yjs replica through a bounded native relay and shares
the main window's collaboration identity. Sanitized participant snapshots feed
its compact activity strip. Local appearance is not synchronized as document data.

Native settings cover movement, resizing, opacity, always on top, click-through,
hide/show, and best-effort capture exclusion. Preferences use validated atomic
writes. Recovery shortcuts and tray controls prevent an unclickable overlay from
trapping the user. Unsupported capabilities remain explicit. See [overlay](overlay.md)
and [capture compatibility](capture-compatibility.md).

## Memory, credentials, and updates

Documents and session keys stay in memory; quitting discards them. Preferences
persist separately and host credentials live in Windows Credential Manager.
The sharing server does not store documents. Every admitted participant can edit
and read content, regardless of display name.

The updater checks signed release packages and blocks installation during active
document sessions or embedded hosting. The public repository contains source,
installers, and update metadata. Gitflow separates feature work on `develop` from
approved source on `main`; see [releasing](releasing.md).

## Retained regression infrastructure

`packages/host` is a Rust/Yrs host used by the standalone loopback demo and explicit
debug LAN/browser tests. It interoperates with Yjs through standard y-sync framing,
using state vectors and awareness cleanup, bounded queues, and no network I/O
while holding the room mutex. Bundled browser assets support that test path.

These legacy modes do not define production desktop networking. Trusted-LAN HTTP
is plaintext and must never be exposed publicly. Historical interop and native
acceptance records remain in [testing](testing.md); [legacy networking](networking.md)
describes the debug listener boundaries.
