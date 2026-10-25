import { useEffect, useRef, useState } from 'react';
import { Button } from '@veil/ui';
import type { useDiscordPresence } from '../discord';
import {
  discordInviteError,
  orderDiscordFriends,
  type DiscordInvitation,
  type DiscordPerson,
} from '../discord-social';
import { errorMessage } from '../overlay/api';
import { DiscordAvatar } from '../dialogs/DiscordAvatar';
import { DiscordStatusIcon } from '../dialogs/DiscordStatusIcon';
import { DiscordAccountAction } from '../dialogs/DiscordInviteRow';
import { DiscordLogo } from '../dialogs/DiscordLogo';
import { discordAccountMessage } from '../dialogs/discord-share-state';

/** How long a join request waits for the host before suggesting another try. */
const ANSWER_TIMEOUT = 180_000;
const noInvites: ReadonlySet<string> = new Set();

type Asking = { status: 'asking' | 'waiting' | 'opening' } | { status: 'error'; message: string };

const personName = (person: DiscordPerson) => person.displayName || person.username;

/** "Document: Notes" → "Notes"; a hidden title reads as a document. */
function sessionLabel(person: DiscordPerson) {
  const details = person.activity?.details ?? '';
  const title = details.startsWith('Document: ') ? details.slice('Document: '.length) : '';
  const size = person.activity?.size ?? 0;
  return `${title ? `“${title}”` : 'A document'}${size > 1 ? ` · ${size} people` : ''}`;
}

function Avatar({ person }: { person: DiscordPerson }) {
  return (
    <span className="discord-presence">
      <DiscordAvatar person={person} />
      {person.status && (
        <span className="discord-presence-dot" data-status={person.status}>
          <DiscordStatusIcon status={person.status} />
        </span>
      )}
    </span>
  );
}

/** Discord's part of Join a session: invites you received and friends' Veil
 * sessions. Every path ends in the normal join flow with the host's own link. */
