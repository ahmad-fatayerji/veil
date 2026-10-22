import StarterKit from '@tiptap/starter-kit';
import Strike from '@tiptap/extension-strike';
import { TaskItem, TaskList } from '@tiptap/extension-list';

// The editor and file codec must use exactly the same document schema.
export const documentExtensions = [
  StarterKit.configure({
    undoRedo: false,
    link: false,
    underline: false,
    strike: false,
    heading: { levels: [1, 2, 3] },
  }),
  Strike.extend({
    addKeyboardShortcuts() {
      return { 'Mod-Shift-x': () => this.editor.commands.toggleStrike() };
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
];
