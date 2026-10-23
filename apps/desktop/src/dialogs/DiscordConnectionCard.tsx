import { useId } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@veil/ui';
import type { useDiscordPresence } from '../discord';

/** The current native publisher reports these capabilities as unavailable.
 * There is intentionally no fabricated OAuth handler or connected profile. */
export function DiscordConnectionCard({
  discord,
}: {
  discord: ReturnType<typeof useDiscordPresence>;
}) {
  const availabilityId = useId();
  const capabilities = discord.capabilities;
  return (
    <div className="settings-card discord-connection-card">
      <div className="discord-card-heading">
        <span className="discord-card-icon" aria-hidden="true">
          <Link2 size={20} />
        </span>
        <div className="discord-card-copy">
          <h4>Discord connection</h4>
          <p>No Veil account needed. Connecting will never start sharing a document.</p>
        </div>
      </div>
      <div className="discord-card-footer">
        <p id={availabilityId} role="status">
          {capabilities
            ? capabilities.unavailableReason
            : discord.error
              ? 'Connection availability could not be checked. Your existing invite links still work.'
              : 'Checking connection availability…'}
        </p>
        <Button disabled aria-describedby={availabilityId}>
          Connect Discord
        </Button>
      </div>
      <p className="field-hint">Rich Presence below works separately from an account connection.</p>
    </div>
  );
}
