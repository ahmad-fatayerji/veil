import { useEffect } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration, { isChangeOrigin } from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { DOCUMENT_FRAGMENT } from '@veil/protocol';
import {
  participantColor,
  participantName,
  type DemoConnection,
  type ParticipantActivity,
} from '@veil/collaboration';

export type EditorConnection = Pick<DemoConnection, 'doc'> & {
  provider: Pick<DemoConnection['provider'], 'awareness'>;
};

export function SharedEditor({
  connection,
  compact = false,
}: {
  connection: EditorConnection;
  compact?: boolean;
}) {
  const { doc, provider } = connection;
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false, link: false, underline: false }),
        Collaboration.configure({ document: doc, field: DOCUMENT_FRAGMENT }),
        CollaborationCaret.configure({
          provider,
          user: provider.awareness.getLocalState()?.user,
          render: (user) => {
            const caret = document.createElement('span');
            caret.className = 'collaboration-carets__caret';
            caret.style.borderColor = participantColor(user.color);
            caret.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'collaboration-carets__label';
            // CSS renders the name, keeping presence labels out of document text and copies.
            label.dataset.name = participantName(user.name);
            label.style.backgroundColor = participantColor(user.color);
            caret.append(label);
            return caret;
          },
          selectionRender: (user) => ({
            class: 'collaboration-selection',
            style: `background-color: ${participantColor(user.color)}25`,
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
    [doc, provider, compact],
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

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold') ?? false,
      heading: editor?.isActive('heading') ?? false,
      bullets: editor?.isActive('bulletList') ?? false,
    }),
  });
  return (
    <>
      {!compact && (
        <div
          className="editor-toolbar"
          role="toolbar"
          aria-label="Document formatting"
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            aria-label="Bold"
            title="Bold (Ctrl+B)"
            aria-pressed={state?.bold}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            aria-label="Heading"
            title="Heading"
            aria-pressed={state?.heading}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            H<span className="subscript">2</span>
          </button>
          <button
            type="button"
            aria-label="Bullet list"
            title="Bullet list"
            aria-pressed={state?.bullets}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M9 6h11M9 12h11M9 18h11" />
              <circle cx="4" cy="6" r="1" />
              <circle cx="4" cy="12" r="1" />
              <circle cx="4" cy="18" r="1" />
            </svg>
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
    </>
  );
}
