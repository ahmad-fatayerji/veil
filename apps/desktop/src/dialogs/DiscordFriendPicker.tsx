import { useId, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Banner, Button, Field, Input } from '@veil/ui';
import {
  discordInviteError,
  type DiscordInviteResult,
  type DiscordPerson,
} from '../discord-social';
import type { DiscordInvitationSelection } from '../discord-invitations';
import { DiscordAvatar } from './DiscordAvatar';

interface Props {
  friends: readonly DiscordPerson[];
  loading: boolean;
  error: string;
  disabled: boolean;
  selection: Readonly<DiscordInvitationSelection>;
  /** The native adapter must recheck the selected generation before sending. */
  onInvite: (
    personId: string,
    selection: Readonly<DiscordInvitationSelection>,
  ) => Promise<DiscordInviteResult>;
  onRefresh: () => void;
}

type SendState = { status: 'sending' | 'sent' } | { status: 'error'; message: string };

function FriendPicker({
  friends,
  loading,
  error,
  disabled,
  selection,
  onInvite,
  onRefresh,
}: Props) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [states, setStates] = useState<Record<string, SendState>>({});
  const inFlight = useRef(new Set<string>());
  const normalized = query.trim().normalize('NFKC').toLowerCase();
  const shown = friends.filter((friend) =>
    `${friend.displayName}\n${friend.username}`
      .normalize('NFKC')
      .toLowerCase()
      .includes(normalized),
  );

  async function send(personId: string) {
    if (disabled || loading || inFlight.current.has(personId)) return;
    inFlight.current.add(personId);
    setStates((current) => ({ ...current, [personId]: { status: 'sending' } }));
    try {
      const result = await onInvite(personId, selection);
      setStates((current) => ({
        ...current,
        [personId]: result.ok
          ? { status: 'sent' }
          : { status: 'error', message: discordInviteError(result) },
      }));
    } catch {
      setStates((current) => ({
        ...current,
        [personId]: {
          status: 'error',
          message: 'The invite could not be sent. Try again or copy the link instead.',
        },
      }));
    } finally {
      inFlight.current.delete(personId);
    }
  }

  return (
    <div className="discord-friend-picker" aria-busy={loading}>
      <Field label="Find a Discord friend" htmlFor={searchId}>
        <div className="discord-search">
          <Search size={16} aria-hidden="true" />
          <Input
            id={searchId}
            type="search"
            value={query}
            placeholder="Search name or username"
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </Field>
      {error && (
        <Banner
          tone="danger"
          role="alert"
          actions={
            <Button size="sm" onClick={onRefresh} disabled={loading}>
              Retry
            </Button>
          }
        >
          {error}
        </Banner>
      )}
      {loading ? (
        <p role="status" className="field-hint">
          Preparing Discord invitations…
        </p>
      ) : !error && !shown.length ? (
        <p role="status" className="field-hint">
          {friends.length
            ? 'No friends match your search.'
            : 'No Discord friends are available. You can still copy the invite link.'}
        </p>
      ) : (
        <ul className="discord-friends" aria-label="Discord friends">
          {shown.map((person) => {
            const state = states[person.id];
            const statusId = `${searchId}-${person.id}-status`;
            return (
              <li key={person.id} className="discord-friend-row">
                <DiscordAvatar person={person} />
                <div className="discord-card-copy">
                  <strong>{person.displayName || person.username}</strong>
                  <p>@{person.username}</p>
                  <p id={statusId} role={state?.status === 'error' ? 'alert' : 'status'}>
                    {state?.status === 'error'
                      ? state.message
                      : state?.status === 'sent'
                        ? 'Invite sent through Discord.'
                        : state?.status === 'sending'
                          ? 'Sending invite…'
                          : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  loading={state?.status === 'sending'}
                  disabled={disabled || loading}
                  aria-label={`${state?.status === 'error' ? 'Retry invite to' : state?.status === 'sent' ? 'Send another invite to' : 'Invite'} ${person.displayName || person.username}`}
                  aria-describedby={statusId}
                  icon={
                    state?.status === 'sent' ? <Check size={16} aria-hidden="true" /> : undefined
                  }
                  onClick={() => void send(person.id)}
                >
                  {state?.status === 'sent'
                    ? 'Send again'
                    : state?.status === 'error'
                      ? 'Retry'
                      : 'Invite'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Button size="sm" variant="ghost" disabled={loading || disabled} onClick={onRefresh}>
        Refresh friends
      </Button>
      <p className="field-hint">
        Sent means Discord accepted the invite. It does not confirm delivery or that your friend
        joined.
      </p>
    </div>
  );
}

/** No demo friends or fake native calls. Mount only with an actual connection;
 * remount on account change and use a new selection generation on link reset. */
export function DiscordFriendPicker(props: Props) {
  return (
    <FriendPicker key={`${props.selection.documentId}:${props.selection.generation}`} {...props} />
  );
}
