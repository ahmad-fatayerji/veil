import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoApp, applyAppearance } from '@veil/ui';
import '@veil/ui/styles.css';

applyAppearance();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoApp surface="browser" allowDemo={import.meta.env.DEV} />
  </StrictMode>,
);
