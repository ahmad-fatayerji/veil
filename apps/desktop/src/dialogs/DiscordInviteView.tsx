import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { JoinMode } from '@veil/collaboration';
import { Banner, Button } from '@veil/ui';
import type { useDiscordPresence } from '../discord';
import type { DiscordInvitationSelection } from '../discord-invitations';
import { DiscordAvatar } from './DiscordAvatar';
import { DiscordFriendPicker } from './DiscordFriendPicker';
import { DiscordAccountAction } from './DiscordInviteRow';
import { discordAccountMessage, type DiscordShareState } from './discord-share-state';

export function DiscordInviteView({
  state,
  discord,
  selection,
  documentId,
  discordElsewhere,
  joinMode,
  busy,
  onEnable,
  onBack,
}: {
  state: DiscordShareState;
  discord: ReturnType<typeof useDiscordPresence>;
  selection: Readonly<DiscordInvitationSelection> | null;
  documentId: string;
  discordElsewhere: string | null;
  joinMode: JoinMode;
  busy: boolean;
  onEnable: () => void;
  onBack: () => void;
}) {
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    view.current?.querySelector<HTMLElement>('input[type="search"]')?.focus();
  }, []);
  const connection = discord.connection;
  const person = connection.status === 'connected' ? connection.person : null;
  const enabled = selection?.documentId === documentId;
  return (
    <div ref={view} className="share-subview">
      <button type="button" className="join-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to sharing
      </button>
      {person && (
        <div className="discord-account-line">
          <DiscordAvatar person={person} small />
          <span>
            Inviting as <strong>{person.displayName || person.username}</strong>
          </span>
        </div>
      )}
      {state.kind === 'account' ? (
        <Banner
          tone={state.connection.status === 'error' ? 'danger' : 'neutral'}
          actions={<DiscordAccountAction connection={state.connection} />}
        >
          {discordAccountMessage(state.connection)}
        </Banner>
      ) : state.kind === 'needs-activity' ? (
        <div className="share-consent-card">
          <div>
            <strong>Discord invites need activity sharing</strong>
            <p>
              Discord delivers invites through your status, which will show you’re in a Veil
              document and how many people are in it.
            </p>
          </div>
          <Button
            size="sm"
            variant="primary"
            loading={discord.saving}
            disabled={!discord.preferences}
            onClick={() => void discord.configure({ enabled: true, showParticipantCount: true })}
          >
            Turn on
          </Button>
        </div>
      ) : state.kind === 'link' ? (
        <Banner tone="warning">{state.message}</Banner>
      ) : (
        !enabled && (
          <div className="share-consent-card">
            <div>
              <strong>
                {discordElsewhere
                  ? `Discord invites are on for “${discordElsewhere}”`
                  : 'Discord invites are off for this document'}
              </strong>
              <p>
                {discordElsewhere
                  ? 'Only one document can use Discord invites at a time. Moving them here stops new invites to the other one.'
                  : 'Turn them on to invite friends. Friends you invite receive this document’s link.'}
              </p>
            </div>
            <Button size="sm" variant="primary" disabled={busy} onClick={onEnable}>
              {discordElsewhere ? 'Move here' : 'Turn on'}
            </Button>
          </div>
        )
      )}
      {discord.social.warning && <Banner tone="warning">{discord.social.warning}</Banner>}
      {person && (
        <DiscordFriendPicker
          friends={discord.social.friends}
          selection={enabled && state.kind === 'ready' ? selection : null}
          ready={discord.social.inviteReady}
          disabled={busy}
          onInvite={discord.social.send}
          onRefresh={discord.social.refreshFriends}
        />
      )}
      <p className="field-hint">
        “Sent” means Discord accepted the invite, not that your friend joined.{' '}
        {joinMode === 'approval'
          ? 'You approve each person before they join.'
          : 'Anyone with the link joins right away.'}{' '}
        <button type="button" className="text-link" onClick={onBack}>
          Change privacy
        </button>
      </p>
    </div>
  );
}
