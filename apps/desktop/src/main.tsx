import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@veil/ui/styles.css';
import './overlay/styles.css';
import { applyAppearance, setSystemAccent } from '@veil/ui/appearance';
import { invoke } from '@tauri-apps/api/core';
import { syncThemeIcon } from './theme-icon';

applyAppearance();
const isOverlay = new URLSearchParams(window.location.search).has('overlay');
if (isOverlay) document.documentElement.classList.add('overlay-mode');
else {
  syncThemeIcon();
  // Read the Windows accent now and whenever Veil regains focus, so changes made in
  // Windows Settings apply; other windows receive the palette through storage events.
  const refreshAccent = () =>
    void invoke<string[] | null>('system_accent')
      .then(setSystemAccent)
      .catch(() => {});
  refreshAccent();
  window.addEventListener('focus', refreshAccent);
}

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
