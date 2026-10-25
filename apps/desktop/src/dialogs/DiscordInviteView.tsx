import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
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
  busy,
  onUse,
  onBack,
}: {
  state: DiscordShareState;
  discord: ReturnType<typeof useDiscordPresence>;
  selection: Readonly<DiscordInvitationSelection> | null;
  documentId: string;
  busy: boolean;
  /** Points Discord at this document; returns the title it moved from, if any. */
  onUse: () => string | null;
  onBack: () => void;
}) {
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    view.current?.querySelector<HTMLElement>('input[type="search"]')?.focus();
  }, []);
  const connection = discord.connection;
  const person = connection.status === 'connected' ? connection.person : null;
  const enabled = selection?.documentId === documentId;
  const [movedFrom, setMovedFrom] = useState<string | null>(null);
  // Opening the friend list is the intent to invite: no separate switch.
  const ready = state.kind === 'ready';
  const use = useRef(onUse);
  useEffect(() => {
    use.current = onUse;
  });
  useEffect(() => {
    if (!ready) return;
    const moved = use.current();
    if (moved) setMovedFrom(moved);
  }, [ready]);
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
        movedFrom && (
          <p className="discord-moved-note" role="status">
            Your Discord status now points to this document. Earlier invites to “{movedFrom}” may
            stop working.
          </p>
        )
      )}
      {discord.social.warning && <Banner tone="warning">{discord.social.warning}</Banner>}
      {person && (
        <DiscordFriendPicker
          friends={discord.social.friends}
          invited={discord.social.invited}
          selection={enabled && state.kind === 'ready' ? selection : null}
          ready={discord.social.inviteReady}
          disabled={busy}
          onInvite={discord.social.send}
          onRefresh={discord.social.refreshFriends}
        />
      )}
      <p className="field-hint">
        {selection?.publicJoin && enabled
          ? 'Friends can also join from Join a session or your Discord profile. '
          : 'Only friends you invite join without asking. '}
        <button type="button" className="text-link" onClick={onBack}>
          Change privacy
        </button>
      </p>
    </div>
  );
}
