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
for retry. Copy link shares one reusable `veil://join/<server>/<code>` invitation with a
22-character random code;
friends open or paste it, enter their name, and explicitly Join session. The Windows
installer registers `veil`, and Tauri deep-link/single-instance integration delivers
links to the running main window. Opening another invitation requires leaving the
current document; content receives confirmation and Cancel preserves it.

Reset link replaces the admission credential; Stop sharing revokes admission.
Existing guests retain their tickets, recovery, and relay renewal. Links last until
sharing stops or the host session ends. A server must advertise `groupSharing: 1` and `shortInvitations: 1`;
otherwise Share explains the upgrade requirement without issuing single-use links.
Pasted legacy `veil-invite:v2:` codes remain supported with their original ten-minute,
single-use semantics. Older `veil-p2p:v1:` codes are incompatible. Forget saved host credential
removes it locally; operators revoke server authorization separately.

Saving a new or replacement host credential automatically tests it before either
the credential or server address is saved. A failed check keeps the entered values
available for correction and leaves existing saved settings intact. Saving with an
empty field requires a credential already stored for that exact origin; it reuses
that credential without requiring another online test.

Hosting server settings also include **Test connection**. It checks the entered server
and credential before saving; an empty credential field uses the credential already
stored for that exact server origin. Changing either field clears the previous result.
The native test checks reusable-sharing support, creates a temporary authenticated
registration, and immediately deletes it. It does not save settings, publish an
invitation, open signaling, request TURN, or disturb an active document. Tests count
against the server's session-creation rate limit. Connection/certificate errors,
rejected credentials, unavailable capacity, and failed cleanup are reported in Settings.
Success confirms server authentication; peer and relay connectivity still require a
shared-session test. If a response is lost, server expiry cleans up any registration
that the client could not identify or delete.

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

Unused invitations do not negotiate or request TURN credentials. When a guest leaves,
its link is removed before transports close; pending setup results, queued signals,
callbacks and retry/renewal timers cannot restart that link. After the last guest
leaves, the host reports that it is waiting for someone to join. Recovery remains
available for admitted guests during temporary connection loss.

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

Deploy the compatible server before making the new desktop build available. Reusable sharing was introduced by [server PR #3](https://github.com/ahmad-fatayerji/veil-server/pull/3).
The coordinated compatibility extension is [server PR #4](https://github.com/ahmad-fatayerji/veil-server/pull/4),
commit `2aa361f15e3581356a5b6185f2072ba0541b1cd3`; desktop network CI pins that source.
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

## Compatibility before joining

Release-maintained app metadata declares `appVersion`, `serverProtocols` and
`peerProtocols`; current implementations support API generation 2 and peer
generation 1. Server capabilities advertise `compatibility: 1`, `serverVersion`
and `serverProtocols`. Package versions are descriptive; mutually implemented
protocol generations determine whether admission is supported.

After capability discovery, new clients send optional `compatibility` metadata
on session creation and either join endpoint. Older servers receive the existing
request shapes. An admission-credential-protected POST `/v3/compatibility` accepts
`sessionId`, `admission`, `compatibility` and exactly one of `groupId`/`inviteId`.
It previews `hostClientId`, nullable `hostCompatibility`, `serverVersion`,
`serverProtocol` and `peerProtocol` without issuing a ticket or consuming an invite.
Admission rechecks support and link validity under the same server lock.
Unsupported client/server, host/server and peer combinations return HTTP 409 with
`CLIENT_PROTOCOL_UNSUPPORTED`, `HOST_PROTOCOL_UNSUPPORTED` or
`PEER_PROTOCOL_UNSUPPORTED`; these failures cannot be bypassed.

Matching verified host/guest app versions proceed normally. Different supported
versions require **Join anyway** or **Cancel**, warning that some features may not
work properly. Missing server/host metadata requires confirmation that compatibility
could not be verified. Compatibility warnings remain separate from connection
notices. Cancelling before admission creates no ticket; cancelling after host
authentication revokes the provisional guest admission before closing transports.

Reusable-link bootstrap additionally carries `hostCompatibility` and
`compatibilitySignature`. The signature is ECDSA P-256/SHA-256 over UTF-8 JSON
`["veil.compatibility.v1", canonicalHandshake, canonicalHostCompatibility]`.
The metadata property order is `appVersion`, `serverProtocols`, `peerProtocols`;
array order is preserved. The original v1 handshake signature and ECDH transcript
remain unchanged. Guests verify against the host identity pinned in the link before
sending final signaling. Changed signed metadata requires renewed confirmation;
invalid signatures or omitted previously advertised metadata stop admission.
Legacy manual invitations retain their existing authentication limits and cannot
provide a pinned host compatibility signature.

Every networking change must assess server impact and update compatibility support,
protocol documentation and coordinated app/server regression coverage as needed.
Never declare unsupported generations or infer compatibility from equal versions.

## Short links and guest approval

The server address remains readable; the 22-character unpadded Base64url code
contains 128 random bits. It is a secret: share privately and redact the entire
link from reports. Opening or pasting only validates the link locally. Lookup and
local decryption happen after the guest presses Join. HTTPS validation remains
required; encoded HTTP loopback origins are available only in development.

Hosts select **Auto join** (the default for each new session) or **Require approval**
in Share document. Approval requests appear under People, showing the name supplied
by the guest plus Approve and Reject. Names do not verify identity. The guest can
cancel and requests expire after two minutes. Pending tickets cannot request relay
credentials or exchange established signaling. The host withholds its signed key
exchange and document transport until it approves.

Changing mode keeps the same link and affects new requests. Existing waiting
requests still require a decision, and connected collaborators remain connected.
Reset link and Stop sharing cancel pending requests, without disconnecting existing
collaborators. Reset retains the session's chosen join mode. A rejected registration
preserves the prior link; a lost response after server commit can leave registration
state uncertain, so retry Reset link if its outcome is unknown.

The app derives separate lookup-reference, lookup-credential and encryption outputs
from the code. Only the lookup credential, its hash, and an encrypted invitation
record reach the server; neither the code nor invitation root secret does. AES-GCM
binds the encrypted invitation to its canonical server origin and derived reference.
The decrypted invitation retains its pinned host signing key. Waiting/rejection
statuses are encrypted and separately host-signed, binding the guest's admission
and exchange key. The existing signed handshake and per-link encryption remain.

New sharing requires a supporting server and updated guests; there is no long-link
fallback. Existing version-4 long links and legacy single-use invitations are still
accepted. Upgrade the server before distributing this client. Source PRs do not
authorize deployment or release publication.

Coordinated short-link server support: [server PR #5](https://github.com/ahmad-fatayerji/veil-server/pull/5).
