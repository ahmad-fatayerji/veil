/** Safe view models only. OAuth codes and tokens have no frontend representation. */
export interface DiscordPerson {
  id: string;
  displayName: string;
  username: string;
  /** Bounded raster data supplied by native code; never an arbitrary remote URL. */
  avatarDataUrl?: string;
  avatarRevision?: string;
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