export function JoinSessions({
  discord,
  busy,
  onJoinLink,
}: {
  discord: ReturnType<typeof useDiscordPresence>;
  busy: boolean;
  /** Joins with a link Discord handed over; the inviter is shown on the form. */
  onJoinLink: (link: string, invitedBy: string) => void;
}) {
  const social = discord.social;
  const connection = discord.connection;
  const [asking, setAsking] = useState<Record<string, Asking>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const join = useRef(onJoinLink);
  useEffect(() => {
    join.current = onJoinLink;
  });
  const release = useRef(social.stopAwaiting);
  useEffect(() => {
    release.current = social.stopAwaiting;
  });
  useEffect(() => {
    const pending = timers.current;
    // Answers that arrive after this view closes fall back to the normal invite notice.
    return () =>
      pending.forEach((timer, person) => {
        clearTimeout(timer);
        release.current(person);
      });
  }, []);

  function review(invitation: DiscordInvitation) {
    return social.review(invitation.id).then((link) => {
      join.current(link, personName(invitation.person));
    });
  }

  // A host answering our request sends an ordinary invite; open it at once.
  const answered = social.invitations.find(
    (item) => item.requested && social.awaiting.has(item.person.id),
  );
  const handled = useRef(new Set<string>());
  useEffect(() => {
    if (!answered || handled.current.has(answered.id)) return;
    handled.current.add(answered.id);
    const id = answered.person.id;
    release.current(id);
    clearTimeout(timers.current.get(id));
    void review(answered)
      .then(() => setAsking((current) => ({ ...current, [id]: { status: 'opening' } })))
      .catch((cause: unknown) =>
        setAsking((current) => ({
          ...current,
          [id]: { status: 'error', message: errorMessage(cause) },
        })),
      );
    // Each answer is handled once; review() reads only refs and stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered?.id]);

  if (!social.available || connection.status === 'unavailable' || connection.status === 'loading')
    return null;

  if (connection.status !== 'connected')
    return (
      <section className="join-sessions" aria-label="Discord">
        <div className="discord-invite-row">
          <span className="discord-card-icon" aria-hidden="true">
            <DiscordLogo size={20} />
          </span>
          <div className="discord-card-copy">
            <strong>See invites and friends in Veil</strong>
            <p role={connection.status === 'error' ? 'alert' : 'status'}>
              {connection.status === 'disconnected'
                ? 'Connect Discord to join friends without pasting a link.'
                : discordAccountMessage(connection)}
            </p>
          </div>
          <DiscordAccountAction connection={connection} />
        </div>
      </section>
    );

  const invites = social.invitations.filter((item) => !social.awaiting.has(item.person.id));
  const inviters = new Set(invites.map((item) => item.person.id));
  const sessions = orderDiscordFriends(
    social.friends.filter((friend) => friend.activity && !inviters.has(friend.id)),
    noInvites,
  );

  async function ask(person: DiscordPerson) {
    setAsking((current) => ({ ...current, [person.id]: { status: 'asking' } }));
    const result = await social.requestJoin(person.id);
    if (!result.ok) {
      setAsking((current) => ({
        ...current,
        [person.id]: { status: 'error', message: discordInviteError(result) },
      }));
      return;
    }
    setAsking((current) => ({ ...current, [person.id]: { status: 'waiting' } }));
    timers.current.set(
      person.id,
      setTimeout(() => {
        social.stopAwaiting(person.id);
        setAsking((current) =>
          current[person.id]?.status === 'waiting'
            ? {
                ...current,
                [person.id]: {
                  status: 'error',
                  message: `No answer from ${personName(person)} yet. Try again later.`,
                },
              }
            : current,
        );
      }, ANSWER_TIMEOUT),
    );
  }

  return (
    <section className="join-sessions" aria-label="Discord">
      {invites.length > 0 && (
        <div className="join-sessions-group">
          <h3 className="share-section-title">Invites for you</h3>
          <ul className="discord-friends">
            {invites.map((invitation) => {
              const known = invitation.person.id !== '0';
              return (
                <li key={invitation.id} className="discord-friend-row">
                  {known ? (
                    <Avatar person={invitation.person} />
                  ) : (
                    <span className="discord-card-icon" aria-hidden="true">
                      <DiscordLogo size={20} />
                    </span>
                  )}
                  <div className="discord-card-copy">
                    <strong>
                      {known ? `${personName(invitation.person)} invited you` : 'Discord invite'}
                    </strong>
                    <p>To a Veil document</p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={opening === invitation.id}
                    disabled={busy || (!!opening && opening !== invitation.id)}
                    onClick={() => {
                      setOpening(invitation.id);
                      setError('');
                      void review(invitation)
                        .catch((cause: unknown) => setError(errorMessage(cause)))
                        .finally(() => setOpening(null));
                    }}
                  >
                    Join
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="join-sessions-group">
        <h3 className="share-section-title">Friends in Veil</h3>
        {sessions.length === 0 ? (
          <p className="join-sessions-empty">No friends are sharing a Veil document right now.</p>
        ) : (
          <ul className="discord-friends">
            {sessions.map((person) => {
              const state = asking[person.id];
              const statusId = `join-session-${person.id}`;
              return (
                <li key={person.id} className="discord-friend-row">
                  <Avatar person={person} />
                  <div className="discord-card-copy">
                    <strong>{personName(person)}</strong>
                    <p
                      id={statusId}
                      className={state?.status === 'error' ? 'discord-friend-error' : undefined}
                      role={state?.status === 'error' ? 'alert' : 'status'}
                    >
                      {state?.status === 'error'
                        ? state.message
                        : state?.status === 'waiting'
                          ? `Waiting for ${personName(person)} to let you in…`
                          : state?.status === 'opening'
                            ? 'Opening…'
                            : sessionLabel(person)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={state?.status === 'waiting' ? 'ghost' : 'secondary'}
                    loading={state?.status === 'asking'}
                    disabled={busy || state?.status === 'opening'}
                    aria-describedby={statusId}
                    aria-label={`${state?.status === 'waiting' ? 'Ask again to join' : 'Join'} ${personName(person)}`}
                    onClick={() => void ask(person)}
                  >
                    {state?.status === 'waiting'
                      ? 'Ask again'
                      : state?.status === 'error'
                        ? 'Try again'
                        : 'Join'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error && (
        <p className="discord-friend-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
