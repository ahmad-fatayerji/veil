export const defaultKeybinds = {
  newDocument: 'Ctrl+N',
  openDocument: 'Ctrl+O',
  saveDocument: 'Ctrl+S',
  saveDocumentAs: 'Ctrl+Shift+S',
  joinDocument: 'Ctrl+J',
  copyInvite: 'Ctrl+Shift+C',
  closeDocument: 'Ctrl+W',
  recoverControls: 'Ctrl+Alt+V',
  toggleOverlay: 'Ctrl+Alt+Shift+V',
};

export type Keybinds = typeof defaultKeybinds;
export type KeybindAction = keyof Keybinds;

export const keybindActions: { id: KeybindAction; label: string; description: string }[] = [
  {
    id: 'newDocument',
    label: 'New document',
    description: 'Create a document in a new tab.',
  },
  {
    id: 'joinDocument',
    label: 'Join with a link',
    description: 'Open the join form in a new tab.',
  },
  { id: 'copyInvite', label: 'Copy invite link', description: 'While hosting a shared document.' },
  { id: 'openDocument', label: 'Open document', description: 'Open a Markdown file in a tab.' },
  { id: 'saveDocument', label: 'Save document', description: 'Save the selected document.' },
  { id: 'saveDocumentAs', label: 'Save document as', description: 'Choose a file location.' },
  {
    id: 'closeDocument',
    label: 'Close document',
    description: 'Open the close or leave confirmation.',
  },
  {
    id: 'recoverControls',
    label: 'Restore controls',
    description: 'Global: turn off click-through and open Veil.',
  },
  {
    id: 'toggleOverlay',
    label: 'Show / hide overlay',
    description: 'Global: works while another app is focused.',
  },
];

type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

export function shortcutFromEvent(event: KeyEvent): string | null {
  if (event.metaKey || !(event.ctrlKey || event.altKey)) return null;
  if (event.code.startsWith('Numpad')) return null;
  // Letters follow the active layout: AZERTY A reports key='a', code='KeyQ'.
  // Keep number-row shortcuts stable when Shift/layout produces punctuation.
  const digit = /^Digit([0-9])$/.exec(event.code);
  const key = digit ? digit[1] : event.key.toUpperCase();
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(key)) return null;
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', key]
    .filter(Boolean)
    .join('+');
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false;
  return (
    shortcutFromEvent({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey || event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: false,
    }) === shortcut
  );
}
