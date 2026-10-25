import { useId } from 'react';
import { Button } from '@veil/ui';
import type { DiscordConnectionView } from '../discord-social';
import { DiscordAvatar } from './DiscordAvatar';
import { DiscordLogo } from './DiscordLogo';
import { discordAccountMessage } from './discord-share-state';

/** Only the actual native adapter may supply connected/authorizing states. */
export function DiscordConnectionCard({ connection }: { connection: DiscordConnectionView }) {
  const statusId = useId();
  const person =
    connection.status === 'connected' || connection.status === 'reconnecting'
      ? connection.person
      : null;
  const message =
    connection.status === 'loading'
      ? 'Checking connection availability…'
      : connection.status === 'unavailable'
        ? connection.reason
        : connection.status === 'connected' && person
          ? `@${person.username}`
          : discordAccountMessage(connection);
  return (
    <div className="settings-card">
      <div className="setting-row discord-account-row">
        {person ? (
          <DiscordAvatar person={person} />
        ) : (
          <span className="discord-card-icon" aria-hidden="true">
            <DiscordLogo size={20} />
          </span>
        )}
        <div className="setting-row-text">
          <span className="setting-row-label">
            {person ? person.displayName || person.username : 'Not connected'}
          </span>
          <p id={statusId} role={connection.status === 'error' ? 'alert' : 'status'}>
            {message}
          </p>
        </div>
        <div className="discord-account-actions">
          {connection.status === 'authorizing' || connection.status === 'connecting' ? (
            <Button onClick={connection.cancel}>Cancel</Button>
          ) : connection.status === 'connected' || connection.status === 'reconnecting' ? (
            <Button variant="ghost" onClick={connection.disconnect}>
              Disconnect
            </Button>
          ) : connection.status === 'expired' ? (
            <>
              <Button variant="ghost" onClick={connection.disconnect}>
                Disconnect
              </Button>
              <Button variant="primary" onClick={connection.reconnect}>
                Reconnect
              </Button>
            </>
          ) : connection.status === 'disconnecting' ? (
            <Button disabled>Disconnecting…</Button>
          ) : connection.status === 'error' ? (
            <Button onClick={connection.retry}>Try again</Button>
          ) : (
            <Button
              variant="primary"
              disabled={connection.status !== 'disconnected'}
              aria-describedby={statusId}
              onClick={connection.status === 'disconnected' ? connection.connect : undefined}
            >
              Connect Discord
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
