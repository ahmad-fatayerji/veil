import { useEffect, useRef, useState } from 'react';
import { errorMessage, invoke } from './overlay/api';

export interface DiscordPreferences {
  enabled: boolean;
  showDocumentTitle: boolean;
  showParticipantCount: boolean;
}

interface Snapshot {
  preferences: DiscordPreferences;
  warning: string | null;
}

interface Activity {
  documentTitle: string | null;
  othersCount: number;
}

export function useDiscordPresence(documentTitle: string | null, othersCount: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<Activity | null>(null);
  const sending = useRef(false);
  const configuring = useRef(false);

  useEffect(() => {
    let active = true;
    void invoke<Snapshot>('discord_preferences')
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Serialize IPC and retain only the newest pending activity during a burst.
    pending.current = { documentTitle, othersCount };
    if (sending.current) return;
    sending.current = true;
    void (async () => {
      try {
        while (pending.current) {
          const activity = pending.current;
          pending.current = null;
          await invoke('discord_update', { activity });
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        sending.current = false;
      }
    })();
  }, [documentTitle, othersCount]);

  async function configure(patch: Partial<DiscordPreferences>) {
    if (!snapshot || configuring.current) return;
    configuring.current = true;
    setSaving(true);
    setError('');
    try {
      setSnapshot(
        await invoke<Snapshot>('discord_configure', {
          preferences: { ...snapshot.preferences, ...patch },
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      configuring.current = false;
      setSaving(false);
    }
  }

  return {
    preferences: snapshot?.preferences ?? null,
    saving,
    error: error || snapshot?.warning || '',
    configure,
  };
}
