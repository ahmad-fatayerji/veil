# Test Veil on Windows

Requires Windows 10/11, 64-bit x64. Download the setup EXE from [Veil Releases](https://github.com/ahmad-fatayerji/veil/releases/latest), run it, then open Veil from Start. No Node, Rust, terminal or separate server is needed. Installation is per user. If WebView2 is missing, setup downloads Microsoft's runtime, which needs internet access.

This is an experimental build. The installer does not have a Windows publisher certificate, so Windows may show an unknown-publisher/SmartScreen warning. Verify that the file came from the release page; don't disable security software. The `.sig` file is an updater signature, not a Windows publisher certificate.

## Connect with a friend

Both people install the same version:

1. Host enters a name and clicks **Start peer session**, then **Generate invitation**.
2. Send that code privately to the friend. The friend enters a name, pastes it into **Host invitation**, then clicks **Create response**.
3. Friend sends the response back. Host pastes it and clicks **Connect friend**.
4. Wait for **Connected**. Type in both editors and confirm edits appear for the other person. Test **Show overlay** on either PC and edit through it too.
5. Generate a separate invitation for each additional friend. Codes expire in ten minutes. Don't post codes publicly or attach them to bug reports.

Empty network options uses no external discovery/relay service, but private addresses alone usually cannot connect different NAT networks. If connection fails, report it; host can configure their own STUN/TURN and friends configure their own settings before joining. See [networking notes](https://github.com/ahmad-fatayerji/veil). This build does not provide a default relay or guarantee internet connectivity.

## Updates and known limits

Open **App updates** and click **Check for updates**. Checks contact GitHub only when requested. If an update is available, first copy any text you want to keep and end/leave the session. Choose **Install update and restart**. The package signature is verified and local overlay settings are saved. Updates cannot install during an open session. You can also download and run the next installer manually.

Documents are temporary: ending/leaving/closing loses the local document. There are no read-only roles or capture-exclusion guarantees. The coordinating host must remain open. Reconnecting requires a fresh invitation/response exchange; keep the guest session open to retain unsent edits. Updates do not add persistence.

## Useful test report

Send the app version shown under **App updates**, both Windows versions, whether PCs are on the same or different networks, whether a VPN is active, configured STUN/TURN type (omit credentials), the displayed direct/relay path, the exact error, and steps to reproduce. Test bidirectional typing, simultaneous edits, pause/reconnect, third-person joining, leaving, overlays and restart preferences. Redact invitations, response codes, credentials and private document text from screenshots.
