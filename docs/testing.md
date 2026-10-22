# Verification record

## Launch multiple desktop clients for manual testing

On Windows, install the normal development prerequisites and run
`pnpm install --frozen-lockfile`, then use one command from the repository root:

```powershell
pnpm dev:multi
```

This builds a debug app with the frontend included and opens two clients with
fresh, separate settings and WebView2 storage. Use `pnpm dev:multi 3` for three
clients. The first build can take a while; later runs reuse the build cache.
No dev server or environment-variable setup is needed. Rerun after source changes.

Create and share a document in one client, then paste its invitation into
**Join session** in another. The usual sharing-server requirements still apply.
Save any notes before pressing **Ctrl+C**, which immediately stops all clients
started by the command, including any hidden in the tray. Closing a window may
only hide it; use **Quit Veil** to exit an individual client.

Each invocation creates new profiles under `target/multi-instance/run-*` and leaves
them there for inspection. Debug build output is isolated under
`target/multi-instance/build`. Installed release builds still use one instance.
The launcher does not run automated tests or start a sharing server.

## Save, Open, tabs, and recovery acceptance

The following cases require user testing on Windows 10/11 with WebView2. They are
acceptance instructions, not verification records. Regression tests were added
for Markdown conversion, workspace decisions, connection isolation, atomic writes,
encoding and size failures, and update gating; execution remains with the user.

1. Save and reopen Unicode titles, all formatting commands, nested tasks/lists,
   quotes, code, and dividers. Repeat with BOM/CRLF, empty notes, unsupported
   links/images/HTML/tables, and invalid UTF-8 or oversized files.
2. Cancel Open and Save As; try read-only and unavailable locations. Confirm notes
   and unsaved state survive. Edit a saved file externally and exercise Overwrite,
   Save As, and Cancel. Make edits during a save; newer changes must stay unsaved.
   Reopen the same path without duplicating its tab; Save As must not overwrite a
   file open in another tab.
3. Host one tab, join another, and edit a third locally. Check each tab's People,
   Share, and Discord activity. Reconnect or close one session without interrupting
   the others. Verify editor undo and selection survive tab switches.
4. Edit in the overlay while switching tabs, then immediately save or close.
   Verify edits reach their originating document and the overlay follows selection.
   Check Ctrl+N/O/S/Shift+S/Tab/Shift+Tab/W, Ctrl+1–9, strikethrough on
   Ctrl+Shift+X, and arrow/Home/End navigation in the tab strip.
   With tabs in the title bar, drag and double-click the empty title bar space,
   middle-click a tab to close it, and scroll an overflowing tab strip with the
   mouse wheel. New, Open, or Join from a blank Home tab must replace it. The
   People, overlay, Share, and ⋯ document menu controls must follow the selected
   tab; saving must not flicker or disable the tabs.
   Switch a shared tab to Markdown and edit while a collaborator edits another
   paragraph in rich text. Both edits must survive, your caret must stay put, the
   title must follow the leading `# Heading`, and switching back must keep undo.
   Italic text must render slanted in rich text.
   In the overlay, check each Formatting controls setting, the Markdown toggle,
   the document switcher with several tabs, avatar activity tooltips, the
   recovery hint appearing only in click-through mode, text opacity sparing the
   formatting controls, and arrow cursors on controls with capture exclusion.
5. Exercise tab close, tray Quit, Alt+F4, and window close configured as Quit.
   Check Save / Discard / Cancel across several tabs, failed/cancelled saves,
   remote edits during prompts, and the hosted-session warning. Cancel must keep
   all sessions alive; closing to the tray must preserve the workspace.
6. Enable restoration, leave saved and unsaved tabs open, force an unexpected
   exit, and reopen. Restore content/order locally without reconnecting sessions.
   Repeat normal quit with Save and Discard: discarded unnamed drafts must not
   return. Disable restoration and verify snapshots disappear while current notes
   remain. Check missing files, damaged recovery, and recovery write failures.
7. Install a local test build and use Explorer's Open with on paths containing
   spaces and Unicode, with Veil closed and running. The default editor must stay
   unchanged; uninstall must remove only Veil's association. No publication is
   required for this acceptance test.
8. Updates must remain blocked with any document or background connection open,
   including after closing the selected tab or selecting Home.

## Windows startup - 22 October 2026

Added **Start Veil with Windows** in Settings > General, off by default. Sign-in
launches use `--autostart` and keep the control panel and overlay hidden while the
tray initializes. Manual launches and invitations show the control panel; duplicate
autostart launches do not reveal it. The toggle refreshes from Windows registration
whenever Settings opens and reports read/write failures without optimistic changes.

