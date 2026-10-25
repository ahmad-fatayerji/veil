import { useEffect, useId, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Button, Input } from '@veil/ui';
import {
  discordInviteError,
  matchesDiscordFriend,
  orderDiscordFriends,
  type DiscordInviteResult,
  type DiscordPerson,
} from '../discord-social';
import type { DiscordInvitationSelection } from '../discord-invitations';
import { DiscordAvatar } from './DiscordAvatar';
import { DiscordStatusIcon } from './DiscordStatusIcon';

/** How long an invite waits for Discord to acknowledge this document's activity. */
export const INVITE_READY_TIMEOUT = 10_000;
/** Rows rendered at once; search reaches everyone else. */
const VISIBLE_FRIENDS = 100;
const presenceLabel = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' };

interface Props {
  friends: readonly DiscordPerson[];
  /** People invited earlier this connection, listed first. */
  invited: ReadonlySet<string>;
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

function FriendPicker({
  friends,
  invited,
  selection,
  ready,
  disabled,
  onInvite,
  onRefresh,
}: Props) {
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
  // The order is fixed when the list first appears, so presence changes and
  // new invites don't move rows under the pointer; new friends join the end.
  const [rank, setRank] = useState<ReadonlyMap<string, number> | null>(null);
  const ranked = orderDiscordFriends(friends, invited);
  if (!rank && ranked.length) setRank(new Map(ranked.map((person, index) => [person.id, index])));
  const ordered = rank
    ? [...ranked].sort(
        (a, b) =>
          (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      )
    : ranked;
  const shown = ordered.filter((person) => matchesDiscordFriend(person, query));
  const visible = shown.slice(0, VISIBLE_FRIENDS);

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
      </div>
      {!shown.length ? (
        <div role="status" className="discord-friends-empty">
          {friends.length ? (
            'No friends match your search.'
          ) : (
            <>
              <p>No Discord friends to show yet.</p>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={onRefresh}>
                Check again
              </Button>
            </>
          )}
        </div>
      ) : (
        <ul className="discord-friends" aria-label="Discord friends">
          {visible.map((person) => {
            const state = states[person.id];
            const name = person.displayName || person.username;
            const statusId = `${searchId}-${person.id}-status`;
            return (
              <li key={person.id} className="discord-friend-row" data-state={state?.status}>
                <span className="discord-presence">
                  <DiscordAvatar person={person} />
                  {person.status && (
                    <span
                      className="discord-presence-dot"
                      data-status={person.status}
                      title={presenceLabel[person.status]}
                    >
                      <DiscordStatusIcon status={person.status} />
                    </span>
                  )}
                </span>
                <div className="discord-card-copy">
                  <strong>
                    {name}
                    {person.status && (
                      <span className="visually-hidden">, {presenceLabel[person.status]}</span>
                    )}
                  </strong>
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
      {shown.length > visible.length && (
        <p className="discord-friends-more">
          Showing {visible.length} of {shown.length}. Search to find more.
        </p>
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
