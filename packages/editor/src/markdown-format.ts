/** Formatting commands for the Markdown source view, mirroring the rich text toolbar. */
export type MarkdownCommand =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'
  | 'horizontalRule'
  | 'heading';

/** Replace `from`–`to` with `insert`, then select `selection`. */
export interface MarkdownEdit {
  from: number;
  to: number;
  insert: string;
  selection: [number, number];
}

const markers: Partial<Record<MarkdownCommand, string>> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
};

const linePrefixes = {
  bulletList: /^(\s*)[-*+] (?!\[[ xX]\] )/,
  orderedList: /^(\s*)\d+[.)] /,
  taskList: /^(\s*)[-*+] \[[ xX]\] /,
  blockquote: /^(\s*)> ?/,
  heading: /^(\s*)#{1,6} /,
} as const;

const lists = ['bulletList', 'orderedList', 'taskList'] as const;

function wrap(text: string, start: number, end: number, marker: string): MarkdownEdit {
  const size = marker.length;
  const selected = text.slice(start, end);
  const before = text.slice(0, start);
  // `*` inside `**` is bold, not italic, so it must not be removed as an italic marker.
  const boldOnly = marker === '*' && before.endsWith('**') && !before.endsWith('***');
  if (before.endsWith(marker) && text.startsWith(marker, end) && !boldOnly)
    return {
      from: start - size,
      to: end + size,
      insert: selected,
      selection: [start - size, end - size],
    };
  if (selected.length >= size * 2 && selected.startsWith(marker) && selected.endsWith(marker))
    return {
      from: start,
      to: end,
      insert: selected.slice(size, -size),
      selection: [start, end - size * 2],
    };
  return {
    from: start,
    to: end,
    insert: `${marker}${selected}${marker}`,
    selection: [start + size, end + size],
  };
}

function lineRange(text: string, start: number, end: number) {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  // A selection ending at the start of a line does not include that line.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const newline = text.indexOf('\n', last);
  return { from, to: newline < 0 ? text.length : newline };
}

function prefixLines(
  text: string,
  start: number,
  end: number,
  command: keyof typeof linePrefixes,
  level = 0,
): MarkdownEdit {
  const { from, to } = lineRange(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const pattern = linePrefixes[command];
  const filled = lines.filter((line) => line.trim());
  const remove =
    command !== 'heading' && filled.length > 0 && filled.every((line) => pattern.test(line));
  // Lists replace one another, and a heading replaces any heading level.
  const replaced: readonly (keyof typeof linePrefixes)[] = lists.includes(
    command as (typeof lists)[number],
  )
    ? lists
    : [command];
  let number = 0;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    if (remove) return line.replace(pattern, '$1');
    let bare = line;
    for (const kind of replaced) bare = bare.replace(linePrefixes[kind], '$1');
    const indent = /^\s*/.exec(bare)![0];
    const body = bare.slice(indent.length);
    const prefix =
      command === 'bulletList'
        ? '- '
        : command === 'orderedList'
          ? `${++number}. `
          : command === 'taskList'
            ? '- [ ] '
            : command === 'blockquote'
              ? '> '
              : level
                ? `${'#'.repeat(level)} `
                : '';
    return indent + prefix + body;
  });
  const insert = next.join('\n');
  // A caret in one line follows its text; a multi-line selection keeps the whole block.
  const selection: [number, number] =
    start === end && lines.length === 1
      ? [
          Math.max(from, start + next[0].length - lines[0].length),
          Math.max(from, start + next[0].length - lines[0].length),
        ]
      : [from, from + insert.length];
  return { from, to, insert, selection };
}

function codeBlock(text: string, start: number, end: number): MarkdownEdit {
  const { from, to } = lineRange(text, start, end);
  const block = text.slice(from, to);
  const fenced = /^```[^\n]*\n([\s\S]*)\n```$/.exec(block);
  if (fenced)
    return {
      from,
      to,
      insert: fenced[1],
      selection: [from, from + fenced[1].length],
    };
  const insert = `\`\`\`\n${block}\n\`\`\``;
  return { from, to, insert, selection: [from + 4, from + 4 + block.length] };
}

function divider(text: string, start: number, end: number): MarkdownEdit {
  const { to } = lineRange(text, start, end);
  const insert = `${to > 0 ? '\n\n' : ''}---\n\n`;
  return { from: to, to, insert, selection: [to + insert.length, to + insert.length] };
}

/** Compute the edit a toolbar command makes to Markdown source with the given selection. */
export function formatMarkdown(
  text: string,
  start: number,
  end: number,
  command: MarkdownCommand,
  level = 0,
): MarkdownEdit {
  const marker = markers[command];
  if (marker) return wrap(text, start, end, marker);
  if (command === 'codeBlock') return codeBlock(text, start, end);
  if (command === 'horizontalRule') return divider(text, start, end);
  return prefixLines(text, start, end, command as keyof typeof linePrefixes, level);
}

/** Keyboard shortcuts matching the rich text editor's formatting shortcuts. */
export function markdownShortcut(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): [MarkdownCommand, number?] | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  const { code, altKey: alt, shiftKey: shift } = event;
  if (!alt && !shift) {
    if (code === 'KeyB') return ['bold'];
    if (code === 'KeyI') return ['italic'];
    if (code === 'KeyE') return ['code'];
  }
  if (!alt && shift) {
    if (code === 'KeyX') return ['strike'];
    if (code === 'Digit8') return ['bulletList'];
    if (code === 'Digit7') return ['orderedList'];
    if (code === 'Digit9') return ['taskList'];
    if (code === 'KeyB') return ['blockquote'];
  }
  if (alt && !shift) {
    if (code === 'KeyC') return ['codeBlock'];
    const heading = /^Digit([0-3])$/.exec(code);
    if (heading) return ['heading', Number(heading[1])];
  }
  return null;
}
