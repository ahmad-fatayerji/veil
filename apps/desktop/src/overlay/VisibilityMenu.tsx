import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage, invoke } from './api';

// Render inside the owning webview so both windows share the app theme and the
// overlay menu stays within the overlay's capture-excluded native surface.
export function useVisibilityMenu(
  visible: boolean,
  onError: (message: string) => void,
  enabled = true,
  captureExcluded = false,
) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const label = visible ? 'Show overlay' : 'Hide overlay';
  if (position && !enabled) setPosition(null);

  const dismiss = (restoreFocus = false) => {
    setPosition(null);
    if (restoreFocus) previousFocus.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!position || !menu.current) return;
    const bounds = menu.current.getBoundingClientRect();
    menu.current.style.left = `${Math.max(4, Math.min(position.x, innerWidth - bounds.width - 4))}px`;
    menu.current.style.top = `${Math.max(4, Math.min(position.y, innerHeight - bounds.height - 4))}px`;
    item.current?.focus({ preventScroll: true });
  }, [position]);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [position]);

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (!enabled) return;
    onError('');
    if (!menu.current?.contains(document.activeElement))
      previousFocus.current = document.activeElement as HTMLElement | null;
    // Keyboard context-menu requests may supply no pointer coordinates.
    const bounds = (event.target as HTMLElement).getBoundingClientRect();
    setPosition({
      x: event.clientX || bounds.left + 12,
      y: event.clientY || bounds.top + 12,
    });
  };

  return {
    onContextMenu,
    menu:
      position && enabled
        ? createPortal(
            <div
              ref={menu}
              className={`overlay-visibility-menu${captureExcluded ? ' is-capture-excluded' : ''}`}
              role="menu"
              aria-label="Overlay visibility"
              style={{ left: position.x, top: position.y }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  dismiss(true);
                } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  item.current?.focus();
                } else if (event.key === 'Tab') {
                  event.preventDefault();
                  dismiss(true);
                }
              }}
            >
              <button
                ref={item}
                type="button"
                role="menuitem"
                onClick={() => {
                  dismiss(true);
                  void invoke('overlay_visibility', { visible }).catch((failure: unknown) =>
                    onError(errorMessage(failure)),
                  );
                }}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                  <rect
                    x="3"
                    y="4"
                    width="14"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path d="M6 10h8" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  {visible && (
                    <path d="M10 6v8" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  )}
                </svg>
                {label}
              </button>
            </div>,
            document.body,
          )
        : null,
  };
}
