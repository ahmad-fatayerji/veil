import { invoke, useOverlay, errorMessage } from './api';

const directions = [
  'north',
  'south',
  'east',
  'west',
  'northEast',
  'northWest',
  'southEast',
  'southWest',
] as const;

export function OverlayWindow() {
  const { state, error, setError } = useOverlay();
  const gesture = (direction: string | null) => {
    void invoke('overlay_gesture', { direction }).catch((failure: unknown) =>
      setError(errorMessage(failure)),
    );
  };
  return (
    <main
      className={`overlay-surface ${state?.settings.clickThrough ? 'is-click-through' : ''}`}
      style={{ fontSize: `${state?.settings.fontSize ?? 20}px` }}
    >
      <header
        className="overlay-drag-handle"
        onPointerDown={(event) => {
          if (event.button === 0) gesture(null);
        }}
      >
        <span>
          veil <span className="overlay-preview-tag">preview</span>
        </span>
        <span className="overlay-recovery-hint">Ctrl+Alt+V to restore controls</span>
      </header>
      <article className="overlay-preview" aria-label="Overlay preview">
        <h1>Keep your thoughts in view.</h1>
        <p>A quiet space above your work.</p>
        <p>
          Move me, resize me, or let clicks pass through. Your display settings stay on this device.
        </p>
      </article>
      {error && (
        <p role="alert" className="overlay-error">
          {error}
        </p>
      )}
      {!state?.settings.clickThrough &&
        directions.map((direction) => (
          <div
            key={direction}
            className={`overlay-resize overlay-resize-${direction}`}
            aria-hidden="true"
            onPointerDown={(event) => {
              if (event.button === 0) gesture(direction);
            }}
          />
        ))}
    </main>
  );
}
