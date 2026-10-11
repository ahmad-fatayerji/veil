# Verification record

## Change-based CI

PR check selection and gate enforcement are implemented in `scripts/ci-plan.mjs`, with regression cases in `scripts/ci-plan.test.mjs` and `scripts/workflows.test.mjs`. The gate must reject failed/cancelled/missing jobs and any skip not explicitly selected as unnecessary. Unknown paths and dependency/workflow configuration changes select every check. Release validation and nightly CI always run the full suite.

`VEIL_NETWORK_MODE=smoke pnpm test:network` checks one direct and one forced-relay guest, staged fallback, selected ICE paths, concurrent document convergence, presence, session cleanup and TURN allocation cleanup. Run again with `VEIL_TURN_TRANSPORT=tcp` for TURN TCP. Ordinary networking PRs run both transports. The default `pnpm test:network` retains the full six-peer handover/recovery/load/capacity/outage suite; nightly and release validation explicitly use `VEIL_NETWORK_MODE=full`. These are loopback/container tests, not real-internet acceptance.

## Create, Share, Join verification — 10 October 2026

The desktop creates an offline temporary document before hosting, keeps configuration in Settings, and shares one reusable version-4 `veil://join/...` link. Browser and overlay share light/dark/System tokens and accessible dialogs. The compatible public server is coordinated in [server PR #3](https://github.com/ahmad-fatayerji/veil-server/pull/3).

Local checks passed `pnpm check`, 18 TypeScript tests, workspace Rust tests, 21 release-tooling tests, and five Chromium regressions. Protocol tests verify pinned host signatures, transcript tampering, independent ECDH link keys, rejection of another guest/shared-root keys, and replay. Document lifecycle tests reject unsupported servers and failed activation, retain edits/identity/awareness, and retry the same document. Browser tests cover persisted/System themes, document retention through Settings, Leave cancellation, focus restoration, and narrow layouts.

`pnpm test:sharing` passed on real Windows/WebView2 with three isolated profiles: offline creation and updater blocking, keyboard tab switching, missing setup routed to Settings, Save and share resumption, saved configuration reuse, simultaneous group joins, edits, reset/stop retaining collaborators, both themes, overlay synchronization, narrow layout, close cancellation, host shutdown, and updater guard release. Redacted screenshots: `target/create-share-join/run-JIcoeO/`. Native hosting, manual peer, and updater regressions also passed against the rebuilt executable. After integrating the current develop capture work, native overlay acceptance passed real compositor/input passthrough, drag/resize, recovery, shortcut collisions, and preference restart (`target/overlay-acceptance/run-Hwqm73/`); capture acceptance passed GDI/DXGI output, affinity, administration isolation, and restart (`target/capture-acceptance/run-7CbwAO/`). The overlay test now explicitly establishes the underlying app's focus before checking passthrough, restores the main window before measuring slider coordinates, and focuses the overlay before native drags.

An actual NSIS installer was built locally with an isolated acceptance product/identifier, preserving the existing Veil installation. `scripts/test-deep-links.mjs` verified installation-created `veil` registration, cold Windows URL launch, warm delivery to one existing process, explicit Join, malformed-link rejection, and active-document Cancel/Leave protection. It then uninstalled the acceptance app and removed its handler. This was an unsigned debug acceptance bundle; production updater upgrade and clean-VM acceptance remain separate. Rebuild the normal executable after using a config override.

`pnpm test:network` passed with TURN UDP and TCP, real Chromium WebRTC, Rust signaling, and coturn: one group link admitted five guests, three measured direct paths and two relay paths, stop/reset rejected new admissions while existing edits/recovery stayed healthy, convergence/presence, authenticated handover, bounded relay exhaustion, signaling outage, and restart. Server formatting/tests/Clippy, container build/config, fixture and real HTTP/STUN/TURN integration passed; its hosted **Server CI gate** passed. Server tests cover per-guest ticket and signaling/relay isolation, authenticated administration, duplicate admission, revocation, legacy single-use admission, cached grants, and resource controls.

Real-internet acceptance remains separate: unrelated physical PCs, public HTTPS, restrictive networks, TURN TLS, real-expiry renewal, sustained load, and clean Windows VM installer/updater behavior are unverified. Existing capture compatibility limits apply. No merge, deployment, installer publication, version bump, or release was performed.

## M4 capture compatibility — 10 October 2026

Implemented opt-in, device-local overlay display affinity with Windows build/composition checks, verified native readback, separate disabled/applied/unsupported/error status, control-panel-only administration and an ephemeral local compatibility test card. Existing overlay settings migrate with exclusion off. See the [capture compatibility matrix and procedure](capture-compatibility.md).

`pnpm check` passed formatting, ESLint, TypeScript, Cargo check and Clippy. `pnpm test` passed fourteen TypeScript and twenty-four Rust tests, including old-Windows version gating, legacy preference migration/persistence and failure-status reporting. Two packaged-artifact tests remain intentionally ignored without signed installer fixtures. The debug executable was rebuilt after Cargo tests. All four browser regressions passed.

`pnpm test:capture` passed actual GDI and DXGI output comparisons on Windows 10.0.26300 with FFmpeg 7.1: the card was visible with exclusion off, absent with exclusion on, and underlying app pixels remained visible rather than a black window. It also verified native affinity, control-panel scope, forbidden overlay administration, opacity/topmost changes, hide/show, global shortcut recovery, click-through style preservation, saved opt-in/out, restart readback and ephemeral test-card reset. No JavaScript errors occurred. The known WebView2 window-class cleanup diagnostic appeared on clean exit. Evidence: `target/capture-acceptance/run-HbIVUA/`.

An isolated portable OBS 32.0.4 fixture recorded the same off/on result through Display Capture / DXGI and Display Capture / Windows Graphics Capture. Extracted recorded frames and OBS method/start logs are under `target/capture-acceptance/run-HbIVUA/`; the frame pairs were visually inspected. No normal OBS profiles/scenes or credentials were used. The final optional-OBS run passed complete capture acceptance, including global shortcut recovery and click-through style preservation.

`pnpm test:overlay` passed the full rebuilt Windows/WebView2 regression: actual continuous slider drags, bidirectional desktop/overlay/browser editing, convergence/reconnect, native move/resize, opacity/compositor, click-through, global recovery/hide/show, restart persistence and shortcut-collision rejection. The drag fixture now scrolls sliders into view before computing OS input coordinates for the taller settings panel. Evidence: `target/overlay-acceptance/run-YNuL7x/`. Native control-panel/test-card screenshots and off/on capture frames were visually inspected.

Old/non-Windows runtime behavior, Teams/Discord remote viewers, Snipping Tool, OBS window/game capture, other GPUs/monitors/DPI and remote desktop remain unverified. Neither native readback nor these four observed capture modes establishes universal capture exclusion. No release was published.

## M6 updater resilience — 10 October 2026

The updater now reports download size/progress, retries transient transfer failures at most three times, applies a timeout to idle reads rather than the whole download, supports cancellation, and honors download throttling deadlines. Signed package/version verification remains mandatory before the installer starts. A persistent local receipt shows success or incomplete installation when the app next launches; this is not automatic rollback.

Local validation: `pnpm check`, `pnpm test`, `pnpm test:release`, and the rebuilt debug executable with `pnpm test:updates`. Rust socket tests exercise a slow progressing transfer longer than its idle timeout, a stalled transfer exhausting retries, a truncated response retrying from zero, cancellation, unknown content length, permanent HTTP errors, and throttling headers. The ignored desktop `real_package_verification` test was explicitly run against the signed 0.2.0 workflow installer: the correct package passes, while modified bytes, truncation, and a mismatched announced version fail. Ordinary Cargo tests intentionally skip tests requiring packaged artifacts.

Native WebView2 acceptance uses an isolated settings/profile directory and a generated, application-trusted loopback HTTPS fixture, with no system trust-store changes. Endpoint/CA overrides exist only in debug builds. It verifies actual size/progress UI, cancellation, corruption rejection, automatic retry, cooldown, session gate recovery, retained channel selection, overlay authorization, and success/incomplete notices after restart. Completion notices use seeded receipts; they do not prove a newly released installer upgrade. Clean-VM installation, disk-full/power-loss/installer-launch failures and a real release upgrade through this revised updater remain separate acceptance requirements. No release was published for these tests.

## P2 automatic networking verification — 10 October 2026

Local verification passed `pnpm check`, fourteen TypeScript tests, twenty-one Rust tests, all 21 release/workflow tests and the four browser regressions. Packaged-artifact verification remains intentionally ignored without a real installer; no installer was published in this task.

`pnpm test:network` exercises actual Chromium WebRTC, the Rust signaling binary and coturn containers. UDP and TURN TCP passed with six users: three direct links and two measured relay links, no TURN requests or allocations for direct participants, six-second staged fallback, concurrent convergence, six-way awareness, authenticated relay-to-direct handover, direct-to-relay recovery of retained edits, large update convergence, explicit grant exhaustion without disrupting healthy links, signaling process outage/restart and allocation cleanup after closing. Public server CI also checks credential revocation/isolation, single-use/expired invitations, cached grants, simulated credential renewal, socket role substitution and a shared HKDF fixture. Real container STUN/TURN allocation and explicit deletion are verified using allocation metrics, including asynchronous cleanup.

The Windows native automatic test passed native HTTP/WSS, Credential Manager reuse, guest joining without configuration, bidirectional editor/overlay edits, leave presence and the native active-session updater guard. After incorporating the latest updater changes, the rebuilt executable also passed `pnpm test:peer` and `pnpm test:updates`, including cancellation, retries, throttling and completion feedback. Debug regression tools retain the legacy UI only through `VEIL_TEST_LEGACY=1`; release builds ignore this flag.

A local UDP 256 KiB incremental update converged across six peers in 1,872 ms. Coturn had four active allocations; a single Docker sample showed 0.04% CPU and 8.406 MiB memory. These are developer-machine samples without the production container limits, not capacity guarantees or peak measurements. Detailed JSON/cleanup metrics are retained under `target/network-acceptance/`. Coturn's aggregate byte counters summarize finished allocations, so inspect cleanup metrics when measuring complete traffic.

Unverified acceptance: unrelated physical Windows PCs, public HTTPS certificate issuance, real restricted networks, operator TURN TLS certificates, long-running renewal across real expiry, prolonged slow consumers, and representative sustained Linux load under the production CPU/memory limits. Follow [automatic networking](automatic-networking.md) and the public deployment instructions. No universal internet connectivity, durable recovery, host migration or capture exclusion is claimed.

## M6 stable 0.2.0 publication verification — 9 October 2026

[Release workflow 37919381077](https://github.com/ahmad-fatayerji/Veil-source/actions/runs/37919381077) validated and compiled exact merged source `7b5e2513216915b295eb29a4e219d1be9035886a`. The signing job restored the same-run executable artifact, checked its provenance, bundled without recompiling the desktop, and passed real installer signature/version/tamper verification. The first publication attempt stopped on a draft release-by-tag 404 after uploading its assets. Before manual publication, all six downloaded draft assets were verified byte-for-byte against the signed workflow artifact, the private source tag, reviewed notes and checksums. The downloaded installer also passed signature and tamper verification locally. The same-run failed-job retry then completed successfully, retained the originally published assets and advanced the beta feed.

Public `v0.2.0` is the latest stable release. Both fixed HTTPS updater endpoints returned `0.2.0`; the unauthenticated public installer download matched SHA-256 `7c9678ca42adab8a4e41b676a8af950688f0ac4d888ab84fd524e2918b841e63`. Evidence: `target/release-acceptance/0.2.0/`. A real installed-client upgrade to 0.2.0, beta-to-stable installation, clean Windows VM, WebView2 bootstrap, SmartScreen and different-network P2P remain separate native acceptance. This publication verified an actual draft failure and recovery, but did not establish that every future automation path is covered.

## M6 release build performance verification — 9 October 2026

The unsigned production executable compiled successfully with locked dependencies and Cargo timing output. In a separate source copy with no frontend `dist`, compiler dependency artifacts or incremental build state, the transferred executable was packaged with `tauri bundle --bundles nsis` and signed using the existing local updater key. Bundling created no `target/release/deps` directory and did not compile the desktop. The new lightweight `veil-release-verifier` artifact test verified that real 0.1.2 installer, checked version binding and rejected a modified byte. The isolated verifier compiled in 14.84s and its test ran in 0.45s on this workstation; these are local results, not GitHub runner estimates. Evidence: `target/bundle-acceptance/ba21f2f431fd4a4eab882779a1e915f6`, `target/verifier-local/cargo-timings/` and `target/cargo-timings/`.

Formatting, ESLint, typechecking, all nine TypeScript tests, all 17 release/workflow tests, Rust formatting/Clippy, all eleven Rust unit tests, the locked Windows debug build and all four browser regressions passed. `actionlint` validated the workflow syntax and expressions. The new tests cover source/version/run/attempt/checksum mismatch, missing executable, same-run retry acceptance, overlapping compilation and validation, and mandatory gates before signing/publication.

Hosted cold/warm performance, same-run GitHub artifact transfer/retry and end-to-end publication through the revised workflows remain unverified. No release was published during local validation. Existing clean-VM, WebView2-bootstrap and native internet/capture limitations below still apply.

## M6 distribution verification — 9 October 2026

Production Windows x64 NSIS installers and mandatory updater signatures built successfully. The public distribution repository is `ahmad-fatayerji/veil`; source remains private at `ahmad-fatayerji/Veil-source`. Version 0.1.0 and 0.1.1 have public release assets and HTTPS update metadata.

`pnpm test:installer` verified actual per-user installation to a temporary path, installed production editor/overlay, native rejection of updater administration from the overlay, refusal to install during a peer document session, clean close, maintenance reinstall and retained opacity/font preferences. Original device preferences were restored and the temporary app uninstalled. Evidence: `target/installer-acceptance/run-2mAgB1`.

`node scripts/test-installer.mjs target/release/bundle/nsis/Veil_0.1.0_x64-setup.exe 0.1.1` verified a real signed HTTPS GitHub update, installer execution, automatic relaunch at 0.1.1 and retained overlay preferences. Evidence: `target/installer-acceptance/run-5BvhYp`. The test closes visible overlay/control windows in sequence before reinstalling, so an overlay-only close cannot leave the app running.

The ignored artifact test was explicitly run against both actual setup packages using `VEIL_TEST_INSTALLER`: the embedded public key verifies the real signature/version, and changing one installer byte causes signature verification failure. It requires packaged artifacts and is intentionally separate from ordinary unit tests. Native P2P acceptance passed again after updater/session tracking changes (`target/peer-acceptance/run-KALkRl`). Nine TypeScript and ten Rust unit tests passed; all four browser regressions passed. A clean Windows VM, absent-WebView2 bootstrap, Authenticode/SmartScreen trust, real different-network P2P and TURN remain unverified. No document persistence or recovery across updates is claimed.

The source release workflow builds and creates drafts in the public repository, refuses overwriting published versions, and requires a token scoped to the public release repository. Signing secrets are stored in the private source repository. GitHub Actions execution is recorded separately from local validation.

## P1 peer transport verification — 9 October 2026

The default desktop mode is now P2P. The Windows executable builds successfully. `pnpm check` and `pnpm test` passed (nine TypeScript and nine Rust tests), and all four browser regression tests passed with the eight-item roadmap.

`pnpm test:peer` passed with three actual desktop/WebView2 instances, isolated settings and profiles, and no STUN/TURN/signaling server. It verified real invitation/response exchange, rejection of a mismatched credential before joining, the selected direct candidate pair, bidirectional editing and coordinator fanout, a 70,000-character fragmented update, presence cleanup, retained offline edits merging after fresh signaling, restored guest presence, bidirectional P2P overlay editing, and host shutdown disconnecting guests. No JavaScript errors were reported. Redacted screenshots are under `target/peer-acceptance/run-zdBulS`.

This is same-PC native verification, not proof of connectivity between unrelated internet networks. Two physical PCs on different networks and an authenticated self-hosted TURN server remain manual acceptance requirements. Use [P1 networking](p2p.md) for setup and scope. LAN/browser hosting and the full native overlay regression both passed again after the P2P changes (`target/host-acceptance/run-Xwlif5` and `target/overlay-acceptance/run-ecvSzC`). No public HTTP listener or default service provider was added.

Run the commands in the README. Windows CI builds both frontends, checks formatting/lint/types, checks and lints both Rust crates, runs unit tests, and runs Chromium interoperability tests against the real Rust host. CI execution on GitHub is separate from local validation.

## Local verification — 9 October 2026

Verified on Windows x64 with Node 22.13, pnpm 10.30.1, and Rust 1.99:

| Command                                                       | Result                                                                                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                  | Both Vite production frontends built                                                                                                                                                                           |
| `pnpm --filter @veil/desktop tauri build --debug --no-bundle` | Embedded-assets Windows executable built at `target/debug/veil-desktop.exe`                                                                                                                                    |
| `pnpm check`                                                  | Prettier, rustfmt, ESLint, TypeScript, workspace Cargo check and Clippy passed                                                                                                                                 |
| `pnpm test`                                                   | 3 TypeScript tests, 2 Rust host tests, and 2 desktop settings tests passed                                                                                                                                     |
| `pnpm test:e2e`                                               | 4 Chromium tests passed: concurrent edits, reconnect, late join, authentication, named cursors, selections, activity, cleanup, roadmap and mobile layout                                                       |
| `pnpm test:overlay`                                           | Real Windows/WebView2 acceptance passed: separate windows, native drag/resize, opacity/compositor, topmost, cross-app click-through, global shortcuts, non-default preference restart, and shortcut collisions |

Browser screenshots and real native control-panel/overlay screenshots were inspected. The native acceptance script used a separate WinForms process to verify transparency and input passthrough; it did not mock Tauri. Native acceptance also verifies bidirectional desktop/overlay/browser editing, concurrent convergence, typing and selection activity, cursor and selection presence after switching editors, one desktop identity, disconnect/reconnect, and leave/rejoin. Hosted CI does not run the interactive native script. Vite reports a large editor bundle warning (approximately 773 kB uncompressed / 245 kB gzip in desktop); code splitting is a later optimization. Debug WebView2 logs can print a window-class cleanup diagnostic on exit; the acceptance runs exit successfully and report no JavaScript errors.

## Automated acceptance

- Protocol validation rejects invalid credentials, incompatible versions and invalid optional participant limits; null means no cap.
- Rust checks trusted HTTP Host/Origin pairs and rejects malformed/custom binary messages.
- Independent Chromium clients edit the same paragraph concurrently and converge through Rust. No BroadcastChannel shortcut is enabled.
- Both clients disconnect, edit and delete against the same initial state, then reconnect and converge without losing either insertion or resurrecting deleted characters.
- A fresh third client receives the full document.
- Departing clients disappear from awareness; unauthenticated socket upgrades fail.
- Named remote cursors and selections follow their author. Typing activity settles after idle and remote changes do not mark a receiving client as typing. Leaving removes the participant and cursor.
- The roadmap displays eight milestones, closes with Escape, and restores focus. The mobile join layout does not overflow horizontally.
- Local overlay settings replace atomically; invalid/corrupt values are rejected. Removed-monitor and negative-coordinate bounds are covered by unit tests.
- [Native overlay acceptance](overlay.md) checks continuous real mouse drags of both sliders, bidirectional shared-document editing, concurrent convergence, cursor/selection presence, reconnect, leave/rejoin, actual Win32 attributes, compositor pixels, mouse drag/resize, another process receiving clicks, recovery outside the WebView, all changed settings after restart, and click-through rejection when its hotkey is taken.

## Manual development checks

1. Run host and web; join in two browser windows with different names.
2. Edit, format with bold/heading/bullets, disconnect one editor, edit both, then reconnect.
3. Start `pnpm dev:desktop`; start and join an embedded session, then open its invitation in another browser. Confirm the native WebView receives that browser's edits. This session is separate from the M0 demo.
4. Close the host: clients should show disconnection and retry. Restart it: process credentials rotate, so leave and rejoin to bootstrap a fresh connection. Restart recovery is deferred; this intentionally loses the document.
5. Close all clients and restart the host: document should be empty; this is expected for M0.

Broader multi-monitor/DPI and assistive-technology checks remain manual. Document restart persistence, capture testing, capacity load targets, installers and updates belong to later milestones. Local overlay preference restart is verified in M1. The M0 demo remains separate from embedded hosting.

## M2 verification - 9 October 2026

Implemented all five M2 work items: desktop start/stop, bundled browser assets, explicit trusted-LAN configuration, session invitations/authenticated join/leave/presence, and network address/participant display. Full second-device LAN acceptance remains manual; it is not claimed as verified.

Verified locally on Windows x64:

- `pnpm --filter @veil/desktop tauri build --debug --no-bundle`: production browser/desktop assets and the embedded-assets Windows executable built successfully.
- `pnpm check`: Prettier, rustfmt, ESLint, TypeScript, workspace Cargo check and Clippy passed.
- `pnpm test`: five TypeScript protocol/invitation tests and nine Rust host/desktop tests passed. Host tests cover trusted Host/Origin, malformed frames, invitation validation, asset headers/path restrictions, bounded bodies/attempts, rejected exposure settings, port release and invitation rotation.
- `pnpm test:e2e`: four independent Chromium regression tests passed, including concurrent edits, deletes, reconnect, late joining and awareness cleanup. Concurrent insertions execute inside each page to avoid two browser keyboards racing for OS focus.
- `pnpm test:host` with `VEIL_TEST_LAN_ADDRESS=192.168.1.4`: real Tauri/WebView2 hosting controls, occupied-port error/retry, bundled browser assets, bidirectional desktop/browser edits, participant list, rejected join credentials and WebSockets, leave cleanup, active-socket shutdown, port release, session restart and old-invite rejection passed. The same-machine private-interface browser joined and synchronized with the loopback desktop client. This does not test a second physical device or inbound firewall reachability.
- `pnpm test:overlay`: full real Windows/WebView2 regression passed against the embedded session and bundled browser client, including shared editing, native drag/resize, opacity/compositor, cross-app click-through, shortcuts, preference restart and collision rejection. The script explicitly focuses the overlay before dragging and reopens Settings after the new-session workspace reset. WebView2 printed the known window-class cleanup diagnostic on exit; the script completed successfully without JavaScript errors.

Host/browser screenshots are isolated under `target/host-acceptance` and omit the invitation field from the host screenshot. The initial browser fragment is removed from visible history. Native tests use separate preference directories; ordinary local settings are untouched. Native acceptance is separate from hosted CI. Large editor-bundle warnings remain a known optimization item.

Manual acceptance for the remaining LAN criterion:

1. Run `pnpm dev:desktop`, select LAN / browser, then Trusted LAN, and enter this PC's physical adapter private IPv4 address from `ipconfig`.
2. Acknowledge the plaintext setting, start, and allow Veil through Windows Firewall on private networks if prompted.
3. Open the copied invitation on a second device on the same trusted network. Join with a different name; join in the desktop control panel too.
4. Edit both ways, confirm convergence and named presence, leave/rejoin, and reconnect after a temporary network interruption.
5. End the session and verify that both clients disconnect and the address stops responding. Start again and verify that the old invitation is refused.

No firewall/router changes or second-device success were fabricated. Roles, optional configured capacity, durable recovery remain M3; capture compatibility and secure internet access remain M4/M5.
