import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@veil/ui/styles.css';
import './overlay/styles.css';
import { applyAppearance } from '@veil/ui/appearance';

applyAppearance();
const isOverlay = new URLSearchParams(window.location.search).has('overlay');
if (isOverlay) document.documentElement.classList.add('overlay-mode');

// Each webview loads its own surface without evaluating the other window's app.
const App = lazy(() =>
  isOverlay
    ? import('./overlay/OverlayWindow').then(({ OverlayWindow }) => ({ default: OverlayWindow }))
    : import('./DesktopApp').then(({ DesktopApp }) => ({ default: DesktopApp })),
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<p role="status">Loading Veil…</p>}>
      <App />
    </Suspense>
  </StrictMode>,
);
