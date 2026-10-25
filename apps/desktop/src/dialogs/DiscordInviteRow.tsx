import type { Ref } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@veil/ui';
import type { DiscordConnectionView } from '../discord-social';
import { DiscordAvatar } from './DiscordAvatar';
import { DiscordLogo } from './DiscordLogo';
import { discordAccountMessage, type DiscordShareState } from './discord-share-state';

/** Connect, reconnect or cancel in place, so the Share dialog never closes for Settings. */
export function DiscordAccountAction({ connection }: { connection: DiscordConnectionView }) {
  switch (connection.status) {
    case 'disconnected':
      return (
        <Button size="sm" onClick={connection.connect}>
          Connect Discord
        </Button>
      );
    case 'expired':
      return (
        <Button size="sm" onClick={connection.reconnect}>
          Reconnect
        </Button>
      );
    case 'authorizing':
    case 'connecting':
      return (
        <Button size="sm" variant="ghost" onClick={connection.cancel}>
          Cancel
        </Button>
      );
    case 'error':
      return (
        <Button size="sm" onClick={connection.retry}>
          Try again
        </Button>
      );
    default:
      return null;
  }
}

export function DiscordInviteRow({
  state,
  connection,
  enabled,
  busy,
  onOpen,
  ref,
}: {
  state: DiscordShareState;
  connection: DiscordConnectionView;
  /** Whether this document currently allows Discord invites. */
  enabled: boolean;
  busy: boolean;
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  if (state.kind === 'hidden') return null;
  const person =
    connection.status === 'connected' || connection.status === 'reconnecting'
      ? connection.person
      : null;
  const icon = person ? (
    <DiscordAvatar person={person} />
  ) : (
    <span className="discord-card-icon" aria-hidden="true">
      <DiscordLogo size={20} />
    </span>
  );
  if (state.kind === 'account')
    return (
      <div className="discord-invite-row">
        {icon}
        <div className="discord-card-copy">
          <strong>Invite Discord friends</strong>
          <p role={state.connection.status === 'error' ? 'alert' : 'status'}>
            {discordAccountMessage(state.connection)}
          </p>
        </div>
        <DiscordAccountAction connection={state.connection} />
      </div>
    );
  const detail =
    state.kind === 'link'
      ? state.message
      : `@${person?.username ?? ''} · ${enabled ? 'Invites on for this document' : 'Invites off for this document'}`;
  return (
    <button
      ref={ref}
      type="button"
      className="discord-invite-row discord-invite-row-button"
      disabled={busy || state.kind === 'link'}
      onClick={onOpen}
    >
      {icon}
      <span className="discord-card-copy">
        <strong>Invite Discord friends</strong>
        <span className="discord-invite-row-detail">{detail}</span>
      </span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
}
