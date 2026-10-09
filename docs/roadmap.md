# Development roadmap

The local collaboration foundation (M0) is built, with a minimal editor, named remote cursors, colored selections, and participant activity. The Roadmap button in the app shows these milestones. This is still a development demo: sessions run on this computer and documents are held in memory.

| Milestone                           | Status  | Remaining work                                                                                             |
| ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| M0: Local collaboration             | Built   | Native WebView visual and desktop-to-browser checks remain manual.                                         |
| M1: Desktop overlay                 | Next    | Move/resize, opacity, always on top, click-through, recovery shortcut, and local preferences.              |
| M2: Host and invite friends         | Planned | App-managed host lifecycle, bundled browser assets, invitations, and LAN joining.                          |
| M3: Permissions and saved documents | Planned | Roles, optional participant limits, desktop guests, and durable document storage.                          |
| M4: Capture compatibility           | Planned | Best-effort capture exclusion and a tested compatibility matrix; universal exclusion cannot be guaranteed. |
| M5: Secure remote access            | Planned | Explicit remote hosting, TLS, access control, abuse protection, and network reachability.                  |
| M6: Installers and updates          | Planned | Distributable installers and update delivery.                                                              |

Milestone requirements and acceptance criteria are in [PROJECT_SPEC.md](../PROJECT_SPEC.md). Closing the current host loses the document. The activity panel describes editor interaction; it does not observe other applications.
