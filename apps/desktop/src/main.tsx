import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@veil/ui/styles.css';
import { OverlayWindow } from './overlay/OverlayWindow';
import './overlay/styles.css';
import { DesktopApp } from './DesktopApp';

const isOverlay = new URLSearchParams(window.location.search).has('overlay');
if (isOverlay) document.documentElement.classList.add('overlay-mode');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOverlay ? <OverlayWindow /> : <DesktopApp />}</StrictMode>,
);
