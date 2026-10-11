import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export interface OverlayCapabilities {
  transparency: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  captureExclusion: 'supported' | 'unsupported' | 'unknown';
}

export interface OverlaySettings {
  version: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  captureExclusion: boolean;
  fontSize: number;
  visible: boolean;
  closeBehavior: 'tray' | 'quit';
}

export interface OverlaySnapshot {
  settings: OverlaySettings;
  capabilities: OverlayCapabilities;
  recoveryAvailable: boolean;
  hideShortcutAvailable: boolean;
  warning: string | null;
  capture: {
    status: 'unknown' | 'disabled' | 'applied' | 'unsupported' | 'error';
    message: string;
  };
  captureTest: boolean;
}

export type OverlayPatch = Partial<
  Pick<
    OverlaySettings,
    'opacity' | 'alwaysOnTop' | 'clickThrough' | 'fontSize' | 'captureExclusion' | 'closeBehavior'
  >
>;

export function errorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'message' in error)
    return String(error.message);
  return String(error);
}

export function useOverlay() {
  const [state, setState] = useState<OverlaySnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const subscription = listen<OverlaySnapshot>('overlay-changed', ({ payload }) => {
      if (active) setState(payload);
    });
    subscription
      .then(async () => {
        const initial = await invoke<OverlaySnapshot>('overlay_snapshot');
        if (active) setState(initial);
      })
      .catch((failure: unknown) => {
        if (active) setError(errorMessage(failure));
      });
    return () => {
      active = false;
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  return { state, setState, error, setError };
}

export { invoke };
