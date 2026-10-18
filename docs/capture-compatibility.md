# Windows capture compatibility

Veil can request best-effort exclusion of its overlay from compatible Windows capture paths. This is an optional, local setting, on by default. It does not protect the control panel, prevent photographing the screen or certify every recorder/sharing tool. The overlay stays visible and editable on the local desktop. Test the output you intend to use before sharing sensitive content.

## Native behavior and status

**Desktop overlay → Settings → Exclude overlay from compatible captures** saves `captureExclusion` with local overlay preferences. New settings and old files without this preference default to on. An explicitly saved on/off choice is preserved. It never enters the shared document. The Rust Windows adapter uses the app-owned top-level overlay HWND with `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` and checks `GetWindowDisplayAffinity` against the requested value. Disabling requests and confirms `WDA_NONE`.

The adapter checks the actual Windows version using `RtlGetVersion` and requires Windows 10 build 19041 (version 2004) or newer and active DWM composition. Older Windows is unsupported; it does not silently fall back to `WDA_MONITOR`, which can produce a black window in captures. macOS/Linux report unsupported. A failed capability query reports unknown. These platform fallbacks have unit/design coverage rather than runtime acceptance on old/non-Windows machines.

When applying enabled exclusion, the adapter requests `WDA_EXCLUDEFROMCAPTURE` directly and verifies the final affinity. It does not transition through `WDA_MONITOR`, which deliberately produces black capture output. The earlier issue #22 mitigation used that intermediate transition, but the affected user reported that it did not resolve Discord full-desktop sharing. Read-only checks do not change affinity or refresh the surface.

On first show, subsequent show, explicit enable/reapply, and always-on-top or click-through updates, a visible Windows overlay briefly hides its existing HWND and recreates its `WS_EX_LAYERED` style, then restores saved opacity and confirms exclusion before showing it. This mirrors the layer reset in manual Tauri hide/show: Tao rebuilds extended styles from its own flags, dropping Veil's manually added layered style when click-through is off. A native `ShowWindow` hide/show alone leaves that layer intact. The first PR #43 candidate only changed visibility; the user reported that **Reapply setting** still failed while manual hide/wait/show worked with Discord sharing started before Veil. On 12 October 2026, the user reported that the revised layer-reset build appears to resolve that Discord full-desktop sharing case. This is user acceptance for the reported case; the revision has not undergone independent native capture acceptance or broader tool/hardware verification.

The adapter uses `DwmFlush` presentation waits, but these do not acknowledge Discord's capture frames. A hidden overlay stays hidden. If layer recreation, opacity restoration or exclusion confirmation fails after hiding, the overlay stays hidden and its saved visibility and capture status reflect the failure. If the initial hidden presentation wait fails before layer recreation, the original protected layer is shown again and the error is reported. Activation is restored only if the overlay was already in the foreground. Opacity-only and font-size updates do not perform this visibility cycle. Toolkit style updates use the same layer rebuild as explicit reapply because affinity readback alone cannot confirm that a replaced capture surface recovered. This additional style-update recovery has not undergone native capture acceptance.

**Reapply setting** is available with exclusion enabled even when native status is **Applied**. Use it if the captured output is black; it rebuilds the layer while hidden, without requesting `WDA_NONE`, and verifies exclusion before showing it. **Recheck native setting** remains a read-only check. A brief local disappearance during refresh is expected; successful readback still does not establish capture-tool compatibility.

