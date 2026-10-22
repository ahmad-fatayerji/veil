import { describe, expect, it } from 'vitest';
import { formatMarkdown, markdownShortcut, type MarkdownCommand } from './markdown-format';

/** Apply a command to text where `[` and `]` mark the selection; return the same notation. */
function run(marked: string, command: MarkdownCommand, level?: number) {
  const start = marked.indexOf('[');
  const end = marked.indexOf(']') - 1;
  const text = marked.replace('[', '').replace(']', '');
  const edit = formatMarkdown(text, start, end, command, level);
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  const [from, to] = edit.selection;
  return `${next.slice(0, from)}[${next.slice(from, to)}]${next.slice(to)}`;
}

describe('Markdown source formatting', () => {
  it('wraps and unwraps inline marks', () => {
    expect(run('a [word] b', 'bold')).toBe('a **[word]** b');
    expect(run('a **[word]** b', 'bold')).toBe('a [word] b');
    expect(run('a [**word**] b', 'bold')).toBe('a [word] b');
    expect(run('a [word] b', 'italic')).toBe('a *[word]* b');
    expect(run('a *[word]* b', 'italic')).toBe('a [word] b');
    // Italic inside bold adds a mark instead of removing a bold asterisk.
    expect(run('**[word]**', 'italic')).toBe('***[word]***');
    expect(run('[x]', 'strike')).toBe('~~[x]~~');
    expect(run('[]', 'code')).toBe('`[]`');
  });

  it('toggles list, quote, and heading prefixes on selected lines', () => {
    expect(run('[one\ntwo]', 'bulletList')).toBe('[- one\n- two]');
    expect(run('[- one\n- two]', 'bulletList')).toBe('[one\ntwo]');
    expect(run('[- one\n- two]', 'orderedList')).toBe('[1. one\n2. two]');
    // Switching list types keeps indentation and replaces the checkbox.
    expect(formatMarkdown('  - [x] done', 12, 12, 'bulletList').insert).toBe('  - done');
    expect(run('note[]', 'taskList')).toBe('- [ ] note[]');
    expect(run('quote[]', 'blockquote')).toBe('> quote[]');
    expect(run('## Title[]', 'heading', 3)).toBe('### Title[]');
    expect(run('## Title[]', 'heading', 0)).toBe('Title[]');
  });

  it('fences code blocks and inserts dividers', () => {
    expect(run('[code]', 'codeBlock')).toBe('```\n[code]\n```');
    expect(run('[```\ncode\n```]', 'codeBlock')).toBe('[code]');
    expect(run('text[]', 'horizontalRule')).toBe('text\n\n---\n\n[]');
  });

  it('matches the rich editor shortcuts', () => {
    const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
      markdownShortcut({
        code,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...mods,
      });
    expect(key('KeyB')).toEqual(['bold']);
    expect(key('KeyI')).toEqual(['italic']);
    expect(key('KeyX', { shiftKey: true })).toEqual(['strike']);
    expect(key('Digit2', { altKey: true })).toEqual(['heading', 2]);
    expect(key('KeyS')).toBeNull();
  });
});
