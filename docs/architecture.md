# M0-M2 architecture

P1 adds a shared `PeerProvider` in `packages/collaboration/src/peer.ts`, using browser WebRTC APIs and standard y-protocols over ordered data channels. The main desktop defaults to P2P, accepting an externally owned collaboration connection into the same shared UI/editor and local overlay bridge. The host peer coordinates a star and forwards updates. Manual offer/answer codes avoid mandatory signaling infrastructure. Optional explicitly configured ICE servers have no defaults. Native Windows APIs remain isolated. Existing Rust hosting is retained in a separate LAN/browser mode. See [P1 transport and limits](p2p.md).

React + TypeScript + Vite frontends in both applications consume the same Tiptap editor, shared UI, typed application protocol, and Yjs connection factory. pnpm resolves a single Yjs 13 instance; Vite explicitly deduplicates it and React. Tiptap uses one named `document` XML fragment and its collaboration undo implementation; StarterKit's ordinary undo/redo is disabled. Documents begin empty so simultaneous first joins cannot duplicate seeded content.

## Rust sync decision

Use **Yrs 0.28.0 `DefaultProtocol`**, its `Awareness`, and standard binary y-sync framing with **Yjs 13 + y-websocket 3.0**. Rust 1.99 is pinned to support the current Yrs release; the preinstalled Rust 1.92 cannot compile its match guards. We also pin y-websocket 3.0 for the stable Yjs 13 editor ecosystem. Updates are applied to a real Rust CRDT replica, rather than JSON text replacements or an opaque relay. This supplies late join and reconnect state vectors without a host-side JavaScript runtime.

The host is a reusable Rust library under `packages/host`; its binary preserves the loopback-only M0 spike. M2 embeds the same sync implementation in Tauri. Native networking and overlay management remain separate; shared React does not invoke Windows APIs. The M1 native implementation and capability contract live under `apps/desktop/src-tauri/src/overlay`; [overlay notes](overlay.md) describe window controls, settings, and verification.

The server initiates state-vector sync and sends current awareness in separate WebSocket frames: y-websocket 3 processes one protocol message per frame. Client sync-step-1 receives missing state; server sync-step-1 receives missing client state. Applied update and awareness messages fan out through a bounded broadcast channel. Subscription occurs before initial state construction. No network I/O runs while holding the room mutex. Lagged subscribers and stalled sends disconnect and must resync, rather than silently losing updates. Each connection claims its local awareness ID, so forwarded remote awareness cannot transfer ownership. Cleanup emits tombstones without advancing remote clocks, and reconnect advances the local awareness clock, avoiding suppressed presence after rejoining.

The interoperability acceptance test runs two independent browser contexts, disables BroadcastChannel, concurrently edits one paragraph, independently deletes/inserts on disconnected replicas, reconnects, compares rendered documents, and checks a late arrival and awareness cleanup. This is the gate before expanding the editor abstraction.

## Tradeoffs and deferred work

- The standalone M0 demo uses a fixed room; each M2 session has a fresh random ID and invitation, and one in-memory document. Ending a session loses state; durable snapshots are M3.
- Loopback credential bootstrap is restricted to the standalone development demo. Embedded sessions require an invitation before joining or upgrading to a socket. Ending a session revokes its invitation; host roles, approval, per-participant removal and invite regeneration remain later work.
- 256 KiB frames, 128 queued broadcasts per subscriber, a five-second send timeout, and a simple 200-frame/second guard bound some spike resources. They are not participant caps or production abuse controls. Document size, independent edit/awareness/auth limits, expiry and resource telemetry need later work.
- The shared editor binds Tiptap collaboration carets to the existing provider's awareness. Named cursors, colored selections, and ephemeral typing/selection/focus activity extend M0 at the user's request. Names render as text and colors are validated before use in CSS; presence is not persisted.
- The overlay renders and edits the shared document through a local native Yjs relay, at the user's request. Its own CRDT replica shares the main window's network participant identity. Appearance stays local. Capture adapter, installers, signing, and updater remain later milestones.

API references: [Yrs protocol](https://docs.rs/yrs/0.28.0/yrs/sync/trait.Protocol.html), [y-websocket v3 source](https://github.com/yjs/y-websocket/tree/v3.0.0), [Tiptap collaboration](https://tiptap.dev/docs/editor/extensions/functionality/collaboration), and [Tauri configuration](https://v2.tauri.app/reference/config/).

## Embedded hosting (M2)

Tauri's `Hosting` state owns at most one `HostedSession`. Only the main control window may invoke start/stop/status; invitation possession does not grant native administration rights. The overlay continues to relay through the main window and never owns the listener. A Tokio mutex serializes lifecycle operations. Stopping signals both Axum listeners and every WebSocket, awaits server shutdown, and releases the port before another session starts. Closing the desktop process also closes its listeners; document persistence is deferred.

The default is one loopback listener. Explicit trusted-LAN configuration adds a second listener on a selected RFC1918 IPv4 interface, sharing the same CRDT room. Wildcard, public, link-local and IPv6 binds are rejected. The desktop always connects over loopback, allowing its CSP to stay limited to numeric loopback URLs. Host headers must match an actual configured listener; sensitive requests also require an exact allowed Origin.

A build script includes production `apps/web/dist` asset bytes in the Rust library. Tauri dev/build hooks build that frontend first. Cargo watches the asset directory, including hashed files, and start fails with an actionable error if index.html was absent when compiled. Static lookup uses exact embedded paths, never filesystem traversal or a credential bootstrap.

An invitation carries session ID and secret in its fragment. Shared UI reads it once before React Strict Mode mounts, removes the fragment with replaceState, and retains it only in memory. Joining sends credentials in a bounded JSON POST; authenticated WebSockets use the established subprotocol credential. Shared React only consumes typed session targets; native host commands remain under the desktop application.

References: [Axum graceful shutdown](https://docs.rs/axum/0.8.9/axum/serve/struct.WithGracefulShutdown.html) and [Tauri build configuration](https://v2.tauri.app/reference/config/).
