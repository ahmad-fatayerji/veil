import { invoke, useOverlay, errorMessage } from './api';
import { SharedEditor } from '@veil/editor';
import { useOverlayDocument } from './session';

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
  const document = useOverlayDocument();
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
          veil{' '}
          <span className="overlay-preview-tag">
            {state?.settings.clickThrough ? 'click-through' : 'document'}
          </span>
        </span>
        <span className="overlay-recovery-hint">Ctrl+Alt+V to restore controls</span>
      </header>
      <article className="overlay-document" aria-label="Overlay document">
        {state?.captureTest && (
          <div className="capture-test-card" aria-label="Capture test card">
            <strong>VEIL CAPTURE TEST</strong>
            <p>This card is visible on your desktop.</p>
            <p>Check the recording or remote viewer for this card.</p>
            <span>Local test card · no document changes</span>
          </div>
        )}
        <div hidden={state?.captureTest}>
          {document.connection ? (
            <SharedEditor
              key={document.connection.doc.clientID}
              connection={document.connection}
              compact
            />
          ) : (
            <div className="overlay-empty">
              <p>Join the document to start writing.</p>
              <p>Open the control panel with Ctrl+Alt+V and join a local session.</p>
            </div>
          )}
        </div>
      </article>
      {(error || document.error) && (
        <p role="alert" className="overlay-error">
          {error || document.error}
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
