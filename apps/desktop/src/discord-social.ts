/** Safe view models only. OAuth codes and tokens have no frontend representation. */
export interface DiscordPerson {
  id: string;
  displayName: string;
  username: string;
  /** Bounded raster data supplied by native code; never an arbitrary remote URL. */
  avatarDataUrl?: string;
  avatarRevision?: string;
  /** Empty when Discord does not report presence for this person. */
  status?: 'online' | 'idle' | 'dnd' | 'offline' | '';
  /** The Veil session this friend is in, when Discord reports a joinable party. */
  activity?: { details: string; state: string; size: number };
}

export interface DiscordInvitation {
  id: string;
  person: DiscordPerson;
  /** This user asked the sender to join, so it may open without another prompt. */
  requested: boolean;
}

const presenceRank = { online: 0, idle: 1, dnd: 2, offline: 3, '': 3 } as const;

/** People invited this connection first, then online, idle, busy and offline
 * friends, each alphabetical. */
export function orderDiscordFriends(
  friends: readonly DiscordPerson[],
  invited: ReadonlySet<string>,
): DiscordPerson[] {
  const name = (person: DiscordPerson) => person.displayName || person.username;
  return [...friends].sort(
    (a, b) =>
      Number(invited.has(b.id)) - Number(invited.has(a.id)) ||
      presenceRank[a.status ?? ''] - presenceRank[b.status ?? ''] ||
      name(a).localeCompare(name(b), undefined, { sensitivity: 'base' }),
  );
}

/** Case-, width- and accent-insensitive match on display name or username. */
export function matchesDiscordFriend(person: DiscordPerson, query: string) {
  const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const wanted = fold(query.trim());
  return !wanted || fold(`${person.displayName}\n${person.username}`).includes(wanted);
}

export type DiscordConnectionView =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'disconnected'; connect: () => void }
  | { status: 'authorizing'; cancel: () => void }
  | { status: 'connecting'; cancel: () => void }
  | { status: 'disconnecting' }
  | { status: 'connected' | 'reconnecting'; person: DiscordPerson; disconnect: () => void }
  | { status: 'expired'; reconnect: () => void; disconnect: () => void };

export type DiscordInviteResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'connection' | 'not-friend' | 'rate-limit' | 'stale-document' | 'unavailable';
    };

export function discordInviteError(result: Extract<DiscordInviteResult, { ok: false }>) {
  return {
    connection: 'Discord is disconnected. Reconnect before sending another invite.',
    'not-friend': 'This person can no longer receive an invite. Refresh your friends list.',
    'rate-limit': 'Discord is limiting invitations right now. Wait a little before trying again.',
    'stale-document': 'This document’s invite changed. Reopen Share before sending an invite.',
    unavailable: 'Discord could not accept the invite. Try again or copy the link instead.',
  }[result.reason];
}
