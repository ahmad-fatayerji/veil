> Historical development documentation. Normal desktop networking now uses [automatic signaling and selective relay](automatic-networking.md). Legacy modes are debug regression tools only.

# Desktop peer connections (P1)

The default desktop mode uses WebRTC data channels, not the embedded HTTP service. All participants install the desktop application. One peer coordinates the document and forwards changes to its connected friends; this is a star, not a mesh. The host must stay running. Yjs state-vector synchronization, live incremental updates and awareness use the same editor and native overlay bridge as LAN mode. Participant count defaults to no application-level cap.

## Connection exchange

Host starts a session and generates a `veil-p2p:v1:` invitation. Friend pastes it and generates a response. Host pastes the response and clicks **Connect friend**. These are encoded connection descriptions, not navigable URLs. Each binds the session, unique connection, random 256-bit invitation credential, participant ID, expiry, ICE candidates and DTLS certificate fingerprint. Share through a trusted private channel. Codes are not logged or saved by Veil; copied messages remain credentials. Invitations expire after ten minutes, are single-use, and a new pending invitation replaces an unused one. Generate separate invitations for additional friends.

The reliable ordered data channel uses WebRTC DTLS encryption. A session-bound hello validates the credential and expected participant ID before accepting document or awareness packets. The coordinator rejects duplicate participant identities and awareness updates claiming other users. Everyone admitted can edit; names are self-reported and do not authenticate a real person. Participant removal, read-only roles and host migration are deferred.

Veil limits logical messages to 4 MiB, fragments them into 16 KiB data-channel frames, bounds each peer's outgoing queue to 8 MiB, and disconnects slow, incomplete or malformed streams. A 600-frame/second guard applies per peer. These are transport safeguards, not a whole-document quota or comprehensive protection against malicious collaborators. Documents remain in memory. Ending/leaving discards the local replica. A guest can answer a fresh invitation from the same host session without leaving, retaining unsent edits for state-vector merging. Automatic signaling/reconnection is deferred.

## Internet reachability and your server

By default `iceServers` is empty: no mandatory discovery/relay provider, account or domain. Same-network peers can use local candidates. Public IPv6 or suitable public addresses can also permit direct connectivity, subject to router/firewall rules. An exchange of private addresses alone usually cannot connect two unrelated NAT networks.

Under **Network options**, before starting/joining, each participant may explicitly configure:

- **STUN:** `stun:203.0.113.10:3478` (illustrative documentation address). Discovers the public address mapping; document traffic stays peer-to-peer if a direct path works.
- **TURN:** `turn:203.0.113.10:3478`, with relay username and credential. Supplies a relay candidate when a direct path fails. Traffic is still DTLS-encrypted between peers, but the relay sees metadata and carries bandwidth.

Use your actual internet-reachable server IP instead of the example. A self-hosted implementation such as [coturn](https://github.com/coturn/coturn) can provide both functions. Configure authenticated TURN, a limited relay port range, firewall access for its listeners and relay allocation ports, and ongoing credential/bandwidth management. Do not enable an anonymous public relay. No TURN deployment is performed by this milestone, and Veil does not open router/firewall ports. A server behind CGNAT has the same reachability problem unless its network supplies inbound access. TLS TURN can require additional certificate configuration; plain TURN on a numeric IP does not require buying a domain, while document payloads remain protected by WebRTC DTLS.

Settings and credentials stay in memory and are not inserted into the invitation. Each participant configures their own network options. The selected candidate pair is inspected to show **Encrypted direct connection**, **Encrypted relay**, or an explicit unknown/checking path. Empty settings cannot guarantee internet connectivity. TURN cannot bypass every organization's network policy either.

The existing **LAN / browser** mode remains a separate option. Never publicly expose its plaintext HTTP listener. P1 does not provide internet browser joining or a hosted signaling service.

## Verification boundary

`pnpm test:peer` launches three real Windows desktop/WebView2 instances with isolated settings/profiles and no network servers. It exchanges real offer/answer codes, checks actual selected direct candidates, document synchronization and fanout, awareness cleanup and shutdown. Local overlay acceptance remains a separate script. Test two Windows PCs on unrelated networks before claiming internet acceptance. Also test a configured authenticated TURN server and confirm the selected path reads **Encrypted relay**. Neither an actual different-network connection nor self-hosted TURN is established by the local test.

Protocol references: [WebRTC peer connections](https://webrtc.org/getting-started/peer-connections), [data channels](https://webrtc.org/getting-started/data-channels), and [TURN](https://webrtc.org/getting-started/turn-server).
