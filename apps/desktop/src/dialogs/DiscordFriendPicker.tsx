import { useEffect, useId, useRef, useState } from 'react';
import { Check, RefreshCw, Search } from 'lucide-react';
import { Button, IconButton, Input } from '@veil/ui';
import {
  discordInviteError,
  type DiscordInviteResult,
  type DiscordPerson,
} from '../discord-social';
import type { DiscordInvitationSelection } from '../discord-invitations';
import { DiscordAvatar } from './DiscordAvatar';

/** How long an invite waits for Discord to acknowledge this document's activity. */
export const INVITE_READY_TIMEOUT = 10_000;

interface Props {
  friends: readonly DiscordPerson[];
  /** Null while this document does not allow Discord invites: friends show, Invite is off. */
  selection: Readonly<DiscordInvitationSelection> | null;
  /** Discord acknowledged the joinable activity; earlier clicks wait for it. */
  ready: boolean;
  disabled: boolean;
  /** The native adapter must recheck the selected generation before sending. */
  onInvite: (
    personId: string,
    selection: Readonly<DiscordInvitationSelection>,
  ) => Promise<DiscordInviteResult>;
  onRefresh: () => void;
}

type SendState = { status: 'sending' | 'sent' } | { status: 'error'; message: string };

function FriendPicker({ friends, selection, ready, disabled, onInvite, onRefresh }: Props) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [states, setStates] = useState<Record<string, SendState>>({});
  const inFlight = useRef(new Set<string>());
  const readyRef = useRef(ready);
  const waiters = useRef(new Set<() => void>());
  useEffect(() => {
    readyRef.current = ready;
    if (!ready) return;
    waiters.current.forEach((resolve) => resolve());
    waiters.current.clear();
  }, [ready]);
  const normalized = query.trim().normalize('NFKC').toLowerCase();
  const shown = friends.filter((friend) =>
    `${friend.displayName}\n${friend.username}`
      .normalize('NFKC')
      .toLowerCase()
      .includes(normalized),
  );

  function whenReady() {
    if (readyRef.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        waiters.current.delete(done);
        resolve(false);
      }, INVITE_READY_TIMEOUT);
      waiters.current.add(done);
    });
  }

  async function send(personId: string) {
    if (!selection || disabled || inFlight.current.has(personId)) return;
    inFlight.current.add(personId);
    setStates((current) => ({ ...current, [personId]: { status: 'sending' } }));
    try {
      const result: DiscordInviteResult | null = (await whenReady())
        ? await onInvite(personId, selection)
        : null;
      setStates((current) => ({
        ...current,
        [personId]: !result
          ? { status: 'error', message: 'Discord is still getting ready. Try again in a moment.' }
          : result.ok
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
    <div className="discord-friend-picker">
      <div className="discord-search-row">
        <div className="discord-search">
          <Search size={16} aria-hidden="true" />
          <Input
            id={searchId}
            type="search"
            value={query}
            placeholder="Search friends"
            aria-label="Search Discord friends"
            autoComplete="off"
            data-autofocus
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <IconButton label="Refresh friends" disabled={disabled} onClick={onRefresh}>
          <RefreshCw size={16} aria-hidden="true" />
        </IconButton>
      </div>
      {!shown.length ? (
        <p role="status" className="discord-friends-empty">
          {friends.length
            ? 'No friends match your search.'
            : 'No Discord friends to show yet. Refresh, or copy the link instead.'}
        </p>
      ) : (
        <ul className="discord-friends" aria-label="Discord friends">
          {shown.map((person) => {
            const state = states[person.id];
            const name = person.displayName || person.username;
            const statusId = `${searchId}-${person.id}-status`;
            return (
              <li key={person.id} className="discord-friend-row" data-state={state?.status}>
                <DiscordAvatar person={person} />
                <div className="discord-card-copy">
                  <strong>{name}</strong>
                  <p
                    id={statusId}
                    className={state?.status === 'error' ? 'discord-friend-error' : undefined}
                    role={state?.status === 'error' ? 'alert' : 'status'}
                  >
                    {state?.status === 'error' ? (
                      state.message
                    ) : state?.status === 'sent' ? (
                      <span className="discord-friend-sent">
                        <Check size={14} aria-hidden="true" />
                        Invite sent
                      </span>
                    ) : state?.status === 'sending' ? (
                      'Sending…'
                    ) : (
                      `@${person.username}`
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={state?.status === 'sent' ? 'ghost' : 'secondary'}
                  loading={state?.status === 'sending'}
                  disabled={disabled || !selection}
                  aria-label={`${state?.status === 'error' ? 'Retry invite to' : state?.status === 'sent' ? 'Invite again:' : 'Invite'} ${name}`}
                  aria-describedby={statusId}
                  onClick={() => void send(person.id)}
                >
                  {state?.status === 'sent'
                    ? 'Invite again'
                    : state?.status === 'error'
                      ? 'Retry'
                      : 'Invite'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** No demo friends or fake native calls. Mount only with an actual connection;
 * remount on account change and use a new selection generation on link reset. */
export function DiscordFriendPicker(props: Props) {
  return (
    <FriendPicker
      key={props.selection ? `${props.selection.documentId}:${props.selection.generation}` : 'off'}
      {...props}
    />
  );
}
