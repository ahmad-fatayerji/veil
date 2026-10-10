# Test Veil on Windows

Requires Windows 10/11, 64-bit x64. Download the setup EXE from [Veil Releases](https://github.com/ahmad-fatayerji/veil/releases/latest), run it, then open Veil from Start. No Node, Rust, terminal or separate server is needed. Installation is per user. If WebView2 is missing, setup downloads Microsoft's runtime, which needs internet access.

This is an experimental build. The installer does not have a Windows publisher certificate, so Windows may show an unknown-publisher/SmartScreen warning. Verify that the file came from the release page; don't disable security software. The `.sig` file is an updater signature, not a Windows publisher certificate.

## Connect with a friend

For builds with automatic networking, both people install the same version. The existing stable 0.2.0 installer still uses the older manual flow until a new release is explicitly published.

1. The server operator gives the host an HTTPS address and individual host access credential. Enter these once under **Hosting server**.
2. Host enters their name and clicks **Create session**, then **Create invitation** and **Copy invitation**.
3. Friend enters their name, pastes the invitation and clicks **Join**. They need no server configuration or account.
4. Confirm **Connected** and **Direct** or **Relayed**. Type in both editors and through **Show overlay**.
5. Create a separate invitation for each friend. Invitations are single-use and expire in ten minutes; never include them in public reports.

Every connection tries direct/STUN first, then independently uses the operator's TURN relay if needed. No default relay provider or universal connectivity guarantee is included. The host must remain open. See the operator's [deployment instructions](https://github.com/ahmad-fatayerji/veil-server).

## Updates and known limits

Open **App updates** and click **Check for updates**. Checks contact GitHub only when requested. If an update is available, first copy any text you want to keep and end/leave the session. Choose **Install update and restart**. The package signature is verified and local overlay settings are saved. Updates cannot install during an open session. You can also download and run the next installer manually.

Documents are temporary: ending/leaving/closing loses the local document. There are no read-only roles or capture-exclusion guarantees. The coordinating host must remain open. Reconnecting requires a fresh invitation/response exchange; keep the guest session open to retain unsent edits. Updates do not add persistence.

## Useful test report

Send the app version shown under **App updates**, both Windows versions, whether PCs are on the same or different networks, whether a VPN is active, configured STUN/TURN type (omit credentials), the displayed direct/relay path, the exact error, and steps to reproduce. Test bidirectional typing, simultaneous edits, pause/reconnect, third-person joining, leaving, overlays and restart preferences. Redact invitations, response codes, credentials and private document text from screenshots.
