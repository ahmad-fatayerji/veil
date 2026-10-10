# Automatic connections and selective relay

The approved P2 flow replaces manual offer/answer and LAN/browser choices in the
normal desktop app. Install Veil on each Windows PC. An operator deploys
[veil-server](https://github.com/ahmad-fatayerji/veil-server), gives the host an HTTPS
address and an individual host credential. Enter these once in Settings > Hosting server.
The credential stays in Windows Credential Manager, scoped to the canonical server
origin; the server address is saved separately. There is no bundled default server.

Create document opens a local editor before any server request. Share attaches to
that same document and uses saved configuration. Missing setup opens Hosting
settings and resumes after saving. Setup/activation failure leaves edits available
for retry. Copy link shares one reusable `veil://join/...` version-4 invitation;
friends open or paste it, enter their name, and explicitly Join session. The Windows
installer registers `veil`, and Tauri deep-link/single-instance integration delivers
links to the running main window. Opening another invitation requires leaving the
current document; content receives confirmation and Cancel preserves it.

Reset link replaces the admission credential; Stop sharing revokes admission.
Existing guests retain their tickets, recovery, and relay renewal. Links last until
sharing stops or the host session ends. A server must advertise `groupSharing: 1`;
otherwise Share explains the upgrade requirement without issuing single-use links.
Pasted legacy `veil-invite:v2:` codes remain supported with their original ten-minute,
single-use semantics. Older `veil-p2p:v1:` codes are incompatible. Forget saved host credential
removes it locally; operators revoke server authorization separately.

## Per-connection state machine

Admission → direct negotiation (STUN only, six seconds) → temporary TURN grant
only on failure → new generation using direct and relay candidates (twenty seconds).
Definitive failure can advance sooner. The authenticated selected ICE candidate pair
determines the displayed path. Issuing credentials does not imply relayed traffic.

The topology remains a star. For six users, the host has five connections; three
friends can remain direct while two relay. The host forwards edits and awareness
from everyone to the two relayed friends. Their links alone consume TURN traffic.
There is no application participant cap; resource ceilings can limit relay availability.

Temporary disconnections wait five seconds before staged recovery, with five bounded
retries and exponential backoff capped at thirty seconds. Document and awareness
identity remain the same. A relay-to-direct migration requires network-change or
Reconnect and observes a five-minute cooldown. The old transport remains until the
replacement authenticates and exchanges state vectors. Failed replacements retain
working relay connections. Credential renewal similarly replaces only an active
measured relay link. Healthy unrelated links are never restarted for fallback.

Signaling outages preserve healthy data channels. New joins/recovery wait for the
server. Restart loses registrations; authorization rejection ends transport and
leaves local content visible for copying. The host must remain open. Leave/End
discards the in-memory document; save anything important before doing so.

## Security and resource boundaries

The public [protocol](https://github.com/ahmad-fatayerji/veil-server/blob/develop/protocol.md)
defines HKDF/AES-GCM key separation, sequence nonces and authenticated envelope
metadata. The server receives the admission credential, never the root invitation
secret. Fingerprints/participant IDs are checked before document traffic. An
operator can observe metadata and deny service but cannot silently replace a peer.
Keep invitations private; holders can edit. No additional permission roles exist.

Reusable admission uses distinct guest tickets and link IDs. Each guest creates an
ephemeral P-256 ECDH exchange key. The host signs a canonical transcript containing
the session/group/link IDs, both Yjs identities, and both exchange keys using the
ECDSA P-256 identity pinned in the link. Guests verify this signature before accepting
host signaling. HKDF-SHA-256 binds the ECDH secret, transcript, and invitation root;
the resulting per-link secret feeds independent directional AES-GCM keys/counters.
The shared invitation root protects bootstrap messages only, never established
guest signaling. Reset/stop do not erase existing authenticated link state. Secrets
stay in memory and are omitted from logs/preferences and masked in test screenshots.

Deploy the compatible server before making the new desktop build available. The
coordinated server implementation is [server PR #3](https://github.com/ahmad-fatayerji/veil-server/pull/3),
commit `0441fb8ea2d8ef48376d232877fd774355110e2c`; desktop network CI pins that source.
The new server retains v2 routes and legacy clients. The old server cannot admit
version-4 group links. No deployment or release is performed by this overhaul.

Native Rust commands alone perform bounded HTTPS/WSS and scoped credential access.
The frontend CSP remains restrictive. Incremental Yjs changes batch for 30 ms;
awareness batches for 100 ms. Transport messages are bounded to 4 MiB and queues
to 8 MiB. Large changes that exceed a limit remain local and report an error; split
large imports. State-vector synchronization recovers missing edits on reconnect.

The conservative relay profile and operator-only metrics are documented in
[server deployment](https://github.com/ahmad-fatayerji/veil-server).
TURN username rotation can temporarily overlap allocations. Expiry is not an
instant allocation kill switch. Coturn quotas remain the hard resource ceiling.

## Agent and test workflow

Follow AGENTS.md: feature branch from origin/develop, Conventional Commit PR into
develop, required CI gate. Server protocol changes need compatible desktop/server
fixtures and independent public CI. Never copy editor source or signing/deployment
secrets into the public server repository. Desktop version/release actions remain
explicit and separate.

```powershell
# Sibling public checkout; build it first.
git clone https://github.com/ahmad-fatayerji/veil-server ../Veil-server
cargo build --manifest-path ../Veil-server/Cargo.toml
pnpm check
pnpm test
# Docker running; actual six-context WebRTC/STUN/TURN.
pnpm test:network
$env:VEIL_TURN_TRANSPORT = 'tcp'
pnpm test:network
Remove-Item Env:VEIL_TURN_TRANSPORT
# After Cargo tests, rebuild the native executable before acceptance.
pnpm --filter @veil/desktop exec -- tauri build --debug --no-bundle
pnpm test:sharing
```

`VEIL_SERVER_SOURCE` can point to another server checkout. CI pins its exact server
commit. Test fixtures allow loopback TURN peers and plaintext loopback signaling;
these settings must never be used in deployment. Debug-only `VEIL_TEST_LEGACY=1`
retains the previous manual/LAN UI for existing native regressions. Release builds
ignore that variable. Normal Create is local; Share/Join use automatic networking.

For installed URL acceptance without replacing an existing Veil installation,
build a temporary debug NSIS bundle with a config override setting productName
`Veil UX acceptance`, identifier `dev.veil.uxacceptance`, and
`bundle.createUpdaterArtifacts: false`. Run `node scripts/test-deep-links.mjs <installer>`.
It refuses an existing `veil` registration, installs into a temporary directory,
checks cold/warm Windows URL activation and document protection, then uninstalls.
`VEIL_TEST_SINGLE_INSTANCE=1` enables single-instance behavior in isolated debug
profiles; ordinary multi-instance acceptance disables it only in debug builds.
Rebuild the normal native executable after the config-override build.

Real internet acceptance still requires separate Windows PCs on unrelated networks,
valid HTTPS, direct ICE, TURN UDP/TCP and optional TURN TLS. Record selected paths,
allocation counts/bytes, CPU/memory and convergence under realistic editing/presence.
Check restricted networks, exhaustion, slow consumers, disconnect/recovery, restart
and cleanup. Same-PC browser/native tests do not prove these deployment conditions.
