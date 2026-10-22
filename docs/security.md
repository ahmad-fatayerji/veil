# Security and privacy

Veil uses authenticated, encrypted peer connections for collaborative documents
and signed packages for app updates. These protections have defined boundaries;
Veil has not undergone an independent security audit. Local automated tests and
recorded native acceptance do not establish security against every attacker or
connectivity on every network.

## Documents and participants

Document editing and session secrets stay in memory. Participants can manually
save the shared title and body to UTF-8 Markdown files on their own devices;
file paths, save state, credentials, and invitation links are not shared or written
into these files. Optional workspace recovery is off by default. Enabling it
stores document snapshots, local file paths, tab order, and the selected tab in
`workspace.json` under Veil's local app data. This is a content snapshot, without
collaboration credentials, participant awareness, or reconnectable session state.

Saved Markdown and recovery drafts are not encrypted by Veil. Closing to the tray
keeps documents and sessions running. Closing an unsaved tab or quitting asks to
save or discard; discard removes its recovery snapshot. After a normal quit,
restoration reopens saved files from disk; after an unexpected exit, recovery can
also restore unsaved content. Disabling recovery removes stored snapshots without
closing current documents. Damaged recovery files are backed up before replacement
so manual recovery remains possible. Deleting or discarding is not a secure-erasure
guarantee: operating-system paging, crash dumps, backups, endpoint malware, or a
participant copying content can retain information. Preferences and host credentials
are stored separately.

Anyone holding a reusable `veil://join/...` link can join and edit while sharing
is active. There are no viewer roles, per-user permission controls, or verified
real-world identities. Display names and activity are self-reported. Share links
through a trusted channel and treat them as secrets.

**Reset link** replaces the admission credential. **Stop sharing** prevents new
admissions. Neither removes guests already admitted: their authenticated tickets,
recovery, and relay renewal remain valid until the session ends. End the session
to disconnect everyone. The host must stay available; there is no host migration
or automatic reconnection after quitting. Restored documents start locally.

## Discord Rich Presence

Discord Rich Presence is enabled by default in the Windows desktop app. When
Discord is running and activity sharing is allowed in Discord, Veil shares the
current document title (labeled "Document: ...") and how many other participants are connected. Solo
documents show a solo editing message; without a document it shows "No document
open". Pending join requests are excluded from the count.

In **Settings > Sharing > Discord**, turn off **Show document title** to use "Editing a
document" instead, or turn off **Show participant count** to omit that information.
Turn off **Discord Rich Presence** to clear Veil's activity and stop connecting
to Discord. All three settings default to on and are remembered on this device;
the individual privacy choices are retained when Rich Presence is disabled.
If saved preferences cannot be read, presence stays paused until a setting is
saved. If saving fails, changes still apply for the current run and Settings
shows a warning that they may not survive a restart.

Only the title and aggregate count are shared through local Discord IPC. Veil
does not include document contents, participant names, credentials, or invitation
links. Activity data stays in Veil's memory, but sharing it with Discord is subject
to Discord's own visibility and data handling. Presence continues while Veil is
in the tray and is cleared when Veil quits. Discord absence or restart does not
interrupt editing. Browser and legacy development tools do not publish presence.

## Encrypted peer connections and signaling

Document and awareness traffic travel over WebRTC data channels protected by
DTLS. The host forwards collaboration updates to guests in a star topology; the
host and every admitted participant can read the shared document. TURN relays
encrypted transport traffic when a direct connection is unavailable.

Reusable links pin the host's ECDSA P-256 public identity. Each guest link performs
an ephemeral P-256 ECDH exchange. The host signs a canonical transcript binding
the session, group, link, both collaboration identities, and both exchange keys;
guests verify it against the invited host. HKDF-SHA-256 derives per-link secrets
and independent directional AES-GCM signaling keys. Authenticated envelopes bind
role, generation, and sequence, and receivers reject replay. Peer identities and
DTLS fingerprints are checked before collaboration traffic is accepted.

