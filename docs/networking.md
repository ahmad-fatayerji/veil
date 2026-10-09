# M0 networking

The spike listens exclusively on IPv4 loopback `127.0.0.1:4444`; there is no bind-address option. Browser Vite uses `127.0.0.1:5173`, desktop Vite `127.0.0.1:1420`. The host accepts only these exact development origins and Tauri's local application origins; Host must be `127.0.0.1:4444`. Use numeric URLs rather than localhost aliases.

`GET /health` is nonsensitive readiness. `GET /bootstrap` requires a trusted origin and Host, returns a process-local random credential without caching, and declares protocol version 1 and participant limit null. The WebSocket route `/ws/m0-demo` requires that credential in a requested subprotocol header before upgrading. The server selects only `veil.v1`, never echoes the credential subprotocol, and never puts it into a URL.

The fixed development host does not serve browser production assets yet. Vite is a development dependency; M2 will bundle and serve browser assets through the embedded desktop server.

LAN access, firewall changes, port forwarding, IPv6, TLS, and CGNAT handling are deferred. No cloud relay is used. Do not forward these development ports or place the bootstrap behind a public proxy.
