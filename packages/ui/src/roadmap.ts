export const roadmap = [
  {
    id: 'M0',
    title: 'Local collaboration',
    status: 'Built',
    detail:
      'Desktop and browser editor, live editing, reconnect, named cursors, selections, and activity. The local development demo remains available.',
  },
  {
    id: 'M1',
    title: 'Desktop overlay',
    status: 'Built',
    detail:
      'Edit the live shared document in a separate Windows overlay. Drag/resize, opacity, always on top, click-through, recovery shortcuts, and saved local preferences.',
  },
  {
    id: 'M2',
    title: 'Host and invite friends',
    status: 'Built',
    detail:
      'Start and stop hosting from the app. Serve the browser editor, create invitations, and join from another device on your LAN.',
  },
  {
    id: 'P1',
    title: 'Desktop peer connections',
    status: 'Built',
    detail:
      'Encrypted desktop peer editing with invitation/response codes and optional self-hosted STUN/TURN. Direct transport verified locally; different-network and relay checks remain manual.',
  },
  {
    id: 'P2',
    title: 'Automatic connections and relay',
    status: 'Built',
    detail:
      'Self-hosted signaling, one-paste invitations and selective per-connection TURN fallback. Mixed direct/relay transport is verified locally; unrelated-network acceptance remains manual.',
  },
  {
    id: 'M3',
    title: 'Permissions and saved documents',
    status: 'Next',
    detail:
      'Viewer and editor roles, optional participant limit, document persistence, and recovery after host restart.',
  },
  {
    id: 'M4',
    title: 'Capture compatibility',
    status: 'Built',
    detail:
      'Opt-in Windows capture exclusion, native status and a local test card. GDI, DXGI and OBS display capture verified locally; other sharing/recording modes remain manual. Exclusion is never universal.',
  },
  {
    id: 'M5',
    title: 'Secure remote access',
    status: 'Planned',
    detail:
      'Internet and self-hosted relay acceptance, reconnection improvements, access controls and abuse protection. Connectivity still depends on your network.',
  },
  {
    id: 'M6',
    title: 'Installer and updates',
    status: 'In progress',
    detail:
      'Windows installer, signed GitHub update packages and a session-safe update screen. Clean-machine and release acceptance are tracked separately.',
  },
] as const;
