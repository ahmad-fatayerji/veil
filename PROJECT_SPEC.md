# Veil project specification

This specification describes the current product and its engineering boundaries.
The former numbered milestone roadmap is retired. It does not promise future
features or authorize a release; work follows the user's requested scope and the
repository workflow in [AGENTS.md](AGENTS.md).

## Product

Veil is a Windows 10/11 x64 app for temporary collaborative documents and a
movable, resizable desktop overlay. The overlay can stay visible locally while
compatible recording and screen-sharing methods capture the content underneath.
Capture exclusion is best effort and never universal.

Users can create a local document immediately, without a server. Sharing attaches
networking to that same document. A host configures an HTTPS Veil server and an
operator-issued host credential in Settings, then sends a reusable session link.
Guests install Veil, open or paste the link, enter a name, and explicitly join.
Missing hosting configuration opens Settings and resumes sharing after a successful
save; failure preserves the editable local document.

Documents are temporary and remain in memory. Quitting or ending a session loses
that document; copy important content first. There are no cloud accounts, durable
document storage, viewer roles, permission management, or host migration. There is
no application-level participant cap; hardware and transport resources still limit
capacity. Do not add participant caps or application API changes without a request.

## Collaboration and networking

React, TypeScript, Tiptap, and Yjs provide shared editing, named cursors, selections,
and ephemeral typing/selection/focus activity. Use CRDT updates and state-vector
synchronization rather than replacing whole documents on every keystroke. Avoid
seeded content that duplicates during concurrent initial joins. Display names do
not prove identity.

The host coordinates a WebRTC star, forwarding document and awareness updates.
Each host-guest link tries direct/STUN negotiation before requesting temporary
TURN credentials if needed. Display actual selected ICE path statistics, rather
than treating issued relay credentials as proof of relay traffic. Bound messages,
queues, retries, and renewal; preserve healthy unrelated links during recovery.
The host must remain open. Healthy peer transports can survive a signaling outage,
but new admission and recovery depend on the sharing server.

Reusable `veil://join/...` links pin the host identity and admit separate guest
tickets. Reset link and Stop sharing revoke new admission, while already admitted
guests retain their authenticated links until the session ends. Compatible servers
advertise reusable-sharing support; do not silently substitute a legacy invitation.
Release-maintained server API and peer protocol generations determine admission.
Before joining, compatible host/guest app-version differences or missing legacy
compatibility information require confirmation. Unsupported protocols block joining.
Reusable links authenticate host compatibility metadata before document exchange.
Retained legacy formats and LAN/browser tools are regression infrastructure, not
the primary user journey. See [automatic networking](docs/automatic-networking.md).

## Security boundaries

Use authenticated host-signed P-256 key exchange, per-link HKDF/AES-GCM signaling,
replay protection, and verified peer identities/DTLS fingerprints. Document traffic
uses WebRTC DTLS. The sharing server receives admission credentials and encrypted
signaling, not document contents or invitation root secrets. Authorized participants
and the host can read, copy, and record the shared document.

Production server configuration requires HTTPS and certificate validation. Scoped
native commands manage credentials and server operations; saved host credentials
stay in Windows Credential Manager and are never returned to frontend JavaScript.
Keep frontend CSP restrictive, sanitize rendering, and bound transport resources.
Never log secrets, decrypted signaling, or document contents. Do not expose the
loopback development service publicly or claim an independent security audit.
See [security and privacy](docs/security.md) for limits and reporting guidance.

## Desktop overlay and local preferences

Keep Windows native code isolated from shared React packages. The control panel
and overlay are separate Tauri windows editing the same document. The overlay has
minimal chrome, no formatting toolbar, named remote cursors and selections matching
the regular document view, and a compact participant activity strip. Appearance
and physical bounds are device-local, validated, and saved separately from the
document.

Support opacity, font size, always on top, movement, resizing, hide/show, and
click-through. Click-through requires a registered recovery shortcut. Ctrl+Alt+V
restores interaction and the control panel; Ctrl+Alt+Shift+V toggles overlay visibility.
Tray controls offer recovery as well. Closing the main window moves to the tray by
default; the configurable quit behavior must remain explicit because documents
are temporary.

Capture exclusion is enabled by default for supported Windows versions. Native
status and actual capture results are different: verify saved recordings or remote
output and document tool/mode-specific results. Never claim universal invisibility
or protection of the control panel. Unsupported platforms report capabilities
honestly. See [overlay behavior](docs/overlay.md) and
[capture compatibility](docs/capture-compatibility.md).

## Repository and releases

Public `ahmad-fatayerji/veil` contains MIT source, installers, and update metadata.
Retain copyright and third-party notices, audited history, existing release tags,
published assets, download URLs, updater endpoints, and signing identity. The
migration is complete; all development and release work uses this repository.
Never publish unaudited private material or signing credentials.

`develop` is the default branch for ordinary work; `main` holds approved release
source. Every AI task uses its own worktree as a direct sibling of the original
`Veil` checkout inside `Veil-app`, following the location rule in [AGENTS.md](AGENTS.md)
and the Gitflow PR checks and merge routes. Feature merges do not authorize a
release. Release actions use Prepare release, Publish beta, Finalize release, and Back-merge main only when
requested. Do not manually bump versions, reuse published versions, overwrite
published assets, or bypass branch protections. See [releasing](docs/releasing.md).

Windows installation is per user. Veil checks its selected update channel quietly
at startup and every six hours while running, including in the tray. An available
update or incomplete installation shows a persistent attention badge on Settings;
viewing Updates does not clear it. Download and installation remain explicit.
Updates use signed packages and reject invalid
signatures; installation is blocked while a document session or embedded host is
active. Preferences are distinct from temporary documents. Updater signatures do
not imply Authenticode signing or remove SmartScreen warnings. Restrict signing
secrets to publication jobs; fork PRs receive none.

## Validation

For ordinary bug and feature tasks, the user performs testing: agents skip local
test suites and `pnpm check` unless validation is explicitly requested, and do not
wait for CI before handoff. Required CI gates still apply before merging. Report
skipped checks honestly. When validation is requested, run checks appropriate to
the task: formatting for documentation, `pnpm check`
and relevant unit/integration tests for code, and `pnpm test:release` for release
tooling. Rebuild the native debug executable after Cargo tests before native
acceptance scripts. Test real Windows overlay/capture/installer behavior where
needed and report the exact environment and observed output.

Preserve historical verification records in [testing](docs/testing.md). Separate
local native acceptance, actual unrelated-network/relay checks, clean-machine
installation, and an independent security audit. Do not fabricate any of them.
The user has requested using this machine rather than a Windows VM.
