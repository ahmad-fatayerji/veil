# Windows capture compatibility

Veil can request best-effort exclusion of its overlay from compatible Windows capture paths. This is an optional, local setting, on by default. It does not protect the control panel, prevent photographing the screen or certify every recorder/sharing tool. The overlay stays visible and editable on the local desktop. Test the output you intend to use before sharing sensitive content.

## Native behavior and status

**Desktop overlay → Settings → Exclude overlay from compatible captures** saves `captureExclusion` with local overlay preferences. New settings and old files without this preference default to on. An explicitly saved on/off choice is preserved. It never enters the shared document. The Rust Windows adapter uses the app-owned top-level overlay HWND with `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` and checks `GetWindowDisplayAffinity` against the requested value. Disabling requests and confirms `WDA_NONE`.

The adapter checks the actual Windows version using `RtlGetVersion` and requires Windows 10 build 19041 (version 2004) or newer and active DWM composition. Older Windows is unsupported; it does not silently fall back to `WDA_MONITOR`, which can produce a black window in captures. macOS/Linux report unsupported. A failed capability query reports unknown. These platform fallbacks have unit/design coverage rather than runtime acceptance on old/non-Windows machines.

The displayed status is separate from the saved preference:

| Status      | Meaning                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Off         | Windows confirmed exclusion is disabled.                                                                                        |
| Applied     | Windows accepted the requested affinity and readback matched. This does not prove any particular recorder excludes the overlay. |
| Unsupported | The OS/composition/platform cannot support this request.                                                                        |
| Error       | Setting or readback failed, or readback differs. The overlay may be captured. Recheck/reapply or turn off the preference.       |

The native failure reason is displayed. A requested preference can remain on after failure so the user can retry; it is never presented as successfully applied. Failures do not disable unrelated overlay controls. Showing the window, recovery, opacity and toolkit style changes reapply/read back affinity. **Recheck native setting** only queries current capability/affinity and does not run a recorder. Only the control panel can change/check capture settings or display the test card; the overlay can read status. No caller supplies an HWND.

## Manual procedure

1. Use a test document without secrets. In overlay Settings open **Capture compatibility test** and **Show test card**. The yellow/blue `VEIL CAPTURE TEST` card is local and temporary; it hides the overlay editor without editing the shared document. **Return to document** restores the view, and app restart clears the card.
2. Record Windows build, display/DPI/GPU setup, tool version and exact capture mode. Distinguish full display, individual window, game capture, WGC, DXGI/Desktop Duplication and GDI/BitBlt. Start with exclusion off.
3. Capture the display containing the overlay. Inspect a saved recording/screenshot or another device's remote view and confirm the card appears. A missing baseline card makes the test inconclusive.
4. Enable exclusion and check native status. Repeat without changing tool, source or mode. Inspect the actual output: **excluded** (underlying content visible), **visible**, **blank/black**, **failure**, or **not tested**. A local preview or successful native call alone is insufficient. Verify the control panel remains capturable.
5. Repeat at different opacity, topmost/click-through settings, hide/show and shortcut recovery. Move/resize and, where available, test multiple monitors/DPI. Close and restart Veil; verify the saved preference and current status, then capture again. Disable exclusion and confirm the card returns to output.
6. Repeat separately for each mode/tool after updates or hardware changes. Record results and evidence paths below. Blank/black or visible output is a limitation, not successful exclusion.

## Compatibility matrix

Results are specific to the recorded machine/tool/mode. Untested rows are not supported-mode claims.

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

To exercise installed OBS without touching normal profiles/scenes, copy its installation or unpack an official portable build into this worktree's `target/obs-portable`, then set `$env:VEIL_TEST_OBS_PORTABLE = "$PWD/target/obs-portable"` and run `pnpm test:capture` again. Remove the environment variable afterwards. The fixture only accepts a disposable copy under this worktree's `target`, enables portable mode, creates its own disposable profile/scenes, disables websocket control/auto-updates, records the cropped overlay test area and closes its own OBS process. It confirms the selected capture method in OBS logs and checks recorded frames. Local artifact paths are ignored by Git.

API references: [SetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity), [GetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowdisplayaffinity), [DWM composition](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmiscompositionenabled), [RtlGetVersion](https://learn.microsoft.com/en-us/windows/win32/devnotes/rtlgetversion), [OBS portable mode](https://obsproject.com/kb/portable-mode), and [OBS launch parameters](https://obsproject.com/kb/launch-parameters).

If another Veil instance owns the global shortcuts, capture acceptance reports that exception and tests control-panel recovery instead. Its results record that global shortcuts/click-through activation were unverified; the full overlay regression requires those instances to be closed. The final recorded run acquired the shortcuts and verified both paths.
