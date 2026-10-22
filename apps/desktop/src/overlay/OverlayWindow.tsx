import { defaultKeybinds } from '../keybinds';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  Check,
  ChevronDown,
  FileCode,
  Move,
  MoveDiagonal,
  MoveDiagonal2,
  MoveHorizontal,
  MoveVertical,
  X,
  type LucideIcon,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Participant } from '@veil/collaboration';
import { invoke, useOverlay, errorMessage } from './api';
import { Avatar, Menu, MenuItem, Tooltip, activityLabels, useAppearance } from '@veil/ui';
import { SharedEditor, useDocumentTitle, type EditorMode } from '@veil/editor';
import { connectionStates } from '../shell/TitleBar';
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
  // The overlay chooses its own view; switching documents keeps it.
  const [mode, setMode] = useState<EditorMode>('rich');
  const status = document.tabs.find((tab) => tab.id === document.activeId)?.status ?? 'local';
  const connection =
    connectionStates[
      status in connectionStates ? (status as keyof typeof connectionStates) : 'local'
    ];
  const keepGesture = (event: PointerEvent) => event.stopPropagation();
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
          '--overlay-text-opacity': state?.settings.textOpacity ?? 1,
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
        <div className="overlay-title">
          {document.connection && (
            <span
              className="overlay-status-dot"
              data-tone={connection.tone}
              title={connection.label}
              aria-hidden="true"
            />
          )}
          {document.connection && document.tabs.length > 1 && interactive ? (
            // Header controls must not start a window move.
            <div className="overlay-header-control" onPointerDown={keepGesture}>
              <Menu
                label={`Switch document, current: ${title || 'Untitled'}`}
                align="start"
                tooltip={false}
                triggerClassName="overlay-switcher"
                trigger={
                  <>
                    <span className="overlay-title-text">{title || 'Untitled'}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </>
                }
              >
                {document.tabs.map((tab) => (
                  <MenuItem
                    key={tab.id}
                    icon={
                      tab.id === document.activeId ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <span className="overlay-menu-spacer" aria-hidden="true" />
                      )
                    }
                    onSelect={() => document.selectTab(tab.id)}
                  >
                    {tab.title}
                    {tab.dirty && <span className="overlay-menu-unsaved"> · Unsaved</span>}
                  </MenuItem>
                ))}
              </Menu>
            </div>
          ) : (
            <span className="overlay-title-text" title={title || undefined}>
              {document.connection ? title || 'Untitled' : 'Veil'}
            </span>
          )}
          {state?.settings.clickThrough && (
            <span className="overlay-recovery-hint">
              {state.recoveryAvailable ? (
                <>
                  <kbd className="kbd">{state.settings.keybinds.recoverControls}</kbd> to edit
                </>
              ) : (
                'Click-through · restore from the tray'
              )}
            </span>
          )}
        </div>
        <div className="overlay-header-actions">
          {hint && <OverlayHint handle={hint} />}
          {document.connection && !state?.captureTest && (
            <OverlayPeople people={document.participants} />
          )}
          {document.connection && !state?.captureTest && interactive && (
            <button
              type="button"
              className="overlay-icon-button"
              aria-label="Markdown view"
              aria-pressed={mode === 'markdown'}
              title={mode === 'markdown' ? 'Show rich text' : 'Show Markdown'}
              disabled={!interactive}
              onPointerEnter={() => setHovered(null)}
              onPointerDown={keepGesture}
              onClick={() => setMode(mode === 'markdown' ? 'rich' : 'markdown')}
            >
              <FileCode size={16} aria-hidden="true" />
            </button>
          )}
          {/* Click-through can't reach header controls; the recovery hint replaces them. */}
          {!state?.settings.clickThrough && (
            <button
              type="button"
              className="overlay-icon-button overlay-close"
              aria-label="Hide overlay"
              title={
                state?.hideShortcutAvailable
                  ? `Hide overlay (${state.settings.keybinds.toggleOverlay} to show again)`
                  : 'Hide overlay (use the tray to show again)'
              }
              disabled={!interactive}
              onPointerEnter={() => setHovered(null)}
              onPointerDown={keepGesture}
              onClick={() => {
                void invoke('overlay_visibility', { visible: false }).catch((failure: unknown) =>
                  setError(errorMessage(failure)),
                );
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
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
        <div className="overlay-editor" hidden={state?.captureTest}>
          {document.connection ? (
            <SharedEditor
              key={document.connection.doc.clientID}
              connection={document.connection}
              compact
              mode={mode}
              onModeChange={setMode}
              formatting={interactive ? (state?.settings.formatting ?? 'toolbar') : 'none'}
            />
          ) : (
            <div className="overlay-empty">
              <p>No document open.</p>
              <p>
                Press {state?.settings.keybinds.recoverControls ?? defaultKeybinds.recoverControls}{' '}
                to open Veil, then create or open a document.
              </p>
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

/** Participant avatars; hovering one shows the name and what they are doing. */
function OverlayPeople({ people }: { people: Participant[] }) {
  const shown = people.slice(0, 4);
  const extra = people.length - shown.length;
  return (
    <ul className="overlay-people" aria-label="Participants">
      {shown.map((person) => {
        const label = `${person.name}${person.local ? ' (you)' : ''} · ${activityLabels[person.activity]}`;
        return (
          <li key={person.id} data-participant-name={person.name} data-activity={person.activity}>
            <Tooltip content={label}>
              <span className="overlay-person">
                <Avatar person={person} size="sm" />
                <span className="visually-hidden">{label}</span>
              </span>
            </Tooltip>
          </li>
        );
      })}
      {extra > 0 && (
        <li className="overlay-people-more">
          +{extra}
          <span className="visually-hidden"> more participants</span>
        </li>
      )}
    </ul>
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
