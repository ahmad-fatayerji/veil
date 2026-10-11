# README media

These images and GIFs were captured on Windows on 11 October 2026 from real
Veil desktop WebView2 windows, using disposable demo profiles and documents.
Alex and Sam are demo participant names. Two native instances joined the same
session through a local, loopback-only Veil server; guest edits were verified
in the host document before capture.

The capture used the migration acceptance debug executable. Its desktop,
editor, and shared UI source matches public `develop` at `9e84315`; the older
debug package version is not shown in the media. The installed user app was
left running and its documents and preferences were not used.

| Asset                  | Content                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `welcome.png`          | Create document / Join session welcome screen, dark theme.        |
| `workspace.png`        | Shared checklist with two connected participants.                 |
| `write-together.gif`   | Host writing, followed by a guest edit reaching the host.         |
| `overlay.png`          | The same document in the overlay, with participant activity.      |
| `live-overlay.gif`     | Overlay font-size changes applied by the native settings command. |
| `overlay-settings.png` | A focused capture of the actual overlay controls.                 |

GIFs encode sequential app screenshots with a pause at the end; playback is
condensed. They show the app's window contents, not a full desktop recording
or evidence of capture exclusion, transparency, or shortcut registration.
The installed app retains the global shortcuts, so the separate demo instance
cannot register them. No private documents, invitations, or host credentials
are included in the published media.

To refresh these assets, use an isolated native debug profile with the existing
Windows/WebView2 acceptance harness described in [testing](../testing.md).
Use fictional content, verify both peers receive edits, inspect every image,
and keep the encoded GIFs small enough to load comfortably in a README.