The autostart plugin is pinned to 2.5.1 for current-user registration. Native code
quotes its registered executable path for installation paths containing spaces and
removes the registration if enabling or quoting fails. Direct plugin commands are
not granted to WebViews; the app's startup commands require the main window.

TypeScript, changed-source ESLint, Prettier, rustfmt and `git diff --check` passed.
Windows `cargo check -p veil-desktop --tests` passed, compiling the added launch
argument regression cases. Test suites and native acceptance were not run.
This feature does not change any server or peer protocol contract.

Manual acceptance on an installed Windows build:

1. With no startup registration, confirm the switch is off. Restart Veil and confirm
   it stays off; signing in to Windows must not launch Veil.
2. Enable the switch, quit, and sign in again. Confirm one tray icon, no control
   panel or overlay flash, and no taskbar window, including after saving a visible
   overlay in the previous run. Repeat with an installation path containing spaces.
3. Open Veil from the tray, a normal app launch, and an invitation link while it is
   running in the tray. Confirm the control panel opens and invitations still work.
   Invoke the executable with `--autostart` again and confirm it stays hidden.
4. Confirm tray overlay controls and Quit Veil still work. Disable startup, quit,
   and sign in again; Veil must remain closed. Confirm the disabled choice survives
   an app upgrade, and an enabled choice remains enabled without re-registering.
5. Disable Veil through Windows Startup Apps, then reopen Settings and confirm the
   switch reflects that change. Re-enable in Veil and confirm startup works again.
6. With registration writes denied in a disposable Windows test account, confirm
   an accessible error and the last confirmed switch value. Reopen Settings to
   refresh the actual state. Confirm the overlay cannot invoke startup commands.

## Discord Rich Presence - 22 October 2026

Added default-on Windows Discord activity and independent title/count privacy
switches in Settings > General. The native manager applies privacy before sending
activity, keeps only the latest state, prioritizes privacy changes, and uses
bounded IPC transactions and reconnect backoff. Preferences are stored separately
from temporary documents. Browser/legacy flows do not activate presence.

Verified source compilation with TypeScript and Windows `cargo check` (including
compilation of the Rust regression tests); desktop Clippy with warnings denied,
changed-source ESLint, Prettier, rustfmt, and `git diff --check` passed. Local test
suites, `pnpm check`, live Discord, and native UI acceptance were not run. The added Rust cases cover title
and count privacy, solo/singular/plural wording, blank/Unicode titles, preference
defaults/migration/round trips, corrupt preferences, and failed writes. They have
not been executed.

Manual acceptance on Windows with Discord activity sharing enabled:

1. Start with fresh preferences and confirm all three switches default on. With
   no document open, confirm "No document open". Create a document, rename it,
   and confirm "Document: <title>" and "Editing solo" appear. With guests, the
   second line should say "Editing with 1 other" / "Editing with X others".
2. Connect one guest and then another. Confirm "1 other" and "2 others", excluding
   yourself. Pending approval requests must not change the count; departures
   must update it. Rename the document from the other client.
3. Exercise all title/count switch combinations. Hidden titles become "Editing a
   document" with a compact "Solo" / "With X others" count line rather than
   repeating the editing message; hidden counts disappear. Try blank, long Unicode, and single-letter
   titles. Confirm privacy changes promptly remove previously visible fields.
4. Disable Rich Presence and confirm activity clears. Both subordinate controls
   must be disabled with their values preserved. Restart Veil while disabled,
   then re-enable it and confirm the saved privacy choices remain effective.
5. Start Discord after Veil, restart Discord, and check recovery with current
   privacy choices. Minimize Veil to the tray and keep editing through the
   overlay; confirm activity remains current. Close the document and quit Veil;
   confirm idle and then cleared activity.
6. Navigate the switches by keyboard and verify labels, focus visibility, and
   disabled states. In an isolated debug preferences directory, corrupt
   `discord.json` and confirm presence pauses with a Settings warning. Simulate a
   failed preference write and confirm the new privacy choices apply during that
   run while Settings explains they were not saved.

No server contract or protocol-generation changes, merge, or release publication.

## Overlay capture layer hotfix - 12 October 2026

The user tested PR #43 with Discord full-desktop sharing started before Veil.
The first native visibility-only candidate did not clear the black rectangle;
manual hide/wait/show did. The revised debug build recreates the layered style
while hidden, restores opacity and confirms exclusion before showing. The user
reported that this revision appears to fix the problem and requested a hotfix.

Production frontend builds and the final Windows debug build passed during the
investigation. Changed-file formatting, JavaScript/PowerShell syntax checks and
a one-second read-only diagnostic-script run without an active Veil passed.
Local test suites and native capture acceptance were not run. Release CI must
validate the exact hotfix source before merge and publication. Discord's internal
capture state was not observed; the broader capture compatibility matrix and
other hardware/modes remain unverified for this revision.

