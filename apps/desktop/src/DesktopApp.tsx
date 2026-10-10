import { useEffect, useState } from 'react';
import { AutomaticApp } from './AutomaticApp';
import { Updates } from './Updates';
import { LegacyApp } from './LegacyApp';
import { invoke } from './overlay/api';

export function DesktopApp() {
  const [updating, setUpdating] = useState(false);
  const [legacy, setLegacy] = useState(false);
  useEffect(() => {
    void invoke<{ legacy: boolean }>('network_preferences')
      .then((settings) => setLegacy(settings.legacy))
      .catch(() => {});
  }, []);
  if (legacy) return <LegacyApp />;
  return (
    <>
      <Updates onBusy={setUpdating} />
      <div inert={updating} aria-busy={updating}>
        <AutomaticApp />
      </div>
    </>
  );
}
