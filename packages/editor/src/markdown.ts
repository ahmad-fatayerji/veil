import { Extension, getSchema, type JSONContent } from '@tiptap/react';
import { MarkdownManager } from '@tiptap/markdown';
import {
  prosemirrorJSONToYXmlFragment,
  updateYFragment,
  yDocToProsemirrorJSON,
} from '@tiptap/y-tiptap';
import type * as Y from 'yjs';
import { DOCUMENT_FRAGMENT, DOCUMENT_TITLE } from '@veil/protocol';
import { documentExtensions } from './schema';
import { applyText } from './title';

const literal = (value: string): JSONContent[] =>
  value
    .split('\n')
    .flatMap((text, index) => [
      ...(index ? [{ type: 'hardBreak' }] : []),
      ...(text ? [{ type: 'text', text }] : []),
    ]);

// Preserve markup outside Veil's schema, including URLs and HTML, as visible text.
// In particular, opening a document must never load remote images or execute HTML.
const preserved = ['link', 'image', 'html', 'table', 'def'].map((type) =>
  Extension.create({
    name: `literal_${type}`,
    priority: 1100,
    markdownTokenName: type,
    parseMarkdown(token) {
      const content = literal(token.raw ?? token.text ?? '');
      return type === 'table' || type === 'def' || token.block
        ? { type: 'paragraph', content }
        : content;
    },
  }),
);
const deeperHeadings = Extension.create({
  name: 'literal_deep_heading',
  priority: 1100,
  markdownTokenName: 'heading',
  parseMarkdown(token, helpers) {
    if (Number(token.depth) > 3) return { type: 'paragraph', content: literal(token.raw ?? '') };
    return helpers.createNode(
      'heading',
      { level: token.depth || 1 },
      helpers.parseInline(token.tokens || []),
    );
  },
  // The serializer resolves a node's renderer through the first handler registered for its
  // token name, which is this override; without a renderer every heading would save empty.
  renderMarkdown(node, helpers) {
    if (!node.content) return '';
    return `${'#'.repeat(Number(node.attrs?.level) || 1)} ${helpers.renderChildren(node.content)}`;
  },
});
const inlineHtml = Extension.create({
  name: 'literalInlineHtml',
  markdownTokenName: 'literalInlineHtml',
  markdownTokenizer: {
    name: 'literalInlineHtml',
    level: 'inline',
    start: '<',
    tokenize(source) {
      const match = /^(?:<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z][^>]*>)/.exec(source);
      if (match) return { type: 'literalInlineHtml', raw: match[0] };
    },
  },
  parseMarkdown(token) {
    return literal(token.raw ?? '');
  },
});
const definitions = Extension.create({
  name: 'literalDefinition',
  markdownTokenName: 'literalDefinition',
  markdownTokenizer: {
    name: 'literalDefinition',
    level: 'block',
    start: (source) => source.search(/^ {0,3}\[[^\]\n]+\]:/m),
    tokenize(source) {
      const match = /^ {0,3}\[[^\]\n]+\]:[^\n]*(?:\n|$)/.exec(source);
      if (match) return { type: 'literalDefinition', raw: match[0] };
    },
  },
  parseMarkdown(token) {
    return { type: 'paragraph', content: literal((token.raw ?? '').replace(/\n$/, '')) };
  },
});
const markdown = new MarkdownManager({
  extensions: [...documentExtensions, ...preserved, deeperHeadings, inlineHtml, definitions],
  markedOptions: { gfm: true },
});
const schema = getSchema(documentExtensions);

function nodeText(node: JSONContent): string {
  return node.text ?? (node.content ?? []).map(nodeText).join('');
}

/** Parse Markdown into Veil's title and validated body; a leading H1 becomes the title. */
function parseDocument(source: string) {
  const body = markdown.parse(source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
  const first = body.content?.[0];
  let title: string | undefined;
  if (first?.type === 'heading' && first.attrs?.level === 1) {
    title = nodeText(first);
    body.content = body.content!.slice(1);
  }
  if (!body.content?.length) body.content = [{ type: 'paragraph' }];
  // Validate before touching the Y.Doc.
  const node = schema.nodeFromJSON(body);
  node.check();
  return { title, body, node };
}

/** Initialize a fresh, unshared document exactly once, before mounting its editors. */
export function loadMarkdown(doc: Y.Doc, source: string, filename = '') {
  const parsed = parseDocument(source);
  const title = parsed.title ?? filename.replace(/^.*[\\/]/, '').replace(/\.md$/i, '');
  doc.transact(() => {
    if (title) doc.getText(DOCUMENT_TITLE).insert(0, title);
    prosemirrorJSONToYXmlFragment(schema, parsed.body, doc.getXmlFragment(DOCUMENT_FRAGMENT));
  });
}

/** Transaction origin of edits made in the Markdown source view. */
export const markdownOrigin = Symbol('markdown source');

/**
 * Apply edited Markdown to a live, possibly shared document. Only the differing title text
 * and nodes change, so concurrent edits elsewhere in the document are preserved.
 */
export function applyMarkdown(doc: Y.Doc, source: string) {
  const { title, node } = parseDocument(source);
  doc.transact(() => {
    applyText(doc.getText(DOCUMENT_TITLE), title ?? '');
    updateYFragment(doc, doc.getXmlFragment(DOCUMENT_FRAGMENT), node, {
      mapping: new Map(),
      isOMark: new Map(),
    });
  }, markdownOrigin);
}

export function saveMarkdown(doc: Y.Doc): string {
  const body = yDocToProsemirrorJSON(doc, DOCUMENT_FRAGMENT) as JSONContent;
  const title = doc.getText(DOCUMENT_TITLE).toString();
  const content = [
    ...(title
      ? [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }]
      : []),
    ...(body.content ?? []),
  ];
  const output = markdown.serialize({ type: 'doc', content });
  return output ? `${output.replace(/\n+$/, '')}\n` : '';
}

/** Content equality ignores awareness, undo metadata, and CRDT history. */
export function documentFingerprint(doc: Y.Doc): string {
  const body = yDocToProsemirrorJSON(doc, DOCUMENT_FRAGMENT) as JSONContent;
  const content = body.content ?? [];
  const normalized =
    content.length === 1 && content[0].type === 'paragraph' && !content[0].content?.length
      ? []
      : content;
  return JSON.stringify([doc.getText(DOCUMENT_TITLE).toString(), normalized]);
}

export function suggestedFilename(title: string): string {
  let name =
    Array.from(title, (char) => (char.charCodeAt(0) < 32 ? '-' : char))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim()
      .slice(0, 100)
      .replace(/[. ]+$/g, '') || 'Untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name}.md`;
}
