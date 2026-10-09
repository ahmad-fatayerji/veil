import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoApp } from '@veil/ui';
import '@veil/ui/styles.css';
import { OverlayControls } from './overlay/Controls';
import { OverlayWindow } from './overlay/OverlayWindow';
import './overlay/styles.css';
import { DesktopEditor, SessionBridge } from './overlay/session';

const isOverlay = new URLSearchParams(window.location.search).has('overlay');
if (isOverlay) document.documentElement.classList.add('overlay-mode');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOverlay ? (
      <OverlayWindow />
    ) : (
      <DemoApp
        surface="desktop"
        renderEditor={(connection) => (
          <DesktopEditor key={connection.doc.clientID} connection={connection} />
        )}
        desktopControls={(connection) => (
          <>
            <SessionBridge connection={connection} />
            <OverlayControls />
          </>
        )}
      />
    )}
  </StrictMode>,
);
