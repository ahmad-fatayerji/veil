import { useRef, useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import { Button, Switch } from '@veil/ui';
import type { DiscordCapabilities } from '../discord';
import { discordJoinPayload } from '../discord-invitations';

export function DiscordShareSection({
  id,
  link,
  capabilities,
  busy,
  onCopy,
}: {
  id: string;
  link: string;
  capabilities: DiscordCapabilities | null;
  busy: boolean;
  onCopy: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const inFlight = useRef(false);
  const payload = discordJoinPayload(link);
  async function copy() {
    if (inFlight.current || busy || !link) return;
    inFlight.current = true;
    setCopying(true);
    setCopied(false);
    setCopyError('');
    try {
      await onCopy();
      setCopied(true);
    } catch {
      setCopyError(
        'The link could not be copied. Select the invite link above and copy it manually.',
      );
    } finally {
      setCopying(false);
      inFlight.current = false;
    }
  }
  return (
    <section className="discord-share-section" aria-labelledby={`${id}-heading`}>
      <div className="discord-share-heading">
        <Link2 size={18} aria-hidden="true" />
        <h3 id={`${id}-heading`}>Invite through Discord</h3>
      </div>
      <p className="field-hint">
        Copy this document’s link and send it in Discord. People who join can read and edit. The
        join setting above still applies.
      </p>
      <div className="discord-invite-option">
        <div className="discord-card-copy">
          <label htmlFor={`${id}-enabled`}>Allow direct Discord invites for this document</label>
          <p id={`${id}-availability`}>
            {capabilities
              ? 'Direct invites and the Discord friend picker are not available in this build.'
              : 'Checking direct invite availability…'}
          </p>
        </div>
        <Switch
          id={`${id}-enabled`}
          checked={false}
          disabled
          aria-describedby={`${id}-availability`}
        />
      </div>
      {!payload.ok && payload.reason === 'too-long' && (
        <p className="field-hint">{payload.message}</p>
      )}
      <div className="discord-card-footer">
        <p className="field-hint">
          A sent link keeps working until you reset the link, stop sharing, or end the session.
        </p>
        <Button
          icon={<Copy size={16} aria-hidden="true" />}
          loading={copying}
          disabled={busy || !link}
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy link for Discord'}
        </Button>
      </div>
      {copied && (
        <p className="discord-copy-status" role="status">
          Link copied. Paste it into your Discord conversation to send it.
        </p>
      )}
      {copyError && (
        <p className="field-error" role="alert">
          {copyError}
        </p>
      )}
    </section>
  );
}
