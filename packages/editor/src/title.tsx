import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { DOCUMENT_TITLE } from '@veil/protocol';

export const TITLE_MAX_LENGTH = 120;

/** Replace the shared text with `next`, touching only the changed range so concurrent edits merge. */
export function applyText(text: Y.Text, next: string) {
  const previous = text.toString();
  if (previous === next) return;
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }
  const apply = () => {
    if (previousEnd > start) text.delete(start, previousEnd - start);
    if (nextEnd > start) text.insert(start, next.slice(start, nextEnd));
  };
  if (text.doc) text.doc.transact(apply);
  else apply();
}

/** Map a caret index through a remote Y.Text change. */
export function transformIndex(index: number, delta: Y.YTextEvent['delta']) {
  let position = 0;
  let result = index;
  for (const op of delta) {
    if (op.retain) position += op.retain;
    else if (typeof op.insert === 'string') {
      if (position < result) result += op.insert.length;
      position += op.insert.length;
    } else if (op.delete) {
      if (position < result) result -= Math.min(op.delete, result - position);
    }
  }
  return result;
}

export function useDocumentTitle(doc: Y.Doc | null | undefined) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!doc) return () => {};
      const text = doc.getText(DOCUMENT_TITLE);
      text.observe(onChange);
      return () => text.unobserve(onChange);
    },
    [doc],
  );
  return useSyncExternalStore(subscribe, () => doc?.getText(DOCUMENT_TITLE).toString() ?? '');
}

export function DocumentTitle({
  doc,
  onEnter,
  readOnly = false,
}: {
  doc: Y.Doc;
  onEnter?: () => void;
  readOnly?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const value = useDocumentTitle(doc);
  const selection = useRef<[number, number] | null>(null);
  // Keep the caret in place when someone else edits the title.
  useEffect(() => {
    const text = doc.getText(DOCUMENT_TITLE);
    const observer = (event: Y.YTextEvent) => {
      const element = input.current;
      if (element && document.activeElement === element && !event.transaction.local) {
        selection.current = [
          transformIndex(element.selectionStart ?? 0, event.delta),
          transformIndex(element.selectionEnd ?? 0, event.delta),
        ];
      }
    };
    text.observe(observer);
    return () => text.unobserve(observer);
  }, [doc]);
  useLayoutEffect(() => {
    if (selection.current && input.current) {
      input.current.setSelectionRange(...selection.current);
      selection.current = null;
    }
  }, [value]);
  return (
    <input
      ref={input}
      className="doc-title"
      aria-label="Document title"
      placeholder="Untitled"
      autoComplete="off"
      spellCheck
      maxLength={TITLE_MAX_LENGTH}
      readOnly={readOnly}
      value={value}
      onChange={(event) => {
        const next = event.target.value.replace(/[\r\n]+/g, ' ').slice(0, TITLE_MAX_LENGTH);
        applyText(doc.getText(DOCUMENT_TITLE), next);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || (event.key === 'ArrowDown' && onEnter)) {
          event.preventDefault();
          onEnter?.();
        }
      }}
    />
  );
}
