import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DOCUMENT_FRAGMENT, DOCUMENT_TITLE } from '@veil/protocol';
import { documentFingerprint, loadMarkdown, saveMarkdown, suggestedFilename } from './markdown';

describe('Markdown document files', () => {
  it('round trips the title and supported rich formatting, including nested tasks and Unicode', () => {
    const source =
      '# Réunion 日本語\n\n## Agenda\n\n**Bold** and *italic*, ~~strike~~, `inline`.\n\n- Item\n  - Nested\n\n1. First\n2. Second\n\n- [x] Done\n  - [ ] Follow up\n\n> Quoted\n\n```ts\nconst value = "<example>";\n```\n\n---\n\n### End\n';
    const first = new Y.Doc();
    const second = new Y.Doc();
    try {
      loadMarkdown(first, source);
      expect(first.getText(DOCUMENT_TITLE).toString()).toBe('Réunion 日本語');
      const saved = saveMarkdown(first);
      expect(saved).toContain('- [x]');
      expect(saved).toContain('const value = "<example>";');
      loadMarkdown(second, saved);
      expect(documentFingerprint(second)).toBe(documentFingerprint(first));
    } finally {
      first.destroy();
      second.destroy();
    }
  });

  it('keeps unsupported links, images, tables, HTML, and reference definitions visible', () => {
    const doc = new Y.Doc();
    try {
      loadMarkdown(
        doc,
        '# Title\n\n[Link](https://example.com) ![Image](https://example.com/a.png)\n\nText <script>alert("kept")</script> end\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[ref]: https://example.com\n\n#### Deeper heading\n',
      );
      const text = doc.getXmlFragment(DOCUMENT_FRAGMENT).toString();
      for (const value of [
        'https://example.com',
        'a.png',
        'script',
        'alert',
        '| A | B |',
        '[ref]:',
        '#### Deeper heading',
      ])
        expect(text).toContain(value);
      expect(text).not.toContain('<image');
      expect(text).not.toContain('<table');
    } finally {
      doc.destroy();
    }
  });

  it('accepts BOM and Windows newlines and uses the filename when there is no leading H1', () => {
    const doc = new Y.Doc();
    try {
      loadMarkdown(doc, '\uFEFF## Notes\r\n\r\nHello\r\n', 'C:\\My notes\\Plan.md');
      expect(doc.getText(DOCUMENT_TITLE).toString()).toBe('Plan');
      expect(saveMarkdown(doc)).toContain('## Notes');
    } finally {
      doc.destroy();
    }
  });

  it('treats an empty editor paragraph as an unchanged empty document', () => {
    const empty = new Y.Doc();
    const loaded = new Y.Doc();
    try {
      loadMarkdown(loaded, '');
      expect(documentFingerprint(loaded)).toBe(documentFingerprint(empty));
      expect(saveMarkdown(empty)).toBe('');
    } finally {
      empty.destroy();
      loaded.destroy();
    }
  });

  it('escapes title Markdown and suggests valid Windows filenames', () => {
    const doc = new Y.Doc();
    const reopened = new Y.Doc();
    try {
      doc.getText(DOCUMENT_TITLE).insert(0, 'A *literal* [title]');
      loadMarkdown(reopened, saveMarkdown(doc));
      expect(reopened.getText(DOCUMENT_TITLE).toString()).toBe('A *literal* [title]');
      expect(suggestedFilename('CON')).toBe('_CON.md');
      expect(suggestedFilename('A/B: C?')).toBe('A-B- C-.md');
      expect(suggestedFilename('')).toBe('Untitled.md');
    } finally {
      doc.destroy();
      reopened.destroy();
    }
  });
});
