import { useId } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@veil/ui';
import type { DiscordConnectionView } from '../discord-social';
import { DiscordAvatar } from './DiscordAvatar';

/** Only the actual native adapter may supply connected/authorizing states. */
export function DiscordConnectionCard({ connection }: { connection: DiscordConnectionView }) {
  const availabilityId = useId();
  const person =
    connection.status === 'connected' || connection.status === 'reconnecting'
      ? connection.person
      : null;
  const message =
    connection.status === 'loading'
      ? 'Checking connection availability…'
      : connection.status === 'unavailable'
        ? connection.reason
        : connection.status === 'error'
          ? connection.message
          : connection.status === 'disconnecting'
            ? 'Disconnecting and removing saved authorization…'
            : connection.status === 'connecting'
              ? 'Connecting to Discord…'
              : connection.status === 'authorizing'
                ? 'Waiting for you to approve the connection in Discord or your browser…'
                : connection.status === 'reconnecting'
                  ? 'Reconnecting to Discord… Your document stays open.'
                  : connection.status === 'expired'
                    ? 'Discord authorization expired or was revoked. Connect again to use direct invites.'
                    : connection.status === 'connected'
                      ? 'Connected on this device. Each document needs its own permission for invites.'
                      : 'Connect to invite your Discord friends. No Veil account needed.';
  return (
    <div className="settings-card discord-connection-card">
      <div className="discord-card-heading">
        {person ? (
          <DiscordAvatar person={person} />
        ) : (
          <span className="discord-card-icon" aria-hidden="true">
            <Link2 size={20} />
          </span>
        )}
        <div className="discord-card-copy">
          <h4>{person ? person.displayName || person.username : 'Discord connection'}</h4>
          <p>{person ? `@${person.username}` : 'Connecting never starts sharing a document.'}</p>
        </div>
      </div>
      <div className="discord-card-footer">
        <p id={availabilityId} role={connection.status === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
        {connection.status === 'authorizing' || connection.status === 'connecting' ? (
          <Button onClick={connection.cancel}>Cancel connection</Button>
        ) : connection.status === 'connected' || connection.status === 'reconnecting' ? (
          <Button onClick={connection.disconnect}>Disconnect</Button>
        ) : connection.status === 'expired' ? (
          <>
            <Button onClick={connection.reconnect}>Reconnect Discord</Button>
            <Button variant="ghost" onClick={connection.disconnect}>
              Disconnect
            </Button>
          </>
        ) : connection.status === 'disconnecting' ? (
          <Button disabled>Disconnecting…</Button>
        ) : connection.status === 'error' ? (
          <Button onClick={connection.retry}>Try again</Button>
        ) : (
          <Button
            disabled={connection.status !== 'disconnected'}
            aria-describedby={availabilityId}
            onClick={connection.status === 'disconnected' ? connection.connect : undefined}
          >
            Connect Discord
          </Button>
        )}
      </div>
      <p className="field-hint">Rich Presence below works separately from an account connection.</p>
    </div>
  );
}
