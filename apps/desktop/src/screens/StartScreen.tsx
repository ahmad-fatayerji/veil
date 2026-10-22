import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, FilePlus2, FolderOpen, Link2 } from 'lucide-react';
import { parseShareLink, decodeServerInvitation } from '@veil/protocol';
import { Button, Field, Input, Kbd, Textarea } from '@veil/ui';
import type { Keybinds } from '../keybinds';

export function invitationError(value: string, development: boolean) {
  const text = value.trim();
  if (!text) return '';
  try {
    if (text.startsWith('veil://')) parseShareLink(text, development);
    else decodeServerInvitation(text, development);
    return '';
  } catch {
    return 'This doesn’t look like a Veil invitation. Ask the host for a new link.';
  }
}

function isEditable(element: Element | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

export function StartScreen({
  name,
  onNameChange,
  invitation,
  onInvitationChange,
  joinOpen,
  onJoinOpenChange,
  busy,
  development,
  onCreate,
  onJoin,
  onOpen,
  keybinds,
  shortcutsDisabled,
  active = true,
}: {
  name: string;
  onNameChange: (value: string) => void;
  invitation: string;
  onInvitationChange: (value: string) => void;
  joinOpen: boolean;
  onJoinOpenChange: (open: boolean) => void;
  busy: boolean;
  development: boolean;
  onCreate: () => void;
  onJoin: () => void;
  onOpen?: () => void;
  keybinds: Keybinds;
  shortcutsDisabled: boolean;
  active?: boolean;
}) {
  const formId = useId();
  const joinRow = useRef<HTMLButtonElement>(null);
  const joinButton = useRef<HTMLButtonElement>(null);
  const invitationInput = useRef<HTMLTextAreaElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [invitationTouched, setInvitationTouched] = useState(false);
  const closeJoin = () => {
    onJoinOpenChange(false);
    // The card only exists once the form has closed, so wait a frame.
    requestAnimationFrame(() => joinRow.current?.focus());
  };
  const error = invitationTouched ? invitationError(invitation, development) : '';
  const canJoin = !!name.trim() && !!invitation.trim() && !invitationError(invitation, development);

  // Move focus to the first thing still needed whenever the join form opens.
  useEffect(() => {
    if (!joinOpen) return;
    if (!invitation.trim()) invitationInput.current?.focus();
    else if (!name.trim()) nameInput.current?.focus();
    else joinButton.current?.focus();
    // Only when the panel opens; typing must not move focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinOpen]);

  useEffect(() => {
    // Pasting an invitation anywhere on the start screen opens the join form with it.
    const paste = (event: ClipboardEvent) => {
      if (
        !active ||
        busy ||
        shortcutsDisabled ||
        document.querySelector('dialog[open]') ||
        isEditable(document.activeElement)
      )
        return;
      const text = event.clipboardData?.getData('text').trim() ?? '';
      if (!text.startsWith('veil://')) return;
      event.preventDefault();
      onInvitationChange(text);
      setInvitationTouched(true);
      if (joinOpen) (name.trim() ? joinButton : nameInput).current?.focus();
      else onJoinOpenChange(true);
    };
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('paste', paste);
    };
  }, [busy, joinOpen, name, onInvitationChange, onJoinOpenChange, shortcutsDisabled, active]);

  const card = (
    props: {
      title: string;
      description: string;
      shortcut: string;
      icon: ReactNode;
      onClick: () => void;
    } & Record<string, unknown>,
  ) => {
    const { title, description, shortcut, icon, onClick, ...rest } = props;
    return (
      <button type="button" className="start-card" disabled={busy} onClick={onClick} {...rest}>
        <span className="start-card-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="start-card-text">
          <span className="start-card-title">{title}</span>
          <span className="start-card-description">{description}</span>
        </span>
        <span className="start-card-shortcut">
          <Kbd>{shortcut}</Kbd>
        </span>
      </button>
    );
  };

  return (
    <main className="launcher">
      <div className="launcher-inner">
        <div className="launcher-intro">
          <h1>Veil</h1>
          <p>Shared notes with a private overlay.</p>
        </div>
        {!joinOpen ? (
          <div className="start-cards">
            {card({
              title: 'New document',
              description: 'Start writing now and share when ready',
              shortcut: keybinds.newDocument,
              icon: <FilePlus2 size={20} />,
              onClick: onCreate,
            })}
            {card({
              title: 'Open document',
              description: 'Open a Markdown file from your computer',
              shortcut: keybinds.openDocument,
              icon: <FolderOpen size={20} />,
              onClick: () => onOpen?.(),
            })}
            {card({
              ref: joinRow,
              title: 'Join with a link',
              description: 'Paste an invitation from the host',
              shortcut: keybinds.joinDocument,
              icon: <Link2 size={20} />,
              onClick: () => onJoinOpenChange(true),
              'aria-expanded': false,
              'aria-controls': `${formId}-join-panel`,
            })}
          </div>
        ) : (
          <form
            id={`${formId}-join-panel`}
            className="join-panel"
            aria-label="Join a session"
            onSubmit={(event) => {
              event.preventDefault();
              setInvitationTouched(true);
              if (canJoin) onJoin();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) {
                event.preventDefault();
                closeJoin();
              }
            }}
          >
            <button type="button" className="join-back" disabled={busy} onClick={closeJoin}>
              <ArrowLeft size={16} aria-hidden="true" />
              Back
            </button>
            <Field label="Invite link" htmlFor={`${formId}-automatic-invitation`} error={error}>
              <Textarea
                ref={invitationInput}
                id={`${formId}-automatic-invitation`}
                placeholder="veil://join/…"
                autoComplete="off"
                rows={2}
                value={invitation}
                maxLength={4096}
                disabled={busy}
                aria-invalid={!!error || undefined}
                aria-describedby={error ? `${formId}-automatic-invitation-error` : undefined}
                onChange={(event) => onInvitationChange(event.target.value)}
                onBlur={() => setInvitationTouched(true)}
              />
            </Field>
            <Field
              label="Your name"
              htmlFor={`${formId}-automatic-name`}
              hint="Shown to the host and everyone in the document."
            >
              <Input
                ref={nameInput}
                id={`${formId}-automatic-name`}
                autoComplete="nickname"
                placeholder="e.g. Alex"
                value={name}
                maxLength={40}
                disabled={busy}
                aria-describedby={`${formId}-automatic-name-hint`}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </Field>
            <div className="dialog-actions">
              <Button variant="ghost" disabled={busy} onClick={closeJoin}>
                Cancel
              </Button>
              <Button
                ref={joinButton}
                type="submit"
                variant="primary"
                loading={busy}
                disabled={!canJoin}
              >
                {busy ? 'Connecting…' : 'Join session'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
