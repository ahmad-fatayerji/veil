> Historical development documentation. Normal desktop networking now uses [automatic signaling and selective relay](automatic-networking.md). Legacy modes are debug regression tools only.

# M2 networking

Desktop P2P is now the primary mode; see [P1 networking](p2p.md). The remainder describes the separately retained **LAN / browser** mode, whose listener restrictions remain unchanged.

Start hosting from the desktop control panel. The default is numeric IPv4 loopback on port 4445. Trusted LAN mode requires a specific RFC1918 IPv4 address belonging to this PC and explicit acknowledgement that HTTP is unencrypted. The host binds that interface and a separate loopback listener on the same port; the desktop editor always uses loopback. Wildcard, public, link-local and IPv6 addresses are rejected. No firewall rules, router settings, tunnel or relay are created.

Use `ipconfig` to find the physical adapter's private address. Allow Veil through Windows Firewall only on private networks if prompted. Open the invitation from another device on that LAN. Guest Wi-Fi isolation, firewall policy, a wrong adapter, VPN routing, or an occupied port may prevent access. Check the browser address and network reachability; do not solve this by forwarding the port to the internet. Ending the session closes all sockets and releases both listeners.

The browser address serves bundled production assets. Credentials are never embedded in those assets. An invitation uses a URL fragment, which is not sent in an HTTP request. The browser reads it once, clears visible history with replaceState, and retains it in memory. Reloading requires reopening or pasting the invitation. Copies of the original invitation remain credentials; share only with trusted participants.

`POST /join` validates the session ID and credential, exact Host/Origin, and a bounded JSON body before returning protocol metadata. `/ws/{sessionId}` additionally requires `veil.v1` and the credential in the requested WebSocket subprotocol. Only `veil.v1` is selected in the response. There is no public bootstrap route. Allowed origins are the configured listener addresses and exact local Tauri/development origins. Other Host headers are rejected even for static assets. `/health` contains no session secrets.

The standalone M0 demo remains exclusively on `127.0.0.1:4444`, with Vite on `127.0.0.1:5173` and desktop Vite on `127.0.0.1:1420`. Its development-only `/bootstrap` and fixed `/ws/m0-demo` room are not mounted in the embedded host.

Internet hosting, TLS, IPv6, port forwarding and CGNAT handling remain M5. Do not expose either M0 or M2 through a public proxy. The private-interface smoke test runs on one PC; a second physical device is still required for the full LAN acceptance criterion.
