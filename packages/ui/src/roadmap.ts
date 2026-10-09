export const roadmap = [
  {
    id: 'M0',
    title: 'Local collaboration',
    status: 'Built',
    detail:
      'Desktop and browser editor, live editing, reconnect, named cursors, selections, and activity. Sessions currently run on this computer only.',
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
    status: 'Next',
    detail:
      'Start and stop hosting from the app. Serve the browser editor, create invitations, and join from another device on your LAN.',
  },
  {
    id: 'M3',
    title: 'Permissions and saved documents',
    status: 'Planned',
    detail:
      'Viewer and editor roles, optional participant limit, desktop guests, document persistence, and recovery after host restart.',
  },
  {
    id: 'M4',
    title: 'Capture compatibility',
    status: 'Planned',
    detail:
      'Best-effort Windows capture exclusion and a compatibility test. It cannot guarantee exclusion from every recording or sharing tool.',
  },
  {
    id: 'M5',
    title: 'Secure remote access',
    status: 'Planned',
    detail:
      'Explicit HTTPS/WSS setup, access controls, abuse protection, and reconnection tests. Direct connectivity still depends on your network.',
  },
  {
    id: 'M6',
    title: 'Installer and updates',
    status: 'Planned',
    detail:
      'Windows installer, signed updates, release workflow, and an update screen that respects active sessions.',
  },
] as const;