## Short invitation links and optional approval - 12 October 2026

Added 22-character, 128-bit invitation codes, local encrypted invitation lookup,
and host-selectable automatic/approval joining. Approval requests are bounded and
expire after two minutes. Reset/Stop revoke pending access while preserving
approved guests. The server queues signed rejection status before closing that
guest. No release was published or deployed.

App TypeScript typechecking, linting of changed TypeScript/JavaScript, scoped
formatting and Rust formatting checks passed. App test suites, builds and Windows
acceptance were intentionally not run under the ordinary task workflow. Added
protocol/admission regression cases and extended the native sharing acceptance
script for approval, mode changes and preserving the same link; these remain for
user/CI execution.

Coordinated server validation passed: cargo fmt check, Clippy with warnings denied,
11 Rust tests (including real loopback WebSocket rejection ordering), the public
HKDF fixture, Python integration syntax and Compose configuration. Docker's Linux
engine was unavailable locally. The coordinated
[server CI run](https://github.com/ahmad-fatayerji/veil-server/actions/runs/38209810090)
passed its Rust checks, container build, STUN/TURN integration and Server CI gate.
Cross-device networking, Windows activation, native rendering and user acceptance
remain unverified.

## Overlay control cursor with capture exclusion - 12 October 2026

The overlay close button and its **Hide overlay** menu action now use the default
arrow cursor when capture exclusion is enabled, retaining hover/focus styling.
The portaled menu receives the overlay's exclusion setting explicitly. Normal
cursor behavior remains when exclusion is disabled and in the main document menu.
Formatting was applied; no builds or tests were run for this revision. Actual
Windows pointer behavior and capture output remain unverified. No release was
published.

## Matching app-styled visibility menus - 12 October 2026

Both visibility menus now use one desktop React component and the app's theme
tokens, replacing the different WebView2 and Windows menu implementations. They
contain one action each, use square corners and matching icons, clamp to the
window bounds, and support keyboard focus, activation and Escape dismissal.
Outside clicks, scrolling, window resize and blur dismiss the menu. The overlay
menu is rendered inside the overlay webview, under its native capture policy.

The acceptance fixture now checks the single focused menu item in each window,
Escape dismissal and native keyboard activation, using webview screenshots for
the app-styled menus. Formatting was applied; no builds or tests were run for this
revision under the ordinary feature workflow. User testing remains pending.
Earlier records below describe previous revisions. No release was published.

## Simplified overlay and main document menus - 12 October 2026

The Windows overlay context menu now contains only **Hide overlay**. The main
document context menu contains only **Show overlay**, which shows the overlay
without toggling it off when already visible. The desktop editor owns the main
document menu; shared browser editors are unchanged. Both actions preserve the
document and session.

The native tray acceptance fixture now includes hiding through the overlay menu
and showing through the main document menu, with screenshots for manual menu
inspection. This revision has not been built or tested locally; testing is left
to the user under the ordinary feature workflow. The results below predate this
menu simplification. No release was published.

## Overlay close button and context menu - 12 October 2026

The square overlay has a header close button and a Windows native **Hide overlay**
context-menu action. Both hide the overlay without ending the temporary document
or session. The native menu retains its standard editing actions; showing the
overlay and changing preferences remain control-panel operations.

After integrating current develop, `pnpm check`, both production frontend builds,
27 TypeScript tests and 27 Rust tests passed. Two signed-installer tests were
intentionally ignored. The debug executable was rebuilt after Cargo tests.
`node scripts/test-tray-close.mjs` passed real Windows/WebView2 right-clicks in the
editor and header followed by native End/Enter menu selection, document retention,
pointer/keyboard close-button activation, compact header layout, unchanged bounds,
show authorization, hide with the main close preference set to Quit app, and the
existing tray/native quit/restart regression. The menu screenshot was inspected.
Evidence: `target/tray-acceptance/run-DrzDHe/`.

The isolated fixture temporarily disables capture exclusion for the menu screenshot
and restores it before the header-menu check. Earlier attempts stopped on desktop
input/menu-accessibility contention; the final fixture checks pointer ownership
and uses native menu keyboard selection. Physical mouse selection of the menu item,
non-Windows runtime behavior, multiple monitors/DPI, and the full capture/networking
acceptance matrices remain unverified by this focused run. No release was published.

## Main document width (issue #23) — 11 October 2026

The desktop workspace now fills the usable window width, with the existing People sidebar and responsive drawer retained. Real Windows/WebView2 local-document acceptance reproduced the previous 393-pixel editor and measured 829 pixels after the fix at a 1,180-pixel viewport (1,165 usable pixels after the scrollbar); closing People measured 1,101 pixels. The before/after screenshots were visually inspected.

WebView viewport emulation at 800, 960, 1,180 and 1,600 pixels verified full workspace width, no horizontal overflow, the 240-pixel sidebar at larger sizes, People hide/show, and retained editable document contents. At 800 pixels, the existing 320-pixel People drawer remains usable. Evidence: `target/editor-width-acceptance/run-2vNfve/` (viewport emulation) and `target/editor-width-acceptance/run-w5WUIq/` (native initial viewport). The native resize helper did not change the observed viewport, so real native resizing and multiple DPI/monitor configurations remain unverified.

Both production frontend builds, the debug Windows executable and all 27 TypeScript tests passed. No release was published.

## Named overlay cursors and participant alignment — 11 October 2026

The overlay now uses the regular editor's named remote cursors and colored
selections. The main window relays remote awareness snapshots, updates,
heartbeats and removal tombstones; local overlay presence retains one desktop
identity. Participant status inherits the strip's font size and has no sidebar
top margin, keeping names and status text aligned.

`pnpm check`, both production frontend builds, all 27 TypeScript tests and all
25 Rust tests passed; two installer-artifact tests were intentionally skipped.
The first Rust run hit the previously recorded updater cancellation/slow-download
timing failures during compilation; the serial rerun passed. The debug Windows
executable was rebuilt after that first Cargo run before native acceptance.

A focused copy of `scripts/test-overlay.mjs` ran through its collaboration checks
on real Windows/WebView2 with isolated settings. It omitted the recovery-shortcut
assertion and the later global-shortcut/compositor/restart checks to preserve the
already-open Veil instance. It verified visible author names, colored selections,
no self cursor or extra participant, current cursor/selection after overlay reload,
idle cursor retention beyond 30 seconds, blur/removal cleanup, typing activity,
aligned away status within one pixel, bidirectional/concurrent edits, reconnect,
and leave/rejoin. Cursor and participant-strip screenshots were visually inspected.
Evidence: `target/overlay-acceptance/run-yxpYv1/`.

This focused run does not verify capture compatibility, global shortcuts,
unrelated-network transport, multiple monitors/DPI, or non-Windows behavior.
No release was published.

## Immediate tray quit ? 11 October 2026

Tray **Quit Veil** now calls the same immediate native shutdown handler as the **Quit app** window-close preference. It no longer opens the control panel or shows a confirmation. Preferences still flush before exit, update installation still blocks quitting, and shutdown errors still reopen the control panel. The unused frontend quit dialog and request listener were removed.

`pnpm check`, both production frontend builds, 27 TypeScript tests and 25 Rust tests passed; two signed-installer tests were intentionally ignored. The initial Rust run hit the previously recorded updater timing failures while compilation was active; the full serial rerun after checks passed. The Windows debug executable was rebuilt after Cargo tests. `node scripts/test-tray-close.mjs` passed default close-to-tray behavior, editing through the visible overlay while the main window is hidden, overlay command authorization, immediate native shutdown with an active document/overlay, saved preferences after restart, and immediate window-close exit in Quit mode. Evidence: `target/tray-acceptance/run-wlQaZ3/`.

The fixture invokes `app_quit`, which shares native shutdown with the tray handler; it does not click the physical tray menu. Physical tray-menu interaction, non-Windows runtime behavior and multi-peer shutdown remain unverified. No release was published.

## General settings quit cleanup ? 11 October 2026

General no longer shows the standalone **Quit Veil** button or its explanatory line. The existing native **Quit app** close path exits immediately without a confirmation, including with a temporary document and visible overlay. Default tray behavior and tray quit confirmation remain unchanged.

`pnpm check`, both production frontend builds, 24 TypeScript tests and 25 Rust tests passed; two signed-artifact tests were intentionally ignored. The initial parallel Rust run hit the previously recorded updater timing failures during concurrent builds; the full serial Rust rerun passed. The debug executable finished rebuilding after Cargo tests. `node scripts/test-tray-close.mjs` passed actual Windows/WebView2 default tray close, overlay/document preservation, absent Settings quit controls, quit cancellation/exit through the registered tray-request listener, saved Quit preference after restart, and immediate native window-close exit with an active document/overlay. The Settings screenshot was visually inspected. Evidence: `target/tray-acceptance/run-z6XxRE/`.

The fixture invokes the existing Tauri listener rather than clicking the physical tray menu. Physical tray-menu interaction, non-Windows behavior and multi-peer networking while hidden remain unverified. No release was published.

## Normal cursor with local gesture hints — 11 October 2026

With the saved capture-exclusion preference on, overlay move/resize handles use the normal arrow and show a compact Move/Resize direction badge inside the header. Active gestures take precedence over hover and retain the arrow over document content. Gesture completion/errors clear active state; native window-focus events supplement browser blur, and hiding/click-through clear hover. Handles prevent browser selection/drag-and-drop so repeated resizing cannot start a separate forbidden drag cursor. Idle editing and exclusion-off cursors remain ordinary. No global cursor settings or production native command interfaces changed.

`pnpm check`, `pnpm test` (24 TypeScript and 25 Rust tests passed; two signed-package tests intentionally ignored), production frontend builds and the debug Windows build passed. The executable was rebuilt after Cargo tests. Full `pnpm test:capture` passed on Windows 10.0.26300 / FFmpeg 7.1. Actual `GetCursorInfo` probes verified header movement, all eight resize handles, hover hints, active precedence, completion, Escape, native focus loss, a real concurrent-gesture rejection, click-through/recovery and ordinary off/idle cursors. Cursor assertions compare Windows resource handles and respect the current system cursor theme. Editing synchronized with the control panel, including after resizing. The minimum-size header image was inspected; the badge fits without covering document text.

GDI and DXGI both recorded with cursor capture enabled. During held movement and resizing, the arrow remained visible, test-card pixels were absent, the badge region showed only the underlying app, and no outline appeared across the overlay perimeter. Captured images were inspected. Affinity, authorization, appearance, hide/show and saved preference restart also passed. Evidence: `target/capture-acceptance/run-gUwawu/`, including `cursor-results.json`, capture frames/metrics and `header-hint-minimum-size.png`.

Earlier runs exposed the browser drag cursor, missing browser blur during owned-window focus changes, and probes targeting scrolled-out editor coordinates; the final implementation/fixture addresses each. Moving-window OBS/Teams/Discord, multiple monitors/DPI and non-Windows runtime behavior remain unverified. No merge or release was performed.

## Capture-excluded overlay movement — 11 October 2026

Windows overlay header and edge gestures now update the owned HWND without the system move/size loop or its separate capture-visible outline/snap preview. The native sizing border is disabled on Windows; the overlay's visible resize handles still work. Updates are posted to the UI thread so input polling can observe release and focus loss promptly. Escape restores starting bounds, and resizing preserves the scaled minimum size. The app does not change Windows' full-window dragging preference.

`pnpm check`, `pnpm test` (24 TypeScript and 25 Rust tests; two packaged-installer tests intentionally ignored), production frontend builds and the debug Windows build passed. After merging current canonical develop, checks/tests/builds and native capture acceptance passed again; all 29 release-tool tests also passed. The debug executable was rebuilt after Cargo tests. Focused overlay Rust tests cover movement, all eight resize directions, opposite-edge anchoring, minimum size at non-default scale and negative monitor coordinates.

`pnpm test:capture` passed on Windows/WebView2 with FFmpeg GDI and DXGI capture. With Windows full-window dragging temporarily disabled by the fixture, real header/corner gestures changed native bounds before mouse release, retained affinity `0x11`, excluded the test card and showed the underlying app across the captured perimeter without an outline. Screenshots were visually inspected. The fixture restored the previous Windows setting after each gesture. Affinity, authorization, appearance changes, click-through/recovery, hide/show, preference restart and the temporary test-card lifecycle also passed. Evidence: `target/capture-acceptance/run-pfT6CH/`.

Earlier attempts stopped on foreground/z-order contention and pointer/position timing; the fixture now raises the test window before input and lets repositioning settle. The final run acquired the global shortcuts. This task did not rerun the full document/slider overlay suite. Moving-window OBS, Teams/Discord remote viewers, multiple monitors/DPI and non-Windows runtime behavior remain unverified. No release was published.

## Overlay participant activity — 10 October 2026

The overlay now receives sanitized participant snapshots through the existing desktop-only bridge and shows names, colors, typing, selecting, in-document and away activity in a compact strip. Opening the overlay retains one desktop identity; leaving clears the strip and participant departure removes the corresponding entry.

`pnpm check`, `pnpm test` (18 TypeScript and 24 Rust tests, with two packaged-artifact tests intentionally ignored) and both frontend builds passed. The debug executable was rebuilt after Cargo tests. Focused real Windows/WebView2 acceptance passed remote typing, idle transitions, selection and away activity, participant roster/departure cleanup, bidirectional editing, concurrent convergence, reconnect and leave/rejoin. The overlay screenshot was visually inspected. Evidence: `target/overlay-acceptance/run-l1g2bF/`.

Two full `pnpm test:overlay` attempts stopped before the presence checks at the existing native slider-drag assertions (opacity, then font size). The focused run used keyboard setup for those sliders and stopped after document/presence acceptance; it does not verify the full native drag, compositor, click-through, shortcut or preference-restart matrix. The guest's away test explicitly focuses a browser control because native window activation cannot blur a headless Chromium editor. No release was published.

## Immediate window-close quit — 11 October 2026

When **Quit app** is selected, the main window's close button now exits immediately without the quit confirmation, including with a temporary document and visible overlay. Settings/tray **Quit Veil** still confirms. Both paths save preferences and refuse to exit during update installation.

`pnpm check` and `pnpm test` passed (24 TypeScript and 24 Rust tests; two packaged-installer tests intentionally ignored). After rebuilding the isolated debug executable following Cargo tests, `scripts/test-tray-close.mjs` passed actual Windows/WebView2 default tray close, overlay/document preservation, explicit quit cancellation/exit, saved Quit preference after restart, and immediate native window-close exit with an active document/overlay. Evidence: `target/tray-acceptance/run-rNPKGy/`. Physical tray-menu interaction, non-Windows behavior and multi-peer networking while hidden remain unverified. No release was published.

## Configurable window close and tray overlay actions — 11 October 2026

Settings → General now saves **When closing the main window** as **Minimize to tray** (default, including legacy preferences) or **Quit app**. Quit app routes the native close request to the quit confirmation. Tray actions include Open Veil, Show/Hide overlay and Quit Veil; the overlay action's label follows visibility changes from controls and shortcuts.

CI exposed a recurring browser presence fixture race: typing could start at the beginning before keyboard navigation established the caret. The fixture now clicks the editor and verifies a collapsed selection at the end before typing. Five consecutive local presence/roadmap runs passed (ten tests), and `pnpm check` passed with this fixture change.

`pnpm check` and `pnpm test` passed after integrating current develop (24 TypeScript and 24 Rust tests; two packaged-installer tests intentionally ignored). Settings tests cover legacy defaults and round-trip persistence of Quit while retaining appearance preferences. A separate debug output directory preserved the already-running executable/session. After rebuilding following Cargo tests, `VEIL_TRAY_TEST_EXE=target/tray-preferences/debug/veil-desktop.exe node scripts/test-tray-close.mjs` passed real Windows/WebView2 acceptance: default tray close, retained editable overlay/document, both saved close choices, quit cancellation and confirmation, hidden overlay preservation, persisted choice after a full restart, and native window-close quit after restart. Screenshots were visually inspected. Evidence: `target/tray-acceptance/run-PQaLpD/` and `target/tray-acceptance/run-r9SB4S/`.

Actual tray icon/menu pointer interaction, non-Windows behavior and multi-peer networking while hidden remain unverified by this focused native test. No release was published and no PR was merged by this task.

## Close to tray and explicit quit — 10 October 2026

Closing the main window minimizes and hides it in the system tray while preserving the document, connections and overlay visibility. Settings opens to General with an explicit Quit Veil action and confirmation; the tray also offers Open Veil and Quit Veil. Native quit is restricted to the control panel and blocks update installation interruptions.

`pnpm check` and `pnpm test` passed (18 TypeScript and 24 Rust tests; two packaged-installer tests remain intentionally ignored). The debug executable was rebuilt after Cargo tests. `node scripts/test-tray-close.mjs` passed twice on actual Windows/WebView2 with an isolated profile: native main-window close, overlay editing while the main window is hidden, retained document state, forbidden overlay quit administration, quit cancellation, closing from Settings with the overlay hidden, and confirmed process exit with code zero. Settings and confirmation screenshots were visually inspected. Evidence: `target/tray-acceptance/run-6TXPMG/` and `target/tray-acceptance/run-cG0aHm/`.

The regression restores the main window through native window APIs; actual clicks on the system tray icon/menu and non-Windows behavior remain unverified. Multi-peer networking while hidden is not covered by this focused native test. No merge or release publication was performed by this task.

## Mandatory credential validation on save - 11 October 2026

Saving a newly entered or replacement host credential now runs the native
connection/authentication probe before writing Credential Manager or preferences.
Failed checks preserve entered values, existing saved settings, and the pending
Save and share flow. An empty credential requires a saved key for that exact
origin; an unchanged saved key can be reused without another online check.

`pnpm check` and `pnpm test` passed: 24 TypeScript tests and 24 Rust tests, with
two signed-installer artifact tests intentionally skipped. Production frontend
builds passed. The ordinary debug rebuild could not replace an already-running
executable, which was left untouched. After Cargo tests, a separate embedded-assets
debug binary was built with `cargo rustc -p veil-desktop --bin veil-desktop
--features custom-protocol -- -o target/credential-save-validation/veil-desktop-save-check.exe`.
The acceptance harness supports `VEIL_SHARING_DESKTOP_BINARY` for this isolated path.

`pnpm test:sharing` passed on Windows/WebView2 using that binary and the compatible
local server. It verified first-save rejection for missing/rejected credentials
and an unreachable server, no saved origin or key after rejection, a fresh rejected
save despite a prior successful manual test, successful automatic validation and
Save and share, rejected replacement preserving the saved origin and working key,
and denial of saved-key reuse for another origin. Manual testing, active-document
retention, multiple collaborators, overlay scope, themes, and updater guards also
passed. Redacted evidence is under `target/create-share-join/run-ZY3rI3/`; the
credential form layout was visually inspected. After merging the current develop
About-screen update, checks, tests, builds, and native acceptance passed again.
Public HTTPS and unrelated-network
peer/TURN acceptance remain separate. No release was published.

## Hosting server credential test - 10 October 2026

Hosting server Settings now tests the entered origin and credential before saving,
or the saved credential for that exact origin when the field is empty. A scoped
native command checks reusable-sharing support, creates an authenticated temporary
registration, and verifies its deletion. It does not save settings or credentials,
issue an invitation, request relay resources, or change an active document.

Local validation passed `pnpm check`, all 18 TypeScript tests, 24 workspace Rust
tests (two signed-installer artifact tests intentionally skipped), both production
frontend builds, and the rebuilt debug Windows executable. Changed-file lint,
Prettier, rustfmt, and `git diff --check` also passed.

`pnpm test:sharing` passed against the compatible local group-sharing server with
three isolated Windows/WebView2 profiles and dynamically assigned loopback ports.
It checked missing, malformed, and rejected credentials; unreachable origin;
successful unsaved-credential authentication; zero remaining test registrations
and relay grants; unchanged preferences and entered credential; saved-credential
retesting while sharing; retained document/collaborators; and overlay command denial.
The existing create/share/join, edit convergence, reset/stop, themes, overlay, exit,
and updater-session guard regression also passed. Redacted screenshots are under
`target/create-share-join/run-JYczsq/`; the credential-test success layout was
visually inspected. The initial run found an ambiguous test status selector, which
was scoped to the credential form before the passing rerun.

Public HTTPS/certificate failure paths, unrelated-network peers, and TURN
connectivity remain separate acceptance. Success tests server authentication,
not universal peer connectivity. No release was published by this task.

## Change-based CI

PR check selection and gate enforcement are implemented in `scripts/ci-plan.mjs`, with regression cases in `scripts/ci-plan.test.mjs` and `scripts/workflows.test.mjs`. The gate must reject failed/cancelled/missing jobs and any skip not explicitly selected as unnecessary. Unknown paths and dependency/workflow configuration changes select every check. Release validation and nightly CI always run the full suite.

`VEIL_NETWORK_MODE=smoke pnpm test:network` checks one direct and one forced-relay guest, staged fallback, selected ICE paths, concurrent document convergence, presence, session cleanup and TURN allocation cleanup. Run again with `VEIL_TURN_TRANSPORT=tcp` for TURN TCP. Ordinary networking PRs run both transports. The default `pnpm test:network` retains the full six-peer handover/recovery/load/capacity/outage suite; nightly and release validation explicitly use `VEIL_NETWORK_MODE=full`. These are loopback/container tests, not real-internet acceptance.

## Overlay defaults and slider verification - 10 October 2026

Capture exclusion now defaults on for new preferences and legacy files without `captureExclusion`; explicitly saved on/off choices remain unchanged. Overlay range inputs no longer inherit text-field padding, borders or backgrounds, so the 100% opacity track fills to its endpoint. The native capture regression checks the default and slider layout; compositor acceptance explicitly disables capture exclusion before measuring overlay pixels.

`pnpm check`, `pnpm build`, and `pnpm test` passed (18 TypeScript and 24 Rust tests, with two packaged-artifact tests intentionally ignored). The final full test run used `RUST_TEST_THREADS=1`; earlier runs encountered existing updater slow-download/cancellation timing failures while other builds were running. Focused overlay and host Rust tests also passed. Browser and native WebView2 screenshots at 100% were visually inspected.

After rebuilding the debug executable, `pnpm test:capture` passed the enabled default, native affinity, real GDI/DXGI exclusion output, administration isolation, style changes and saved on/off preferences across restart. Evidence: `target/capture-acceptance/run-lZTet8/`, including `opacity-100.png`. The existing installed Veil retained its recovery shortcut, so global shortcut/click-through activation and the full native overlay script were not rerun; control-panel recovery passed. Other capture modes and platform limitations remain as documented in [capture compatibility](capture-compatibility.md). No release was published.

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

[Release workflow 37919381077](https://github.com/ahmad-fatayerji/Veil-source/actions/runs/37919381077) validated and compiled exact merged source `7b5e2513216915b295eb29a4e219d1be9035886a`. The signing job restored the same-run executable artifact, checked its provenance, bundled without recompiling the desktop, and passed real installer signature/version/tamper verification. The first publication attempt stopped on a draft release-by-tag 404 after uploading its assets. Before manual publication, all six downloaded draft assets were verified byte-for-byte against the signed workflow artifact, the legacy source tag, reviewed notes and checksums. The downloaded installer also passed signature and tamper verification locally. The same-run failed-job retry then completed successfully, retained the originally published assets and advanced the beta feed.

Public `v0.2.0` is the latest stable release. Both fixed HTTPS updater endpoints returned `0.2.0`; the unauthenticated public installer download matched SHA-256 `7c9678ca42adab8a4e41b676a8af950688f0ac4d888ab84fd524e2918b841e63`. Evidence: `target/release-acceptance/0.2.0/`. A real installed-client upgrade to 0.2.0, beta-to-stable installation, clean Windows VM, WebView2 bootstrap, SmartScreen and different-network P2P remain separate native acceptance. This publication verified an actual draft failure and recovery, but did not establish that every future automation path is covered.

## M6 release build performance verification — 9 October 2026

The unsigned production executable compiled successfully with locked dependencies and Cargo timing output. In a separate source copy with no frontend `dist`, compiler dependency artifacts or incremental build state, the transferred executable was packaged with `tauri bundle --bundles nsis` and signed using the existing local updater key. Bundling created no `target/release/deps` directory and did not compile the desktop. The new lightweight `veil-release-verifier` artifact test verified that real 0.1.2 installer, checked version binding and rejected a modified byte. The isolated verifier compiled in 14.84s and its test ran in 0.45s on this workstation; these are local results, not GitHub runner estimates. Evidence: `target/bundle-acceptance/ba21f2f431fd4a4eab882779a1e915f6`, `target/verifier-local/cargo-timings/` and `target/cargo-timings/`.

Formatting, ESLint, typechecking, all nine TypeScript tests, all 17 release/workflow tests, Rust formatting/Clippy, all eleven Rust unit tests, the locked Windows debug build and all four browser regressions passed. `actionlint` validated the workflow syntax and expressions. The new tests cover source/version/run/attempt/checksum mismatch, missing executable, same-run retry acceptance, overlapping compilation and validation, and mandatory gates before signing/publication.

Hosted cold/warm performance, same-run GitHub artifact transfer/retry and end-to-end publication through the revised workflows remain unverified. No release was published during local validation. Existing clean-VM, WebView2-bootstrap and native internet/capture limitations below still apply.

## M6 distribution verification — 9 October 2026

Production Windows x64 NSIS installers and mandatory updater signatures built successfully. These releases used separate source and distribution repositories; source, installers and updates now live in public `ahmad-fatayerji/veil`. Version 0.1.0 and 0.1.1 have public release assets and HTTPS update metadata.

`pnpm test:installer` verified actual per-user installation to a temporary path, installed production editor/overlay, native rejection of updater administration from the overlay, refusal to install during a peer document session, clean close, maintenance reinstall and retained opacity/font preferences. Original device preferences were restored and the temporary app uninstalled. Evidence: `target/installer-acceptance/run-2mAgB1`.

`node scripts/test-installer.mjs target/release/bundle/nsis/Veil_0.1.0_x64-setup.exe 0.1.1` verified a real signed HTTPS GitHub update, installer execution, automatic relaunch at 0.1.1 and retained overlay preferences. Evidence: `target/installer-acceptance/run-5BvhYp`. The test closes visible overlay/control windows in sequence before reinstalling, so an overlay-only close cannot leave the app running.

The ignored artifact test was explicitly run against both actual setup packages using `VEIL_TEST_INSTALLER`: the embedded public key verifies the real signature/version, and changing one installer byte causes signature verification failure. It requires packaged artifacts and is intentionally separate from ordinary unit tests. Native P2P acceptance passed again after updater/session tracking changes (`target/peer-acceptance/run-KALkRl`). Nine TypeScript and ten Rust unit tests passed; all four browser regressions passed. A clean Windows VM, absent-WebView2 bootstrap, Authenticode/SmartScreen trust, real different-network P2P and TURN remain unverified. No document persistence or recovery across updates is claimed.

The source release workflow builds and creates drafts in the public repository, refuses overwriting published versions, and requires a token scoped to the public release repository. Signing secrets were scoped to the legacy publisher; they now remain limited to publication jobs in the unified repository. GitHub Actions execution is recorded separately from local validation.

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
