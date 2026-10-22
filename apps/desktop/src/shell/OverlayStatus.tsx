import { Kbd } from '@veil/ui';
import type { OverlaySnapshot } from '../overlay/api';

/** What the capture setting actually achieves, rather than what it intends. */
function captureLabel({ settings, capture }: OverlaySnapshot) {
  if (!settings.captureExclusion) return 'Visible in screen capture';
  if (capture.status === 'unsupported') return 'Capture exclusion unsupported';
  if (capture.status === 'error') return 'Capture exclusion failed';
  return 'Hidden from compatible capture';
}

/**
 * Live overlay state for the status bar: whether it is shown, whether capture exclusion is
 * in effect, and the shortcut to toggle it. Opens the overlay settings when clicked.
 */
export function OverlayStatus({ state, onOpen }: { state: OverlaySnapshot; onOpen: () => void }) {
  const shown = state.settings.visible;
  const capture = captureLabel(state);
  const problem = capture.startsWith('Capture exclusion');
  return (
    <button
      type="button"
      className="statusbar-overlay"
      data-shown={shown || undefined}
      data-problem={problem || undefined}
      title="Overlay settings"
      onClick={onOpen}
    >
      <span className="statusbar-overlay-dot" aria-hidden="true" />
      <span>{shown ? 'Overlay shown' : 'Overlay hidden'}</span>
      <span aria-hidden="true">·</span>
      <span className="statusbar-overlay-capture">{capture}</span>
      {state.hideShortcutAvailable && <Kbd>{state.settings.keybinds.toggleOverlay}</Kbd>}
    </button>
  );
}
