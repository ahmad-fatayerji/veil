import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DOCUMENT_TITLE } from '@veil/protocol';
import { applyText, transformIndex } from './title';

function connected() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (update: Uint8Array) => Y.applyUpdate(b, update));
  b.on('update', (update: Uint8Array) => Y.applyUpdate(a, update));
  return [a, b] as const;
}

describe('document title', () => {
  it('syncs between collaborators', () => {
    const [a, b] = connected();
    applyText(a.getText(DOCUMENT_TITLE), 'Launch checklist');
    expect(b.getText(DOCUMENT_TITLE).toString()).toBe('Launch checklist');
  });

  it('only replaces the changed range', () => {
    const doc = new Y.Doc();
    const text = doc.getText(DOCUMENT_TITLE);
    applyText(text, 'Launch plan');
    const deltas: unknown[] = [];
    text.observe((event) => deltas.push(event.delta));
    applyText(text, 'Launch checklist plan');
    expect(text.toString()).toBe('Launch checklist plan');
    expect(deltas).toEqual([[{ retain: 7 }, { insert: 'checklist ' }]]);
  });

  it('merges concurrent edits at different positions', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applyText(a.getText(DOCUMENT_TITLE), 'Notes');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyText(a.getText(DOCUMENT_TITLE), 'Team notes');
    applyText(b.getText(DOCUMENT_TITLE), 'Notes today');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText(DOCUMENT_TITLE).toString()).toBe('Team notes today');
    expect(b.getText(DOCUMENT_TITLE).toString()).toBe('Team notes today');
  });

  it('keeps the caret in place across remote edits', () => {
    // "Notes" with the caret after "No"; a remote user prefixes "Team " and deletes "s".
    expect(transformIndex(2, [{ insert: 'Team ' }])).toBe(7);
    expect(transformIndex(2, [{ retain: 4 }, { delete: 1 }])).toBe(2);
    expect(transformIndex(4, [{ retain: 1 }, { delete: 2 }])).toBe(2);
  });
});
