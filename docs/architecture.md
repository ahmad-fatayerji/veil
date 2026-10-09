# M0/M1 architecture

React + TypeScript + Vite frontends in both applications consume the same Tiptap editor, shared UI, typed application protocol, and Yjs connection factory. pnpm resolves a single Yjs 13 instance; Vite explicitly deduplicates it and React. Tiptap uses one named `document` XML fragment and its collaboration undo implementation; StarterKit's ordinary undo/redo is disabled. Documents begin empty so simultaneous first joins cannot duplicate seeded content.

## Rust sync decision

Use **Yrs 0.28.0 `DefaultProtocol`**, its `Awareness`, and standard binary y-sync framing with **Yjs 13 + y-websocket 3.0**. Rust 1.99 is pinned to support the current Yrs release; the preinstalled Rust 1.92 cannot compile its match guards. We also pin y-websocket 3.0 for the stable Yjs 13 editor ecosystem. Updates are applied to a real Rust CRDT replica, rather than JSON text replacements or an opaque relay. This supplies late join and reconnect state vectors without a host-side JavaScript runtime.

The local spike is an independent Rust crate under `packages/host`. Embedding it into the Tauri lifecycle belongs to M2. Native networking and overlay management remain separate; shared React does not invoke Windows APIs. The M1 native implementation and capability contract live under `apps/desktop/src-tauri/src/overlay`; [overlay notes](overlay.md) describe window controls, settings, and verification.

The server initiates state-vector sync and sends current awareness in separate WebSocket frames: y-websocket 3 processes one protocol message per frame. Client sync-step-1 receives missing state; server sync-step-1 receives missing client state. Applied update and awareness messages fan out through a bounded broadcast channel. Subscription occurs before initial state construction. No network I/O runs while holding the room mutex. Lagged subscribers and stalled sends disconnect and must resync, rather than silently losing updates. Each connection claims its local awareness ID, so forwarded remote awareness cannot transfer ownership. Cleanup emits tombstones without advancing remote clocks, and reconnect advances the local awareness clock, avoiding suppressed presence after rejoining.

The interoperability acceptance test runs two independent browser contexts, disables BroadcastChannel, concurrently edits one paragraph, independently deletes/inserts on disconnected replicas, reconnects, compares rendered documents, and checks a late arrival and awareness cleanup. This is the gate before expanding the editor abstraction.

## Tradeoffs and deferred work

- Single fixed M0 room, one in-memory document, no session management or recovery. Host restart with no surviving client loses state; durable snapshots are M3.
- Loopback credential bootstrap is development admission only, not a real guest invitation system. Host roles, approval, revocation and LAN joining come later.
- 256 KiB frames, 128 queued broadcasts per subscriber, a five-second send timeout, and a simple 200-frame/second guard bound some spike resources. They are not participant caps or production abuse controls. Document size, independent edit/awareness/auth limits, expiry and resource telemetry need later work.
- The shared editor binds Tiptap collaboration carets to the existing provider's awareness. Named cursors, colored selections, and ephemeral typing/selection/focus activity extend M0 at the user's request. Names render as text and colors are validated before use in CSS; presence is not persisted.
- M1 uses a separate lightweight preview window. Shared-document rendering there is M3; capture adapter, installers, signing, and updater remain later milestones.

API references: [Yrs protocol](https://docs.rs/yrs/0.28.0/yrs/sync/trait.Protocol.html), [y-websocket v3 source](https://github.com/yjs/y-websocket/tree/v3.0.0), [Tiptap collaboration](https://tiptap.dev/docs/editor/extensions/functionality/collaboration), and [Tauri configuration](https://v2.tauri.app/reference/config/).
