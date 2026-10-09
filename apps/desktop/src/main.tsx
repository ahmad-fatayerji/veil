import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoApp } from '@veil/ui';
import '@veil/ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoApp surface="desktop" />
  </StrictMode>,
);
