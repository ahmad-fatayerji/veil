import { Copy, RefreshCw } from 'lucide-react';
import type { JoinMode } from '@veil/collaboration';
import { Banner, Button, Dialog, Field, Input, SegmentedControl } from '@veil/ui';

export function ShareDialog({
  open,
  onClose,
  started,
  link,
  joinMode,
  onJoinModeChange,
  name,
  onNameChange,
  busy,
  onStart,
  onCopy,
  onReset,
  onStop,
  onEnable,
  notice,
  error,
}: {
  open: boolean;
  onClose: () => void;
  /** Whether a sharing session exists for this document. */
  started: boolean;
  link: string;
  joinMode: JoinMode;
  onJoinModeChange: (mode: JoinMode) => void;
  name: string;
  onNameChange: (value: string) => void;
  busy: boolean;
  onStart: () => void;
  onCopy: () => void;
  onReset: () => void;
  onStop: () => void;
  onEnable: () => void;
  notice: string;
  error: string;
}) {
  return (
    <Dialog
      open={open}
      title="Share document"
      className="share-dialog"
      dismissOnBackdrop
      onClose={onClose}
    >
      {!started ? (
        <form
          className="dialog-body-form"
          onSubmit={(event) => {
            event.preventDefault();
            onStart();
          }}
        >
          <p>Invite people you trust. Everyone who joins can read and edit this document.</p>
          <Field label="Your name" htmlFor="share-name" hint="Shown to people who join.">
            <Input
              id="share-name"
              value={name}
              maxLength={40}
              placeholder="e.g. Alex"
              autoComplete="nickname"
              data-autofocus
              disabled={busy}
              aria-describedby="share-name-hint"
              onChange={(event) => onNameChange(event.target.value)}
            />
          </Field>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
              Create invite link
            </Button>
          </div>
        </form>
      ) : link ? (
        <>
          <Field
            label="Invite link"
            htmlFor="share-link"
            hint="Works until sharing stops or this host session ends. Guests need Veil installed."
          >
            <div className="input-group">
              <Input
                id="share-link"
                value={link}
                readOnly
                autoComplete="off"
                aria-describedby="share-link-hint"
                onFocus={(event) => event.target.select()}
              />
              <Button
                variant="primary"
                aria-label="Copy link"
                icon={<Copy size={16} aria-hidden="true" />}
                disabled={busy}
                onClick={onCopy}
              >
                Copy
              </Button>
            </div>
          </Field>
          <div className="field">
            <span className="field-label" id="share-join-mode-label">
              Who can join
            </span>
            <SegmentedControl
              label="Who can join"
              value={joinMode}
              disabled={busy}
              onChange={onJoinModeChange}
              options={[
                { value: 'auto', label: 'Anyone with the link' },
                { value: 'approval', label: 'Only people I approve' },
              ]}
            />
            <p className="field-hint">
              {joinMode === 'auto'
                ? 'People join and edit right away.'
                : 'You’ll see a request above the document for each guest.'}{' '}
              Changing this keeps the link and current guests.
            </p>
          </div>
          <div className="share-footer">
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={14} aria-hidden="true" />}
              disabled={busy}
              onClick={onReset}
            >
              Reset link
            </Button>
            <Button variant="danger-ghost" size="sm" disabled={busy} onClick={onStop}>
              Stop sharing
            </Button>
          </div>
        </>
      ) : (
        <>
          <Banner>
            Sharing is off. New people can’t join; current collaborators stay connected.
          </Banner>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" loading={busy} onClick={onEnable}>
              Turn sharing back on
            </Button>
          </div>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
