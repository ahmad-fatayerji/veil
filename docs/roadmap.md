# Development roadmap

Local collaboration (M0) and the Windows overlay (M1) are built. The Roadmap button shows these milestones. Sessions run on this computer, documents are held in memory, and the overlay edits the same live document as the control panel.

| Milestone                           | Status  | Remaining work                                                                                                  |
| ----------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| M0: Local collaboration             | Built   | Local browser, desktop and overlay convergence is verified.                                                     |
| M1: Desktop overlay                 | Built   | Live shared-document editing, drag/resize, opacity, topmost, click-through, recovery, and saved local settings. |
| M2: Host and invite friends         | Next    | App-managed host lifecycle, bundled browser assets, invitations, and LAN joining.                               |
| M3: Permissions and saved documents | Planned | Roles, optional participant limits, desktop guests, and durable document storage.                               |
| M4: Capture compatibility           | Planned | Best-effort capture exclusion and a tested compatibility matrix; universal exclusion cannot be guaranteed.      |
| M5: Secure remote access            | Planned | Explicit remote hosting, TLS, access control, abuse protection, and network reachability.                       |
| M6: Installers and updates          | Planned | Distributable installers and update delivery.                                                                   |

Milestone requirements and acceptance criteria are in [PROJECT_SPEC.md](../PROJECT_SPEC.md). Closing the current host loses the document. The activity panel describes editor interaction; it does not observe other applications.
