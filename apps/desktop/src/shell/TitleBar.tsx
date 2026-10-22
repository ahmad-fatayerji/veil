import type { MouseEvent, ReactNode, Ref } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Participant } from '@veil/collaboration';
import { AvatarStack, Tooltip } from '@veil/ui';
import { WindowControls } from './WindowControls';

const DRAG_THRESHOLD = 4;

function onDragArea(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  return event.button === 0 && !target.closest('button, a, input, textarea, [role="menu"]');
}

// Start the native window move only once the pointer actually travels. Tauri's built-in
// drag region starts it on mousedown, which makes the cursor flicker on a plain click.
function beginDrag(event: MouseEvent<HTMLElement>) {
  if (!onDragArea(event) || event.detail > 1) return;
  const { screenX, screenY } = event;
  const cleanup = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', cleanup);
  };
  const move = (next: globalThis.MouseEvent) => {
    if (Math.hypot(next.screenX - screenX, next.screenY - screenY) < DRAG_THRESHOLD) return;
    cleanup();
    try {
      void getCurrentWindow()
        .startDragging()
        .catch(() => undefined);
    } catch {
      // Not running inside Tauri.
    }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', cleanup);
}

function toggleMaximize(event: MouseEvent<HTMLElement>) {
  if (!onDragArea(event)) return;
  try {
    void getCurrentWindow()
      .toggleMaximize()
      .catch(() => undefined);
  } catch {
    // Not running inside Tauri.
  }
}

export function TitleBar({
  start,
  tabs,
  end,
}: {
  start?: ReactNode;
  /** Document tabs replace the identity area; the remaining space stays draggable. */
  tabs?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <header
      className="titlebar"
      data-tabs={tabs ? '' : undefined}
      onMouseDown={beginDrag}
      onDoubleClick={toggleMaximize}
    >
      {tabs ? (
        <>
          {tabs}
          <div className="titlebar-drag" aria-hidden="true" />
        </>
      ) : (
        <div className="titlebar-identity">
          {start ?? <span className="titlebar-wordmark">Veil</span>}
        </div>
      )}
      <div className="titlebar-actions">{end}</div>
      <WindowControls />
    </header>
  );
}

export type ConnectionState = 'local' | 'sharing' | 'connected' | 'connecting' | 'disconnected';

export const connectionStates = {
  local: { label: 'Local', tone: 'neutral' },
  sharing: { label: 'Sharing', tone: 'neutral' },
  connected: { label: 'Connected', tone: 'success' },
  connecting: { label: 'Connecting…', tone: 'warning' },
  disconnected: { label: 'Disconnected', tone: 'danger' },
} as const;

export function PeopleButton({
  participants,
  waiting,
  expanded,
  onToggle,
  ref,
}: {
  participants: Participant[];
  waiting: number;
  expanded: boolean;
  onToggle: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const label =
    `People, ${participants.length}` + (waiting > 0 ? `, ${waiting} waiting to join` : '');
  return (
    <Tooltip content={expanded ? 'Hide people' : 'Show people'}>
      <button
        ref={ref}
        type="button"
        className="people-trigger"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={expanded ? 'people-panel' : undefined}
        onClick={onToggle}
      >
        <AvatarStack people={participants} />
        <span aria-hidden="true">{participants.length}</span>
        {waiting > 0 && (
          <span className="count-badge" aria-hidden="true">
            {waiting}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
