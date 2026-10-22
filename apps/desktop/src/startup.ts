import { useEffect, useRef, useState } from 'react';
import { errorMessage, invoke } from './overlay/api';

interface StartupStatus {
  supported: boolean;
  enabled: boolean;
}

export function useWindowsStartup(open: boolean) {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const configuring = useRef(false);
  const request = useRef(0);

  useEffect(() => {
    if (!open || configuring.current) return;
    let active = true;
    const current = ++request.current;
    setLoading(true);
    setError('');
    void invoke<StartupStatus>('startup_status')
      .then((value) => {
        if (active && request.current === current) setStatus(value);
      })
      .catch((cause: unknown) => {
        if (active && request.current === current) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active && request.current === current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  async function configure(enabled: boolean) {
    if (!status?.supported || loading || configuring.current) return;
    configuring.current = true;
    ++request.current;
    setSaving(true);
    setError('');
    try {
      setStatus(await invoke<StartupStatus>('startup_configure', { enabled }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      configuring.current = false;
      setSaving(false);
    }
  }

  return { status, loading, saving, error, configure };
}
