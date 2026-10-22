# Test Veil on Windows

Requires Windows 10/11, 64-bit x64. Download the setup EXE from [Veil Releases](https://github.com/ahmad-fatayerji/veil/releases/latest), run it, then open Veil from Start. No Node, Rust, terminal or separate server is needed. Installation is per user. If WebView2 is missing, setup downloads Microsoft's runtime, which needs internet access.

This is an experimental build. The installer does not have a Windows publisher certificate, so Windows may show an unknown-publisher/SmartScreen warning. Verify that the file came from the release page; don't disable security software. The `.sig` file is an updater signature, not a Windows publisher certificate.

## Connect with a friend

For builds with automatic networking, both people install the same version. The existing stable 0.2.0 installer still uses the older manual flow until a new release is explicitly published.

1. Choose **Create document** and start writing, including offline. Your name is optional until joining someone else.
2. The server operator gives the host an HTTPS address and individual host access credential. Choose **Share**, pick **My own server** and enter them before creating the invite link, or save them under **Settings > Sharing > Hosting server**. Reusable sharing requires a compatible server advertising `groupSharing: 1`.
3. Choose **Share > Copy link** and send the same link to friends. They open or paste it, enter their name, and choose **Join session**. No guest server configuration or account is needed. Opening a link never joins automatically or silently replaces another document.
4. Confirm **Connected**, then open **People** for measured **Direct** or **Relayed** paths. Type in both editors and through **Show overlay**. Technical information and manual Reconnect are in Connection details.
5. **Reset link** invalidates the old link; **Stop sharing** prevents new admissions. Existing people stay connected. Links last until sharing stops or the host session ends. Never include them in public reports. Legacy single-use invitations remain supported when pasted into Join.

Every connection tries direct/STUN first, then independently uses the operator's TURN relay if needed. No default relay provider or universal connectivity guarantee is included. The host must remain open. See the operator's [deployment instructions](https://github.com/ahmad-fatayerji/veil-server).

## Updates and known limits

Open **Settings > About & updates** and click **Check for updates**. Checks contact GitHub only when requested. If an update is available, first copy any text you want to keep and close/leave the document. Choose **Install update and restart**. The package signature is verified and local overlay settings are saved. Updates cannot install during an open local or shared document. You can also download and run the next installer manually.

Documents are temporary: ending/leaving/closing loses the local document, with confirmation when it contains content. There are no read-only roles or universal capture-exclusion guarantees. The coordinating host must remain open. Automatic recovery retains unsent edits while the same document stays open; signaling outages do not disconnect healthy peers. Server restart loses session registrations. Updates do not add persistence. Appearance, overlay preferences, capture compatibility controls, and About are in Settings.

## Useful test report

Send the app version shown under **Settings > About & updates**, both Windows versions, whether PCs are on the same or different networks, whether a VPN is active, the displayed direct/relay path, the exact error, and steps to reproduce. Test offline creation, sharing existing edits, simultaneous joins/edits, reset/stop, reconnect, leaving, overlays, both themes, URL activation, and restart preferences. Redact invitations, response codes, credentials and private document text from screenshots.

## Short links and approval

Copy link now produces `veil://join/<server>/<22-character-code>`. New sharing
requires a server advertising short-link support; guests need an updated Veil.
Existing long links remain accepted. In Share document, choose Auto join or
Require approval. Approve or Reject waiting guests under People. Names are supplied
by guests, not verified identities. Guests can cancel; requests expire after two
minutes. Changing mode keeps the link and existing pending decisions. Reset/Stop
cancel pending requests while connected guests continue editing.

Test both join modes, a rejected request followed by a fresh retry, cancellation,
two-minute expiry, mode changes while someone waits, and Reset/Stop with both a
waiting and connected guest. Confirm waiting guests have no shared editor and
cannot receive document updates. Check Windows link activation and pasted links,
old long links, unsupported servers, and retry after an outage. Redact all codes.
