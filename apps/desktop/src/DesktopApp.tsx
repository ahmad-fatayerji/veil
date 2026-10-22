import { lazy, Suspense, useEffect, useState } from 'react';
import { invoke } from './overlay/api';
import { listen } from '@tauri-apps/api/event';

const AutomaticApp = lazy(() =>
  import('./workspace').then(({ DocumentWorkspace }) => ({ default: DocumentWorkspace })),
);
const LegacyApp = lazy(() =>
  import('./LegacyApp').then(({ LegacyApp }) => ({ default: LegacyApp })),
);

export function DesktopApp() {
  const [legacy, setLegacy] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void invoke<{ legacy: boolean }>('network_preferences')
      .then((settings) => {
        if (active) setLegacy(settings.legacy);
      })
      .catch(() => {
        if (active) setLegacy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!legacy) return;
    const subscription = listen('app-quit-requested', () => {
      // Retain the existing shutdown contract of the legacy regression surfaces.
      void invoke('app_complete_quit');
    });
    return () => {
      void subscription.then((stop) => stop()).catch(() => {});
    };
  }, [legacy]);
  // Resolve the saved mode before mounting either app and starting its effects.
  // Announced to assistive technology only; startup shows just the window background.
  const loading = (
    <p role="status" className="visually-hidden">
      Loading Veil…
    </p>
  );
  if (legacy === null) return loading;
  return <Suspense fallback={loading}>{legacy ? <LegacyApp /> : <AutomaticApp />}</Suspense>;
}
