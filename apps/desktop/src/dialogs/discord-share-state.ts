import type { DiscordPreferences } from '../discord';
import type { DiscordConnectionView } from '../discord-social';
import { discordJoinPayload } from '../discord-invitations';

export type DiscordShareState =
  /** No Social SDK in this build, or availability is not known yet: show nothing. */
  | { kind: 'hidden' }
  | { kind: 'account'; connection: DiscordConnectionView }
  | { kind: 'needs-activity' }
  | { kind: 'link'; message: string }
  | { kind: 'ready' };

/** One answer for the Share dialog's Discord row, privacy control and friend view,
 * so each explains the same next step instead of sending people to Settings. */
export function discordShareState({
  available,
  connection,
  preferences,
  link,
}: {
  available: boolean;
  connection: DiscordConnectionView;
  preferences: DiscordPreferences | null;
  link: string;
}): DiscordShareState {
  if (!available || connection.status === 'unavailable' || connection.status === 'loading')
    return { kind: 'hidden' };
  if (connection.status !== 'connected') return { kind: 'account', connection };
  if (!preferences?.enabled || !preferences.showParticipantCount) return { kind: 'needs-activity' };
  const payload = discordJoinPayload(link);
  if (!payload.ok) return { kind: 'link', message: payload.message };
  return { kind: 'ready' };
}

export function discordAccountMessage(connection: DiscordConnectionView) {
  switch (connection.status) {
    case 'authorizing':
      return 'Approve the connection in Discord or your browser…';
    case 'connecting':
      return 'Connecting to Discord…';
    case 'reconnecting':
      return 'Reconnecting to Discord…';
    case 'disconnecting':
      return 'Disconnecting…';
    case 'expired':
      return 'Discord signed you out. Reconnect to send invites.';
    case 'error':
      return connection.message;
    default:
      return 'Connect your Discord account to invite friends. No Veil account needed.';
  }
}
