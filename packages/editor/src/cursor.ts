import type { Editor } from '@tiptap/react';
import { getRelativeSelection, yCursorPluginKey, ySyncPluginKey } from '@tiptap/y-tiptap';
import { compareRelativePositions, createRelativePositionFromJSON } from 'yjs';
import type { DemoConnection } from '@veil/collaboration';

/** Refresh presence after the editor and its Yjs mapping have both finished updating. */
export function trackCursor(editor: Editor, awareness: DemoConnection['provider']['awareness']) {
  let disposed = false;
  let queued = false;
  let documentChanged = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (disposed || editor.isDestroyed) return;
      if (documentChanged) {
        documentChanged = false;
        // Cursor decorations can be computed before the binding has mapped the edit.
        // Resolve remote positions again once all synchronous Yjs updates have settled.
        editor.view.dispatch(editor.state.tr.setMeta(yCursorPluginKey, { awarenessUpdated: true }));
      }
      // An inactive view must not replace the other desktop window's presence.
      if (!editor.view.hasFocus()) return;
      const sync = ySyncPluginKey.getState(editor.state);
      if (!sync?.binding || sync.snapshot != null || sync.prevSnapshot != null) return;
      const { anchor, head } = getRelativeSelection(sync.binding, editor.state);
      const current = awareness.getLocalState()?.cursor;
      if (
        !current ||
        !compareRelativePositions(createRelativePositionFromJSON(current.anchor), anchor) ||
        !compareRelativePositions(createRelativePositionFromJSON(current.head), head)
      )
        awareness.setLocalStateField('cursor', { anchor, head });
    });
  };
  const transaction: Parameters<typeof editor.on<'transaction'>>[1] = ({ transaction }) => {
    if (transaction.docChanged) documentChanged = true;
    if (transaction.docChanged || transaction.selectionSet) refresh();
  };
  editor.on('transaction', transaction);
  editor.on('focus', refresh);
  refresh();
  return () => {
    disposed = true;
    editor.off('transaction', transaction);
    editor.off('focus', refresh);
  };
}
