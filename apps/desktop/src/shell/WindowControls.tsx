import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

function useMaximized() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    try {
      const current = getCurrentWindow();
      const sync = () =>
        void current
          .isMaximized()
          .then((value) => active && setMaximized(value))
          .catch(() => undefined);
      sync();
      void current
        .onResized(sync)
        .then((off) => (active ? (unlisten = off) : off()))
        .catch(() => undefined);
    } catch {
      // Not running inside Tauri (browser preview).
    }
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
  return maximized;
}

function act(action: (window: ReturnType<typeof getCurrentWindow>) => Promise<void>) {
  try {
    void action(getCurrentWindow()).catch(() => undefined);
  } catch {
    // Not running inside Tauri.
  }
}

export function WindowControls() {
  const maximized = useMaximized();
  return (
    <div className="window-controls">
      <button
        type="button"
        className="caption-btn"
        aria-label="Minimize"
        onClick={() => act((w) => w.minimize())}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        className="caption-btn"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => act((w) => w.toggleMaximize())}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="caption-btn caption-close"
        aria-label="Close window"
        onClick={() => act((w) => w.close())}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>
    </div>
  );
}
