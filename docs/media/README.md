# README media

These screenshots and GIFs were captured on Windows with WebView2 on 22 October
2026 from the **Veil 1.0.0 candidate (`1.0.0-beta.1`)**, release source
`cda58af6624883d3e5a2b42b51719310d03ed374` (`release/1.0.0`). This is candidate
media, not a claim that final 1.0.0 has been published.

The native debug executable was built from an archive of that exact commit in
this task's ignored capture directory. Its frontend was served from the same
archived candidate source. Both the native version and the About version label
were checked and reported `1.0.0-beta.1`. No app interface or participant state
was mocked.

Alex and Sam are fictional participants using disposable profiles and demo
Markdown documents. Two actual native instances joined through a loopback-only
Veil server; guest edits were observed at the host, and the host's reply was
observed at the guest. This demonstrates local collaboration, not internet or
TURN connectivity. The installed user app, files, and preferences were not used.
Discord activity was disabled in the disposable profiles. Demo recovery shortcuts
use F11/F12 combinations to avoid taking the installed app's global shortcuts;
these are not the product defaults.

| Asset                  | Content                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `welcome.png`          | Current welcome screen with New document, Open document, and Join with a link.  |
| `workspace.png`        | Dark workspace, two tabs, shared launch checklist, and People panel.            |
| `workspace-light.png`  | Shared launch notes in the light theme.                                         |
| `markdown.png`         | Meeting notes in the Markdown source editor.                                    |
| `markdown-editing.gif` | Switching views, adding Markdown next steps, and checking an item in rich text. |
| `write-together.gif`   | Sam's live edits, Alex checking a shared task, and Alex's reply.                |
| `overlay.png`          | Editable Meeting notes overlay with the compact formatting toolbar.             |
| `live-overlay.gif`     | Native font-size changes and the overlay following document tab switches.       |
| `overlay-settings.png` | Independent opacity sliders, font size, and formatting controls.                |
| `hosting-settings.png` | Public hosting choice and its resource limits.                                  |

Screenshots capture actual app window contents. Settings images crop to the actual
settings dialog. Live invitation text is masked with a solid gray rectangle;
no usable links or credentials are published. The demo sessions were ended after
capture. No document content or controls were added through image editing.

GIFs encode sequential screenshots from real interactions, using a shared palette,
a condensed timeline, and longer first/last frames. They show UI behavior, not a
desktop recording or evidence of capture exclusion, desktop transparency, or
shortcut registration. Each GIF is below 350 KiB. The PNGs and representative
decoded GIF frames were visually inspected before publication.

To refresh, use candidate/release source and isolated debug profiles following
the Windows/WebView2 harness in [testing](../testing.md). Check the native and UI
version labels, use fictional content, verify edits reach both peers, mask every
invitation, and inspect the resulting images and GIF frames. Do not use the
installed app's documents, credentials, or preferences.
