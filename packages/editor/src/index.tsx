import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type * as Y from 'yjs';
import { documentExtensions } from './schema';
import { applyMarkdown, markdownOrigin, saveMarkdown } from './markdown';
import { formatMarkdown, markdownShortcut, type MarkdownCommand } from './markdown-format';

type SourceCommand = (command: MarkdownCommand, level?: number) => void;
import Collaboration, { isChangeOrigin } from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Ellipsis,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react';
import { DOCUMENT_FRAGMENT } from '@veil/protocol';
import {
  participantColor,
  participantName,
  type DemoConnection,
  type ParticipantActivity,
} from '@veil/collaboration';

export { DocumentTitle, useDocumentTitle, applyText, transformIndex } from './title';
export {
  applyMarkdown,
  documentFingerprint,
  loadMarkdown,
  markdownOrigin,
  saveMarkdown,
  suggestedFilename,
} from './markdown';

export type EditorConnection = Pick<DemoConnection, 'doc'> & {
  provider: Pick<DemoConnection['provider'], 'awareness'>;
};

/** How a compact editor offers formatting; shortcuts and Markdown typing always work. */
export type EditorFormatting = 'bubble' | 'toolbar' | 'none';

export function SharedEditor({
  connection,
  compact = false,
  header,
  aside,
  mode: controlledMode,
  onModeChange,
  formatting = 'bubble',
}: {
  connection: EditorConnection;
  compact?: boolean;
  /** Rendered above the document inside the scrolling column, e.g. the title. */
  header?: ReactNode;
  /** Rendered between the toolbar and the scrolling document, e.g. join requests. */
  aside?: ReactNode;
  /** Controls the view from outside, e.g. the overlay header; otherwise the editor owns it. */
  mode?: EditorMode;
  onModeChange?: (mode: EditorMode) => void;
  /** Formatting controls for the compact editor. */
  formatting?: EditorFormatting;
}) {
  const { doc, provider } = connection;
  // Each person chooses their own view; both edit the same shared document.
  const [ownMode, setOwnMode] = useState<EditorMode>('rich');
  const mode = controlledMode ?? ownMode;
  const source = useRef<SourceCommand | null>(null);
  const editor = useEditor(
    {
      shouldRerenderOnTransaction: false,
      extensions: [
        ...documentExtensions,
        Collaboration.configure({ document: doc, field: DOCUMENT_FRAGMENT }),
        CollaborationCaret.configure({
          provider,
          user: provider.awareness.getLocalState()?.user,
          render: (user) => {
            const caret = document.createElement('span');
            caret.className = 'collaboration-carets__caret';
            caret.style.setProperty('--collaboration-color', participantColor(user.color));
            caret.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'collaboration-carets__label';
            // CSS renders the name, keeping presence labels out of document text and copies.
            label.dataset.name = participantName(user.name);
            caret.append(label);
            return caret;
          },
          selectionRender: (user) => ({
            class: 'collaboration-selection',
            style: `background-color: color-mix(in srgb, ${participantColor(user.color)} 22%, transparent)`,
            'data-selection-user': participantName(user.name),
          }),
        }),
      ],
      editorProps: {
        attributes: {
          class: 'document-editor',
          'aria-label': 'Shared document',
          role: 'textbox',
          'aria-multiline': 'true',
          'data-placeholder': 'Start writing…',
        },
      },
    },
    [doc, provider],
  );

  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let typing = false;
    function publish(activity: ParticipantActivity) {
      if (provider.awareness.getLocalState()?.activity !== activity) {
        provider.awareness.setLocalStateField('activity', activity);
      }
    }
    function resting(): ParticipantActivity {
      if (!editor!.isFocused || document.visibilityState === 'hidden') return 'away';
      return editor!.state.selection.empty ? 'document' : 'selecting';
    }
    const update: Parameters<typeof editor.on<'update'>>[1] = ({ transaction }) => {
      if (isChangeOrigin(transaction)) return;
      typing = true;
      publish('typing');
      clearTimeout(timer);
      timer = setTimeout(() => {
        typing = false;
        publish(resting());
      }, 1600);
    };
    const selection = () => {
      if (!typing) publish(resting());
    };
    const blur = () => {
      typing = false;
      clearTimeout(timer);
      publish('away');
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') blur();
      else selection();
    };
    editor.on('update', update);
    editor.on('selectionUpdate', selection);
    editor.on('focus', selection);
    editor.on('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      editor.off('update', update);
      editor.off('selectionUpdate', selection);
      editor.off('focus', selection);
      editor.off('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [editor, provider]);

  const changeMode = (next: EditorMode) => {
    if (controlledMode === undefined) setOwnMode(next);
    onModeChange?.(next);
    if (next === 'rich') requestAnimationFrame(() => editor?.commands.focus());
  };
  // In the Markdown view, formatting buttons insert Markdown syntax instead.
  const toolbar = (compactToolbar: boolean) => (
    <EditorToolbar
      editor={mode === 'rich' ? editor : null}
      onSource={
        mode === 'markdown' ? (command, level) => source.current?.(command, level) : undefined
      }
      mode={mode}
      onModeChange={changeMode}
      compact={compactToolbar}
    />
  );
  // The rich editor stays mounted while hidden, keeping its undo history and binding.
  if (compact)
    return (
      <>
        {formatting === 'toolbar' && toolbar(true)}
        {formatting === 'bubble' && editor && mode === 'rich' && (
          <SelectionToolbar editor={editor} />
        )}
        {mode === 'markdown' && <MarkdownSource doc={doc} commandRef={source} />}
        <div className="editor-compact" hidden={mode === 'markdown'}>
          <EditorContent editor={editor} />
        </div>
      </>
    );
  return (
    <>
      {toolbar(false)}
      {aside}
      {mode === 'markdown' && <MarkdownSource doc={doc} commandRef={source} />}
      <div
        className="editor-scroll"
        hidden={mode === 'markdown'}
        onMouseDown={(event) => {
          // Clicking the empty page below the text continues writing at the end.
          if (
            event.target === event.currentTarget ||
            event.target === event.currentTarget.firstChild
          ) {
            event.preventDefault();
            editor?.chain().focus('end').run();
          }
        }}
      >
        <div className="editor-column">
          {header}
          <EditorContent editor={editor} />
        </div>
      </div>
    </>
  );
}

export type EditorMode = 'rich' | 'markdown';

/** Map a caret through a whole-text replacement, keeping it within unchanged text. */
function mapCaret(previous: string, next: string, index: number) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  if (index <= start) return index;
  let end = 0;
  while (
    end < previous.length - start &&
    end < next.length - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  )
    end++;
  if (index >= previous.length - end) return index + next.length - previous.length;
  return next.length - end;
}

/**
 * Editable Markdown for the shared document. Every change is applied to the document at
 * once, so collaborators' edits arriving later are merged into the source, not overwritten.
 */
function MarkdownSource({
  doc,
  commandRef,
}: {
  doc: Y.Doc;
  commandRef: { current: SourceCommand | null };
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => saveMarkdown(doc));
  const current = useRef(text);
  const caret = useRef<[number, number] | null>(null);
  const [error, setError] = useState('');
  // Formatting goes through the browser's text editing, so Ctrl+Z undoes it like typing.
  const format: SourceCommand = (command, level) => {
    const element = area.current;
    if (!element) return;
    const edit = formatMarkdown(
      element.value,
      element.selectionStart,
      element.selectionEnd,
      command,
      level,
    );
    element.focus();
    element.setSelectionRange(edit.from, edit.to);
    const inserted = edit.insert
      ? document.execCommand('insertText', false, edit.insert)
      : edit.from === edit.to || document.execCommand('delete');
    if (!inserted) {
      element.setRangeText(edit.insert, edit.from, edit.to);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.setSelectionRange(...edit.selection);
  };
  useEffect(() => {
    commandRef.current = format;
    return () => {
      commandRef.current = null;
    };
  });
  useEffect(() => {
    const refresh = (_update: Uint8Array, origin: unknown) => {
      // Own edits keep the text exactly as typed instead of re-serializing it.
      if (origin === markdownOrigin) return;
      const previous = current.current;
      const next = saveMarkdown(doc);
      if (next === previous) return;
      const element = area.current;
      if (element && document.activeElement === element)
        caret.current = [
          mapCaret(previous, next, element.selectionStart),
          mapCaret(previous, next, element.selectionEnd),
        ];
      current.current = next;
      setText(next);
    };
    doc.on('update', refresh);
    return () => doc.off('update', refresh);
  }, [doc]);
  useLayoutEffect(() => {
    if (!caret.current || !area.current) return;
    area.current.setSelectionRange(...caret.current);
    caret.current = null;
  }, [text]);
  return (
    <div className="editor-scroll markdown-scroll">
      <div className="editor-column">
        <textarea
          ref={area}
          className="markdown-source"
          aria-label="Markdown source"
          spellCheck={false}
          autoFocus
          value={text}
          onKeyDown={(event) => {
            const shortcut = markdownShortcut(event);
            if (!shortcut || event.repeat || event.nativeEvent.isComposing) return;
            event.preventDefault();
            format(...shortcut);
          }}
          onChange={(event) => {
            const value = event.target.value;
            current.current = value;
            setText(value);
            try {
              applyMarkdown(doc, value);
              setError('');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        />
        {error && (
          <p className="error" role="alert">
            This Markdown could not be applied: {error}
          </p>
        )}
      </div>
    </div>
  );
}

type Command = {
  id: string;
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  run: (editor: Editor) => void;
};

const inlineCommands: Command[] = [
  {
    id: 'bold',
    label: 'Bold',
    shortcut: 'Ctrl+B',
    icon: Bold,
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    label: 'Italic',
    shortcut: 'Ctrl+I',
    icon: Italic,
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    shortcut: 'Ctrl+Shift+X',
    icon: Strikethrough,
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: 'code',
    label: 'Inline code',
    shortcut: 'Ctrl+E',
    icon: Code,
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
];

const blockCommands: Command[] = [
  {
    id: 'bulletList',
    label: 'Bulleted list',
    shortcut: 'Ctrl+Shift+8',
    icon: List,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: 'Numbered list',
    shortcut: 'Ctrl+Shift+7',
    icon: ListOrdered,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    label: 'Checklist',
    shortcut: 'Ctrl+Shift+9',
    icon: ListTodo,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    label: 'Quote',
    shortcut: 'Ctrl+Shift+B',
    icon: Quote,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    label: 'Code block',
    shortcut: 'Ctrl+Alt+C',
    icon: SquareCode,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'horizontalRule',
    label: 'Divider',
    icon: Minus,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

const textStyles = [
  { level: 0, label: 'Text', shortcut: 'Ctrl+Alt+0' },
  { level: 1, label: 'Heading 1', shortcut: 'Ctrl+Alt+1' },
  { level: 2, label: 'Heading 2', shortcut: 'Ctrl+Alt+2' },
  { level: 3, label: 'Heading 3', shortcut: 'Ctrl+Alt+3' },
] as const;

function setTextStyle(editor: Editor, level: 0 | 1 | 2 | 3) {
  if (level === 0) editor.chain().focus().setParagraph().run();
  else editor.chain().focus().setHeading({ level }).run();
}

function ToolbarButton({
  command,
  active,
  disabled,
  onRun,
}: {
  command: Command;
  active: boolean;
  disabled: boolean;
  onRun: (command: Command) => void;
}) {
  const Icon = command.icon;
  const isToggle = command.id !== 'horizontalRule';
  return (
    <button
      type="button"
      className="toolbar-button"
      aria-label={command.label}
      title={command.shortcut ? `${command.label} (${command.shortcut})` : command.label}
      aria-pressed={isToggle ? active : undefined}
      disabled={disabled}
      onClick={() => onRun(command)}
    >
      <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}

const selectionCommands = [
  ...inlineCommands,
  ...blockCommands.filter((command) =>
    ['bulletList', 'orderedList', 'taskList', 'blockquote'].includes(command.id),
  ),
];

/** A small toolbar floating above a text selection, for compact editors such as the overlay. */
function SelectionToolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      Object.fromEntries(
        selectionCommands.map((command) => [command.id, editor?.isActive(command.id) ?? false]),
      ),
  });
  return (
    <BubbleMenu
      editor={editor}
      className="selection-toolbar"
      // Keep the toolbar clear of the window edges in small windows.
      options={{ placement: 'top', offset: 8, shift: { padding: 8 }, flip: { padding: 8 } }}
      shouldShow={({ editor, state }) =>
        editor.isEditable && !state.selection.empty && !editor.isActive('codeBlock')
      }
    >
      <div
        role="toolbar"
        aria-label="Formatting"
        onMouseDown={(event) => {
          // Keep the text selection while using the toolbar.
          if ((event.target as HTMLElement).closest('button')) event.preventDefault();
        }}
      >
        {selectionCommands.map((command, index) => (
          <span key={command.id} style={{ display: 'contents' }}>
            {index === inlineCommands.length && (
              <span className="toolbar-separator" aria-hidden="true" />
            )}
            <ToolbarButton
              command={command}
              active={!!active?.[command.id]}
              disabled={false}
              onRun={(item) => item.run(editor)}
            />
          </span>
        ))}
      </div>
    </BubbleMenu>
  );
}

function EditorToolbar({
  editor,
  onSource,
  mode,
  onModeChange,
  compact = false,
}: {
  editor: Editor | null;
  /** Receives commands as Markdown edits while the source view is shown. */
  onSource?: SourceCommand;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  /** A slimmer toolbar without the view switch, whose host provides one. */
  compact?: boolean;
}) {
  const disabled = !editor && !onSource;
  const run = (command: Command) => {
    if (editor) command.run(editor);
    else onSource?.(command.id as MarkdownCommand);
  };
  const applyStyle = (value: 0 | 1 | 2 | 3) => {
    if (editor) setTextStyle(editor, value);
    else onSource?.('heading', value);
  };
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const active: Record<string, boolean> = {};
      for (const command of [...inlineCommands, ...blockCommands])
        active[command.id] = editor?.isActive(command.id) ?? false;
      const level = ([1, 2, 3] as const).find((value) =>
        editor?.isActive('heading', { level: value }),
      );
      return { active, level: level ?? 0 };
    },
  });
  // Without a rich editor (the Markdown view) nothing is active; don't show stale state.
  const active = editor ? (state?.active ?? {}) : {};
  const level = editor ? (state?.level ?? 0) : 0;
  return (
    <div
      className={`editor-toolbar${compact ? ' is-compact' : ''}`}
      role="toolbar"
      aria-label="Document formatting"
      onMouseDown={(event) => {
        // Keep the document selection while using the toolbar.
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      <div className="toolbar-inner">
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger
            className="toolbar-style"
            aria-label={`Text style: ${textStyles[level].label}`}
            disabled={disabled}
          >
            <span>{textStyles[level].label}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="menu"
              align="start"
              sideOffset={6}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                editor?.commands.focus();
              }}
            >
              {textStyles.map((style) => (
                <DropdownMenu.Item
                  key={style.level}
                  className="menu-item"
                  onSelect={() => applyStyle(style.level)}
                >
                  <span className={`menu-style-${style.level}`}>{style.label}</span>
                  {style.level === level ? (
                    <Check size={16} className="menu-item-check" aria-label="Current style" />
                  ) : (
                    <kbd className="kbd">{style.shortcut}</kbd>
                  )}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <span className="toolbar-separator" aria-hidden="true" />
        <div className="toolbar-group">
          {inlineCommands.map((command) => (
            <ToolbarButton
              key={command.id}
              command={command}
              disabled={disabled}
              onRun={run}
              active={!!active[command.id]}
            />
          ))}
        </div>
        <span className="toolbar-separator" data-collapsible aria-hidden="true" />
        <div className="toolbar-group" data-collapsible>
          {blockCommands.map((command) => (
            <ToolbarButton
              key={command.id}
              command={command}
              disabled={disabled}
              onRun={run}
              active={!!active[command.id]}
            />
          ))}
        </div>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger
            className="toolbar-button toolbar-overflow"
            aria-label="More formatting"
            title="More formatting"
            disabled={disabled}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="menu"
              align="end"
              sideOffset={6}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                editor?.commands.focus();
              }}
            >
              {blockCommands.map((command) => {
                const Icon = command.icon;
                return (
                  <DropdownMenu.Item
                    key={command.id}
                    className="menu-item"
                    onSelect={() => run(command)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {command.label}
                    {active[command.id] && (
                      <Check size={16} className="menu-item-check" aria-label="On" />
                    )}
                  </DropdownMenu.Item>
                );
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <div className="editor-mode" role="group" aria-label="Editor view" hidden={compact}>
          {(
            [
              ['rich', 'Rich text'],
              ['markdown', 'Markdown'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => mode !== value && onModeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
