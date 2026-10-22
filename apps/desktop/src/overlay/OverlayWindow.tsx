import { defaultKeybinds } from '../keybinds';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Move,
  MoveDiagonal,
  MoveDiagonal2,
  MoveHorizontal,
  MoveVertical,
  X,
  type LucideIcon,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke, useOverlay, errorMessage } from './api';
import { activityLabels, useAppearance } from '@veil/ui';
import { SharedEditor, useDocumentTitle } from '@veil/editor';
import { useOverlayDocument } from './session';
import { useVisibilityMenu } from './VisibilityMenu';

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
type Handle = (typeof directions)[number] | 'move';
const hints: Record<Handle, { label: string; icon: LucideIcon }> = {
  move: { label: 'Move', icon: Move },
  north: { label: 'Resize vertically', icon: MoveVertical },
  south: { label: 'Resize vertically', icon: MoveVertical },
  east: { label: 'Resize horizontally', icon: MoveHorizontal },
  west: { label: 'Resize horizontally', icon: MoveHorizontal },
  northEast: { label: 'Resize diagonally', icon: MoveDiagonal },
  southWest: { label: 'Resize diagonally', icon: MoveDiagonal },
  northWest: { label: 'Resize diagonally', icon: MoveDiagonal2 },
  southEast: { label: 'Resize diagonally', icon: MoveDiagonal2 },
};

export function OverlayWindow() {
  useAppearance();
  const { state, error, setError } = useOverlay();
  const document = useOverlayDocument();
  const title = useDocumentTitle(document.connection?.doc).trim();
  const [hovered, setHovered] = useState<Handle | null>(null);
  const [active, setActive] = useState<Handle | null>(null);
  const gesturePending = useRef(false);
  const interactive = !!state?.settings.visible && !state.settings.clickThrough;
  const excluded = !!state?.settings.captureExclusion;
  const visibilityMenu = useVisibilityMenu(false, setError, interactive, excluded);
  const [wasInteractive, setWasInteractive] = useState(interactive);
  if (wasInteractive !== interactive) {
    setWasInteractive(interactive);
    setHovered(null);
  }
  useEffect(() => {
    let listening = true;
    const clearHover = () => {
      if (listening) setHovered(null);
    };
    const nativeFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) clearHover();
    });
    void nativeFocus.catch((failure: unknown) => {
      if (listening) setError(errorMessage(failure));
    });
    window.addEventListener('blur', clearHover);
    return () => {
      listening = false;
      window.removeEventListener('blur', clearHover);
      void nativeFocus.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [setError]);
  const hint = excluded && interactive ? (active ?? hovered) : null;
  const gesture = (handle: Handle) => {
    if (!interactive || gesturePending.current) return;
    gesturePending.current = true;
    setActive(handle);
    void invoke('overlay_gesture', { direction: handle === 'move' ? null : handle })
      .catch((failure: unknown) => setError(errorMessage(failure)))
      .finally(() => {
        gesturePending.current = false;
        setActive(null);
      });
  };
  return (
    <main
      className={`overlay-surface ${state?.settings.clickThrough ? 'is-click-through' : ''} ${excluded ? 'is-capture-excluded' : ''} ${active && interactive ? 'is-gesturing' : ''}`}
      style={
        {
          fontSize: `${state?.settings.fontSize ?? 20}px`,
          '--overlay-window-opacity': state?.settings.opacity ?? 0.85,
        } as CSSProperties
      }
      onContextMenu={visibilityMenu.onContextMenu}
      onDragStart={(event) => {
        if (gesturePending.current) event.preventDefault();
      }}
    >
      {visibilityMenu.menu}
      <header
        className="overlay-drag-handle"
        onPointerEnter={() => setHovered('move')}
        onPointerLeave={() => setHovered(null)}
        onPointerDown={(event) => {
          if (event.button === 0) {
            event.preventDefault();
            gesture('move');
          }
        }}
      >
        <span className="overlay-title">
          <span className="overlay-title-text" title={title || undefined}>
            {document.connection ? title || 'Untitled' : 'Veil'}
          </span>
          {state?.settings.clickThrough && <span className="overlay-chip">Click-through</span>}
        </span>
        <div className="overlay-header-actions">
          {hint ? (
            <OverlayHint handle={hint} />
          ) : (
            <span className="overlay-recovery-hint">
              {state?.recoveryAvailable ? (
                <>
                  <kbd className="kbd">{state.settings.keybinds.recoverControls}</kbd> restores
                  controls
                </>
              ) : (
                'Restore controls from the tray menu'
              )}
            </span>
          )}
          <button
            type="button"
            className="overlay-close"
            aria-label="Hide overlay"
            title={
              state?.hideShortcutAvailable
                ? `Hide overlay (${state.settings.keybinds.toggleOverlay} to show again)`
                : 'Hide overlay (use the tray to show again)'
            }
            disabled={!interactive}
            onPointerEnter={() => setHovered(null)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              void invoke('overlay_visibility', { visible: false }).catch((failure: unknown) =>
                setError(errorMessage(failure)),
              );
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
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
        <div hidden={state?.captureTest} style={{ opacity: state?.settings.textOpacity ?? 1 }}>
          {document.connection ? (
            <SharedEditor
              key={document.connection.doc.clientID}
              connection={document.connection}
              compact
            />
          ) : (
            <div className="overlay-empty">
              <p>Join the document to start writing.</p>
              <p>
                Open the control panel with{' '}
                {state?.settings.keybinds.recoverControls ?? defaultKeybinds.recoverControls} to
                create a document or join a session.
              </p>
            </div>
          )}
        </div>
      </article>
      {document.connection && !state?.captureTest && (
        <ul className="overlay-participants" aria-label="Participants">
          {document.participants.map((person) => (
            <li key={person.id} data-participant-name={person.name}>
              <span
                className="overlay-person-dot"
                style={{ backgroundColor: person.color }}
                aria-hidden="true"
              />
              <span className="overlay-person-name" title={person.name}>
                {person.name}
                {person.local && ' (you)'}
              </span>
              <span className={`participant-activity activity-${person.activity}`}>
                {activityLabels[person.activity]}
              </span>
            </li>
          ))}
        </ul>
      )}
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
            onPointerEnter={() => setHovered(direction)}
            onPointerLeave={() => setHovered(null)}
            onPointerDown={(event) => {
              if (event.button === 0) {
                event.preventDefault();
                gesture(direction);
              }
            }}
          />
        ))}
    </main>
  );
}

function OverlayHint({ handle }: { handle: Handle }) {
  const { label, icon: Icon } = hints[handle];
  return (
    <span className="overlay-gesture-hint">
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}
