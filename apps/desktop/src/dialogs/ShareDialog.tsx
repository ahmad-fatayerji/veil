import { useRef } from 'react';
import { Copy, Link2, Link2Off, RefreshCw, Users } from 'lucide-react';
import type { JoinMode } from '@veil/collaboration';
import { Button, Dialog, Field, Input } from '@veil/ui';
import { HostingChoice, type HostingForm } from './HostingChoice';
import { DiscordInviteRow } from './DiscordInviteRow';
import { DiscordInviteView } from './DiscordInviteView';
import { DiscordJoinControl, JoinModeControl, SharePrivacy } from './SharePrivacy';
import { DiscordAccountAction } from './DiscordInviteRow';
import { DiscordLogo } from './DiscordLogo';
import { discordAccountMessage } from './discord-share-state';
import { discordShareState } from './discord-share-state';
import type { useDiscordPresence } from '../discord';
import type { DiscordInvitationSelection } from '../discord-invitations';

export type ShareView = 'main' | 'discord';

export function ShareDialog({
  open,
  onClose,
  view,
  onViewChange,
  started,
  link,
  othersConnected,
  joinMode,
  onJoinModeChange,
  name,
  onNameChange,
  busy,
  hosting,
  chooseHosting,
  hostingSummary,
  onChangeHosting,
  onSelfHosting,
  onStart,
  startPublicJoin,
  onStartPublicJoinChange,
  onCopy,
  discord,
  discordSelection,
  discordDocumentId,
  discordElsewhere,
  onDiscordUse,
  onDiscordPublicJoin,
  onReset,
  onStop,
  onEnable,
  notice,
  error,
}: {
  open: boolean;
  onClose: () => void;
  view: ShareView;
  onViewChange: (view: ShareView) => void;
  /** Whether a sharing session exists for this document. */
  started: boolean;
  link: string;
  /** Connected people other than the host. */
  othersConnected: number;
  joinMode: JoinMode;
  onJoinModeChange: (mode: JoinMode) => void;
  name: string;
  onNameChange: (value: string) => void;
  busy: boolean;
  hosting: HostingForm;
  /** Ask where to host before the first invitation, instead of naming the saved server. */
  chooseHosting: boolean;
  hostingSummary: string;
  onChangeHosting: () => void;
  onSelfHosting: () => void;
  /** Creates the link; 'discord' opens the friend list right after. */
  onStart: (view?: ShareView) => void;
  /** Joining from Discord chosen before the link exists. */
  startPublicJoin: boolean;
  onStartPublicJoinChange: (publicJoin: boolean) => void;
  onCopy: () => void;
  discord: ReturnType<typeof useDiscordPresence>;
  discordSelection: Readonly<DiscordInvitationSelection> | null;
  discordDocumentId: string;
  /** Title of another document that currently holds Discord invites. */
  discordElsewhere: string | null;
  /** Points Discord at this document; returns the title it moved from, if any. */
  onDiscordUse: () => string | null;
  onDiscordPublicJoin: (publicJoin: boolean) => void;
  onReset: () => void;
  onStop: () => void;
  onEnable: () => void;
  notice: string;
  error: string;
}) {
  const discordRow = useRef<HTMLButtonElement>(null);
  const discordState = discordShareState({
    available: discord.social.available,
    connection: discord.connection,
    preferences: discord.preferences,
    link,
  });
  const startDiscord = discordShareState({
    available: discord.social.available,
    connection: discord.connection,
    preferences: discord.preferences,
    link: null,
  });
  const discordEnabled = discordSelection?.documentId === discordDocumentId;
  const elsewhere = discordEnabled ? null : discordElsewhere;
  const showDiscord = started && !!link && view === 'discord' && discordState.kind !== 'hidden';
  function back() {
    onViewChange('main');
    requestAnimationFrame(() => discordRow.current?.focus());
  }
  return (
    <Dialog
      open={open}
      title={showDiscord ? 'Invite Discord friends' : 'Share document'}
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
          <JoinModeControl
            value={joinMode}
            disabled={busy}
            onChange={onJoinModeChange}
            started={false}
          />
          {startDiscord.kind === 'ready' ? (
            <DiscordJoinControl
              publicJoin={startPublicJoin}
              disabled={busy}
              onChange={onStartPublicJoinChange}
            />
          ) : startDiscord.kind === 'account' ? (
            <div className="discord-invite-row">
              <span className="discord-card-icon" aria-hidden="true">
                <DiscordLogo size={20} />
              </span>
              <div className="discord-card-copy">
                <strong>Invite Discord friends</strong>
                <p role={startDiscord.connection.status === 'error' ? 'alert' : 'status'}>
                  {discordAccountMessage(startDiscord.connection)}
                </p>
              </div>
              <DiscordAccountAction connection={startDiscord.connection} />
            </div>
          ) : startDiscord.kind === 'needs-activity' ? (
            <div className="share-consent-card">
              <div>
                <strong>Discord invites need activity sharing</strong>
                <p>Your Discord status will show you’re in a Veil document.</p>
              </div>
              <Button
                size="sm"
                loading={discord.saving}
                disabled={!discord.preferences}
                onClick={() =>
                  void discord.configure({ enabled: true, showParticipantCount: true })
                }
              >
                Turn on
              </Button>
            </div>
          ) : null}
          {chooseHosting ? (
            <div className="field">
              <span className="field-label">Where to host</span>
              <HostingChoice
                id="share"
                hosting={hosting}
                busy={busy}
                onSelfHosting={onSelfHosting}
              />
              <p className="field-hint">You can change this anytime in Settings.</p>
            </div>
          ) : (
            <p className="share-hosting">
              Hosted on <strong>{hostingSummary}</strong>
              <button type="button" className="text-link" disabled={busy} onClick={onChangeHosting}>
                Change
              </button>
            </p>
          )}
          <div className="dialog-actions">
            <Button onClick={onClose}>Cancel</Button>
            {startDiscord.kind === 'ready' && (
              <Button
                icon={<DiscordLogo size={16} />}
                disabled={busy || !name.trim() || (chooseHosting && !hosting.server.trim())}
                onClick={() => onStart('discord')}
              >
                Create &amp; invite on Discord
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!name.trim() || (chooseHosting && !hosting.server.trim())}
            >
              Create invite link
            </Button>
          </div>
        </form>
      ) : !link ? (
        <form
          className="dialog-body-form"
          onSubmit={(event) => {
            event.preventDefault();
            onEnable();
          }}
        >
          <div className="share-off-card" role="status">
            <span className="share-off-icon" aria-hidden="true">
              <Link2Off size={18} />
            </span>
            <div>
              <h3>Sharing is off</h3>
              <p>
                New people can’t join.{' '}
                {othersConnected === 0
                  ? 'No one else is connected.'
                  : `${othersConnected} ${othersConnected === 1 ? 'person is' : 'people are'} still here and can keep editing.`}
              </p>
            </div>
          </div>
          <JoinModeControl
            value={joinMode}
            disabled={busy}
            onChange={onJoinModeChange}
            started={false}
          />
          {startDiscord.kind === 'ready' && (
            <DiscordJoinControl
              publicJoin={startPublicJoin}
              disabled={busy}
              onChange={onStartPublicJoinChange}
            />
          )}
          <div className="share-off-actions">
            <p className="field-hint">You’ll get a new link. The old one stays off.</p>
            <div className="dialog-actions">
              <Button onClick={onClose}>Close</Button>
              <Button
                type="submit"
                variant="primary"
                icon={<Link2 size={16} aria-hidden="true" />}
                loading={busy}
                data-autofocus
              >
                Share again
              </Button>
            </div>
          </div>
        </form>
      ) : showDiscord ? (
        <DiscordInviteView
          state={discordState}
          discord={discord}
          selection={discordSelection}
          documentId={discordDocumentId}
          joinMode={joinMode}
          busy={busy}
          onUse={onDiscordUse}
          onBack={back}
        />
      ) : (
        <>
          <p className="share-status" role="status">
            <Users size={14} aria-hidden="true" />
            {othersConnected === 0
              ? 'No one has joined yet'
              : `${othersConnected} ${othersConnected === 1 ? 'person' : 'people'} connected`}
          </p>
          <section className="share-section" aria-labelledby="share-invite-heading">
            <h3 id="share-invite-heading" className="share-section-title">
              Invite people
            </h3>
            <Field
              label="Invite link"
              htmlFor="share-link"
              hint={
                joinMode === 'auto'
                  ? 'Anyone with Veil and this link can join until you reset it or stop sharing.'
                  : 'People with this link can ask to join until you reset it or stop sharing.'
              }
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
            <DiscordInviteRow
              ref={discordRow}
              state={discordState}
              connection={discord.connection}
              publicJoin={discordEnabled && !!discordSelection?.publicJoin}
              busy={busy}
              onOpen={() => onViewChange('discord')}
            />
          </section>
          <SharePrivacy
            joinMode={joinMode}
            onJoinModeChange={onJoinModeChange}
            busy={busy}
            discord={discordState}
            publicJoin={discordEnabled && !!discordSelection?.publicJoin}
            discordElsewhere={elsewhere}
            onPublicJoinChange={onDiscordPublicJoin}
          />
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
