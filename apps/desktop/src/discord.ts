import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, invoke } from './overlay/api';
import type { DiscordConnectionView } from './discord-social';
import { useDiscordSocial } from './discord-client';

export interface DiscordPreferences {
  enabled: boolean;
  showDocumentTitle: boolean;
  showParticipantCount: boolean;
}

export interface DiscordCapabilities {
  accountLinking: boolean;
  activityInvites: boolean;
  unavailableReason: string;
}

interface Snapshot {
  preferences: DiscordPreferences;
  warning: string | null;
  capabilities: DiscordCapabilities;
}

interface Activity {
  documentTitle: string | null;
  othersCount: number;
}

export function useDiscordPresence(
  documentTitle: string | null,
  othersCount: number,
  onConnectionLost: () => void,
) {
  const social = useDiscordSocial(onConnectionLost);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadingGeneration = useRef(0);
  const pending = useRef<Activity | null>(null);
  const sending = useRef(false);
  const configuring = useRef(false);

  const reload = useCallback(async () => {
    const generation = ++loadingGeneration.current;
    setLoading(true);
    setLoadError('');
    try {
      const value = await invoke<Snapshot>('discord_preferences');
      if (generation === loadingGeneration.current) setSnapshot(value);
    } catch (cause) {
      if (generation === loadingGeneration.current) setLoadError(errorMessage(cause));
    } finally {
      if (generation === loadingGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const generation = loadingGeneration.current;
    void invoke<Snapshot>('discord_preferences')
      .then((value) => {
        if (active && loadingGeneration.current === generation) {
          setSnapshot(value);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (active && loadingGeneration.current === generation) {
          setLoadError(errorMessage(cause));
          setLoading(false);
        }
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

  const connection: DiscordConnectionView = loading
    ? { status: 'loading' }
    : loadError
      ? {
          status: 'error',
          message: 'Discord settings could not be read.',
          retry: () => void reload(),
        }
      : social.connection;

  return {
    preferences: snapshot?.preferences ?? null,
    capabilities: snapshot?.capabilities ?? null,
    connection,
    social,
    loading,
    loadError,
    reload,
    saving,
    error: loadError || error || snapshot?.warning || '',
    configure,
  };
}
