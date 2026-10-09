# Development roadmap

Local collaboration (M0), the Windows overlay (M1), and embedded hosting with browser invitations (M2) are implemented. Second-device LAN verification remains manual. The Roadmap button shows these milestones. Sessions can run on loopback or an explicitly selected trusted LAN interface, documents are held in memory, and the overlay edits the same live document as the control panel.

| Milestone                           | Status      | Remaining work                                                                                                        |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| M0: Local collaboration             | Built       | Local browser, desktop and overlay convergence is verified.                                                           |
| M1: Desktop overlay                 | Built       | Live shared-document editing, drag/resize, opacity, topmost, click-through, recovery, and saved local settings.       |
| M2: Host and invite friends         | Built       | App-managed host lifecycle, bundled browser assets, invitations, and LAN joining; second-device check remains manual. |
| P1: Desktop peer connections        | Built       | Direct native sync verified; actual internet and authenticated relay checks remain manual.                            |
| M3: Permissions and saved documents | Next        | Roles, optional participant limits and durable document storage.                                                      |
| M4: Capture compatibility           | Planned     | Best-effort capture exclusion and a tested compatibility matrix; universal exclusion cannot be guaranteed.            |
| M5: Secure remote access            | Planned     | Explicit remote hosting, TLS, access control, abuse protection, and network reachability.                             |
| M6: Installers and updates          | In progress | Installer and signed GitHub updates work locally; clean-VM acceptance remains manual.                                 |

Milestone requirements and acceptance criteria are in [PROJECT_SPEC.md](../PROJECT_SPEC.md). Closing the current host loses the document. The activity panel describes editor interaction; it does not observe other applications.

## P1 — Desktop P2P migration

Primary mode now uses manual invitation/response codes and encrypted WebRTC data channels, with optional self-hosted STUN/TURN. Shared editing, presence and local overlays reuse existing components. LAN/browser hosting remains available. Automatic signaling, host-independent mesh, permissions, document persistence and real different-network/relay acceptance remain later work. Installer distribution is now M6; see [releasing](releasing.md).