The invitation root protects bootstrap messages; established guest links have
separate keys. The server receives an admission credential and encrypted signaling,
not the root invitation secret or document contents. A server operator can observe
connection metadata, deny service, or interrupt admission. These protocol checks
do not protect a compromised desktop, malicious authorized participant, or an
invitation delivered through an untrusted channel.

See [automatic networking](automatic-networking.md) and the public
[sharing protocol](https://github.com/ahmad-fatayerji/veil-server/blob/develop/protocol.md)
for the handshake, transport limits, and recovery behavior. Legacy invitation
formats keep their original expiry and single-use behavior; they do not define
the current reusable-link flow.

## Host credentials and server operation

Production configuration requires an HTTPS server origin. Native Rust commands
perform bounded HTTPS/WSS operations and validate certificates. Host credentials
are stored in Windows Credential Manager, scoped to that origin; saved credentials
are not returned to frontend JavaScript. Native administration belongs to the
control panel, and frontend CSP does not allow arbitrary remote WebSockets.

Operators issue and revoke host authorization. Forgetting a saved credential only
removes the local copy; server revocation is a separate operator action. The server
persists credential hashes and configuration, but not collaborative documents.
Authenticated TURN credentials, destination exclusions, quotas, and rate limits
bound relay usage. Metrics require separate operator access. Operators must secure
their server, TLS configuration, relay, logs, and credentials; see
[veil-server](https://github.com/ahmad-fatayerji/veil-server).

Transport queues and message sizes are bounded, and names/colors are sanitized for
rendering. These safeguards do not provide a complete malicious-collaborator or
whole-document resource policy. There is no application-level participant cap;
actual capacity depends on device, network, and relay resources.

## Overlay capture exclusion

The overlay can remain visible locally while compatible Windows capture methods
record the content beneath it. Exclusion is enabled by default and can be changed
in Overlay settings. It affects only the overlay, not the control panel.

Capture exclusion is a best-effort display feature, not encryption, access control,
or protection against a camera, malicious software, or an incompatible recorder.
A successful Windows API call does not prove exclusion in a particular recording.
Check saved output or a remote viewer's screen with the built-in test. See the
[verified capture modes and limitations](capture-compatibility.md).

## Installer and updater trust

Download installers from the [official releases](https://github.com/ahmad-fatayerji/veil/releases).
The updater verifies package signatures against the embedded public key and checks
the candidate version before installation. Stable and beta channels use the
repository's published metadata. Installation is blocked while a document session
or embedded host is active; it does not save or recover documents across updates.

Updater signing keys remain restricted to publication jobs; fork PR validation
receives no signing secrets. Published versioned assets are immutable. These
signatures protect update authenticity, not Windows SmartScreen reputation: the
installer currently has no Authenticode publisher certificate.

## Legacy development boundaries

The retained LAN/browser and manual signaling modes are debug regression tools,
not the normal desktop experience. The standalone demo binds to loopback. Explicit
trusted-LAN hosting uses plaintext HTTP and must not be exposed through a public
proxy or forwarded port. Its invitation checks and Origin restrictions do not
make that plaintext mode safe for untrusted networks.

## Report a security issue

For a suspected vulnerability, use GitHub's
[private vulnerability reporting](https://github.com/ahmad-fatayerji/veil/security/advisories/new). Include the
Veil version, affected component, impact, and reproducible steps with fictional
content. Do not publish live invitation links, credentials, private documents, or
signing material in a public issue. Ordinary non-sensitive bugs can use
[GitHub issues](https://github.com/ahmad-fatayerji/veil/issues).

## Short invitation links

A short link contains a 128-bit random secret. HKDF domain separation derives an
opaque lookup reference, a lookup credential and an AES-GCM encryption key. The
server receives the reference, lookup credential/hash and ciphertext, never the
link code or invitation root. A server operator cannot replace the host key in the
encrypted invitation without authentication failure. Keep full links private.

Host approval gates signed key exchange and document transport locally, even if a
server fabricates admission metadata. Waiting/rejection status is encrypted and
host-signed. Guest names are unverified labels. Pending requests expire after two
minutes and have bounded queue resources; this is not a connected-participant cap.
Reset and Stop sharing cancel pending requests but do not revoke existing guests'
access to document content. No independent security audit is claimed.
