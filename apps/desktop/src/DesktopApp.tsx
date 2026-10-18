import { lazy, Suspense, useEffect, useState } from 'react';
import { invoke } from './overlay/api';

const AutomaticApp = lazy(() =>
  import('./AutomaticApp').then(({ AutomaticApp }) => ({ default: AutomaticApp })),
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
  // Resolve the saved mode before mounting either app and starting its effects.
  const loading = <p role="status">Loading Veil…</p>;
  if (legacy === null) return loading;
  return <Suspense fallback={loading}>{legacy ? <LegacyApp /> : <AutomaticApp />}</Suspense>;
}
