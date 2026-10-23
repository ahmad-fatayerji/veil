import { useRef, useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import { Banner, Button, Switch } from '@veil/ui';
import type { DiscordCapabilities, useDiscordPresence } from '../discord';
import { discordJoinPayload, type DiscordInvitationSelection } from '../discord-invitations';
import { DiscordFriendPicker } from './DiscordFriendPicker';

export function DiscordShareSection({
  id,
  link,
  capabilities,
  discord,
  selection,
  documentId,
  onConsent,
  onSettings,
  busy,
  onCopy,
}: {
  id: string;
  link: string;
  capabilities: DiscordCapabilities | null;
  discord: ReturnType<typeof useDiscordPresence>;
  selection: Readonly<DiscordInvitationSelection> | null;
  documentId: string;
  onConsent: (enabled: boolean) => void;
  onSettings: () => void;
  busy: boolean;
  onCopy: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const inFlight = useRef(false);
  const payload = discordJoinPayload(link);
  const connected = discord.social.status === 'connected';
  const selected = selection?.documentId === documentId;
  const ready =
    connected &&
    !!discord.preferences?.enabled &&
    discord.preferences.showParticipantCount &&
    payload.ok;
  const reason = !discord.social.available
    ? capabilities
      ? 'Direct invites are not available in this build. You can still copy the link.'
      : 'Checking direct invite availability…'
    : !connected
      ? 'Connect Discord to choose friends and send direct invitations.'
      : !discord.preferences?.enabled
        ? 'Turn on Discord Rich Presence in Settings before enabling direct invites.'
        : !discord.preferences.showParticipantCount
          ? 'Discord invites require the participant count in your activity. Enable it in Settings if you want to use direct invites.'
          : !payload.ok
            ? payload.message
            : selection && !selected
              ? 'Another document is on Discord. Turning this on switches joinable activity to this document.'
              : 'Friends can see joinable activity for this document. The join setting above still applies.';
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
        Choose friends to invite, or copy the link into a Discord conversation. People who join can
        read and edit.
      </p>
      <div className="discord-invite-option">
        <div className="discord-card-copy">
          <label htmlFor={`${id}-enabled`}>Allow direct Discord invites for this document</label>
          <p id={`${id}-availability`}>{reason}</p>
        </div>
        <Switch
          id={`${id}-enabled`}
          checked={selected}
          disabled={!ready || busy}
          aria-describedby={`${id}-availability`}
          onChange={(event) => onConsent(event.target.checked)}
        />
      </div>
      {discord.social.available && !ready && (
        <Button size="sm" variant="ghost" onClick={onSettings}>
          Discord settings
        </Button>
      )}
      {discord.social.warning && <Banner tone="warning">{discord.social.warning}</Banner>}
      {selected && selection && ready && (
        <DiscordFriendPicker
          friends={discord.social.friends}
          loading={!discord.social.inviteReady}
          error=""
          disabled={busy}
          selection={selection}
          onInvite={discord.social.send}
          onRefresh={discord.social.refreshFriends}
        />
      )}
      <div className="discord-card-footer">
        <p className="field-hint">
          Turning off Discord invites stops new sends and joinable activity. Delivered links keep
          working until you reset the link, stop sharing, or end the session.
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