For an affected-machine investigation, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/diagnose-capture.ps1 -Seconds 60` while reproducing the problem. The read-only script records overlay HWNDs, visibility, layered/redirected styles, alpha, affinity and process/build metadata under `target/capture-diagnostics/`. It does not capture pixels, read documents or change windows/preferences. Note when Discord shows black, when **Reapply setting** is used, and when manual hide/wait/show is used. Compare before/after states and the actual remote output; equal native states do not rule out a recorder-specific surface or timing problem. Sampling can miss very short transitions. Add `-AppProcessId <pid>` if multiple Veil instances are running.

The displayed status is separate from the saved preference:

| Status      | Meaning                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Off         | Windows confirmed exclusion is disabled.                                                                                        |
| Applied     | Windows accepted the requested affinity and readback matched. This does not prove any particular recorder excludes the overlay. |
| Unsupported | The OS/composition/platform cannot support this request.                                                                        |
| Error       | Setting or readback failed, or readback differs. The overlay may be captured. Recheck/reapply or turn off the preference.       |

The native failure reason is displayed. A requested preference can remain on after failure so the user can retry; it is never presented as successfully applied. Failures do not disable unrelated overlay controls. Showing the window, recovery, opacity and toolkit style changes reapply/read back affinity. **Recheck native setting** only queries current capability/affinity and does not run a recorder. Only the control panel can change/check capture settings or display the test card; the overlay can read status. No caller supplies an HWND.

Windows overlay header and edge gestures update the overlay HWND directly rather than entering the system move/size loop. This avoids a separate desktop outline or snap preview that would not inherit the overlay's capture affinity, including when **Show window contents while dragging** is disabled. The app does not change that Windows preference. Dragging no longer invokes Windows snap previews; resizing retains the scaled minimum size. Release outside the overlay, hiding it or changing focus ends the gesture; Escape restores its starting bounds. Other platforms retain toolkit gestures.

While the saved capture-exclusion preference is on, move/resize handles use the normal arrow. A compact header badge shows **Move** or **Resize** with the direction on hover and throughout the gesture; the active action takes precedence over hover. The arrow also applies over overlay content during a gesture. Idle editing keeps its text cursor, and disabling the preference restores ordinary move/resize cursors. The badge identifies an action, not capture protection. Veil does not change global cursor settings or other apps' cursors; a recorder may still include the normal pointer.

## Manual procedure

1. Use a test document without secrets. In overlay Settings open **Capture compatibility test** and **Show test card**. The yellow/blue `VEIL CAPTURE TEST` card is local and temporary; it hides the overlay editor without editing the shared document. **Return to document** restores the view, and app restart clears the card.
2. Record Windows build, display/DPI/GPU setup, tool version and exact capture mode. Distinguish full display, individual window, game capture, WGC, DXGI/Desktop Duplication and GDI/BitBlt. Start with exclusion off.
3. Capture the display containing the overlay. Inspect a saved recording/screenshot or another device's remote view and confirm the card appears. A missing baseline card makes the test inconclusive.
4. Enable exclusion and check native status. Repeat without changing tool, source or mode. Inspect the actual output: **excluded** (underlying content visible), **visible**, **blank/black**, **failure**, or **not tested**. A local preview or successful native call alone is insufficient. Verify the control panel remains capturable.
5. Repeat at different opacity, topmost/click-through settings, hide/show and shortcut recovery. Move/resize and, where available, test multiple monitors/DPI. Close and restart Veil; verify the saved preference and current status, then capture again. Disable exclusion and confirm the card returns to output.
6. Repeat separately for each mode/tool after updates or hardware changes. Record results and evidence paths below. Blank/black or visible output is a limitation, not successful exclusion.

## Compatibility matrix

Results are specific to the recorded machine/tool/mode. Untested rows are not supported-mode claims.

11 October 2026 moving-window regression: FFmpeg 7.1 GDI and DXGI captures on Windows 10.0.26300 excluded the card during held header/corner gestures, with the underlying app visible and no outline across the captured overlay perimeter. Windows full-window dragging was disabled for each fixture gesture and its prior value restored afterwards. Evidence: `target/capture-acceptance/run-pfT6CH/`. These results do not extend the earlier OBS observations to moving-window capture or remote viewers.

| Tool / mode                                            | Windows / tool version          | Off baseline | On output                        | Status / evidence                                              |
| ------------------------------------------------------ | ------------------------------- | ------------ | -------------------------------- | -------------------------------------------------------------- |
| FFmpeg GDI desktop capture (`gdigrab`)                 | Windows 10.0.26300 / FFmpeg 7.1 | Card visible | Excluded; underlying app visible | 10 October 2026: `target/capture-acceptance/run-HbIVUA/`.      |
| FFmpeg DXGI Desktop Duplication (`ddagrab`)            | Windows 10.0.26300 / FFmpeg 7.1 | Card visible | Excluded; underlying app visible | 10 October 2026: `target/capture-acceptance/run-HbIVUA/`.      |
| OBS Display Capture / DXGI                             | Windows 10.0.26300 / OBS 32.0.4 | Card visible | Excluded; underlying app visible | Recorded frames/logs: `target/capture-acceptance/run-HbIVUA/`. |
| OBS Display Capture / Windows Graphics Capture         | Windows 10.0.26300 / OBS 32.0.4 | Card visible | Excluded; underlying app visible | Recorded frames/logs: `target/capture-acceptance/run-HbIVUA/`. |
| OBS Window Capture / WGC or BitBlt                     | Not recorded                    | Not tested   | Not tested                       | Manual; test the selected overlay/window explicitly.           |
| OBS Game Capture / third-party overlays                | Not recorded                    | Not tested   | Not tested                       | Manual; separate hook-based path.                              |
| Windows Snipping Tool / screenshot and recording       | Not recorded                    | Not tested   | Not tested                       | Manual; distinguish each mode.                                 |
| Teams / entire screen and individual window            | Not recorded                    | Not tested   | Not tested                       | Requires actual remote viewer.                                 |
| Discord / entire screen and individual window          | Not recorded                    | Not tested   | Not tested                       | Requires actual remote viewer.                                 |
| Older Windows, remote desktop, other GPUs/monitors/DPI | Not recorded                    | Not tested   | Not tested                       | Additional hardware/OS acceptance.                             |

## Automated native acceptance

On an interactive Windows desktop with FFmpeg supporting `gdigrab` and `ddagrab`, close other Veil test instances, free loopback port 9225 and avoid input during the run:

```powershell
pnpm check
pnpm test
# Always rebuild after Cargo tests.
pnpm --filter @veil/desktop exec -- tauri build --debug --no-bundle
pnpm test:capture
pnpm test:overlay
```

The capture script uses real WebView2 controls, a separate colored WinForms underlay and actual capture output. It confirms a visible baseline card and its removal with underlying pixels retained, HWND affinity, control-panel scope, forbidden overlay administration, style/recovery/show changes, persisted opt-in/out, ephemeral test card and absence of JavaScript errors. Preferences/WebView2 profiles and evidence are isolated under `target/capture-acceptance/`. No networking session or operator server is needed. It does not run in hosted CI because it requires an interactive desktop/GPU and external capture tooling.

Before any off/on toggle, the script also checks actual output with the default-on preference at first show, hide/show and appearance changes. It captures again after restarting with saved exclusion enabled. The individual opacity, always-on-top and click-through updates also check captured pixels before any hide/show or explicit reapply can repair the surface. These checks require the underlying app across at least 97% of the overlay area, so a black rectangle cannot pass merely because the test card is absent. Discord remote-view verification on the originally affected machine remains separate.

`pnpm test:capture --startup-only` runs the capture, appearance, authorization, document editing and preference-restart checks without the physical pointer/gesture/cursor checks or global recovery shortcut. Its results explicitly mark global shortcut/click-through verification false. Both modes still require a quiet desktop; unrelated windows obscuring the known underlay make pixel comparisons inconclusive.

The GDI and DXGI regressions enable cursor recording and hold real move/resize gestures open while capturing. They check that bounds change before mouse release, inspect the overlay perimeter for leaked outlines, verify that the recorded arrow remains visible and check the header badge's region for the underlying app. Native `GetCursorInfo` probes verify hover/active cursor shapes, all eight resize handles, ordinary cursors with exclusion off and idle text cursors. The script also checks completion, Escape, focus loss, a real concurrent-gesture rejection, hover cleanup, hide/show, click-through/recovery, badge layout at minimum size and editing. The fixture temporarily disables Windows full-window dragging and restores its previous value in `finally`; avoid other pointer input during the run. OBS and remote sharing tools still need separate moving-window acceptance.

If an existing session locks the normal executable, build an isolated debug executable after the frontend build and Cargo tests with `cargo rustc -p veil-desktop --bin veil-desktop --features custom-protocol -- -o target/cursor-validation/veil-desktop-cursor-check.exe` (create the output directory first), then set `VEIL_CAPTURE_TEST_EXE` to that path. Leave `VEIL_CAPTURE_GESTURES` unset for complete acceptance; setting it to comma-separated handle names only narrows the held-gesture checks for diagnosis.

To exercise installed OBS without touching normal profiles/scenes, copy its installation or unpack an official portable build into this worktree's `target/obs-portable`, then set `$env:VEIL_TEST_OBS_PORTABLE = "$PWD/target/obs-portable"` and run `pnpm test:capture` again. Remove the environment variable afterwards. The fixture only accepts a disposable copy under this worktree's `target`, enables portable mode, creates its own disposable profile/scenes, disables websocket control/auto-updates, records the cropped overlay test area and closes its own OBS process. It confirms the selected capture method in OBS logs and checks recorded frames. Local artifact paths are ignored by Git.

API references: [SetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity), [GetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowdisplayaffinity), [DWM composition](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmiscompositionenabled), [RtlGetVersion](https://learn.microsoft.com/en-us/windows/win32/devnotes/rtlgetversion), [OBS portable mode](https://obsproject.com/kb/portable-mode), and [OBS launch parameters](https://obsproject.com/kb/launch-parameters).

If another Veil instance owns the global shortcuts, capture acceptance reports that exception and tests control-panel recovery instead. Its results record that global shortcuts/click-through activation were unverified; the full overlay regression requires those instances to be closed. The final recorded run acquired the shortcuts and verified both paths.
