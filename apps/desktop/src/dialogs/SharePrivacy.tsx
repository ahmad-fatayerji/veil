import type { JoinMode } from '@veil/collaboration';
import { SegmentedControl } from '@veil/ui';
import type { DiscordShareState } from './discord-share-state';

export function JoinModeControl({
  value,
  disabled,
  onChange,
  started,
}: {
  value: JoinMode;
  disabled: boolean;
  onChange: (mode: JoinMode) => void;
  /** Once a link exists, changing the mode keeps it and everyone already connected. */
  started: boolean;
}) {
  return (
    <div className="field">
      <span className="field-label">Who can join</span>
      <SegmentedControl
        label="Who can join"
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={[
          { value: 'auto', label: 'Anyone with the link' },
          { value: 'approval', label: 'Only people I approve' },
        ]}
      />
      <p className="field-hint">
        {value === 'auto'
          ? 'People with the link join and edit right away.'
          : 'You’ll see a request above the document for each person.'}
        {started && ' Changing this keeps the link and current guests.'}
      </p>
    </div>
  );
}

type DiscordChoice = 'off' | 'invited';

export function SharePrivacy({
  joinMode,
  onJoinModeChange,
  busy,
  discord,
  discordEnabled,
  discordElsewhere,
  onDiscordChange,
}: {
  joinMode: JoinMode;
  onJoinModeChange: (mode: JoinMode) => void;
  busy: boolean;
  discord: DiscordShareState;
  discordEnabled: boolean;
  /** Title of another document that currently holds Discord invites, if any. */
  discordElsewhere: string | null;
  onDiscordChange: (enabled: boolean) => void;
}) {
  const discordHint = discordEnabled
    ? 'Friends you invite receive this link. Your Discord status shows you’re in a Veil document.'
    : discord.kind === 'account'
      ? 'Connect Discord above to invite friends.'
      : discord.kind === 'needs-activity'
        ? 'Needs Discord activity sharing. Open Invite Discord friends to turn it on.'
        : discord.kind === 'link'
          ? discord.message
          : discordElsewhere
            ? `Discord invites are on for “${discordElsewhere}”. Turning them on here moves them to this document.`
            : 'Nobody can join this document through Discord.';
  return (
    <section className="share-section" aria-labelledby="share-privacy-heading">
      <h3 id="share-privacy-heading" className="share-section-title">
        Privacy
      </h3>
      <JoinModeControl value={joinMode} disabled={busy} onChange={onJoinModeChange} started />
      {discord.kind !== 'hidden' && (
        <div className="field">
          <span className="field-label">Discord invites</span>
          <SegmentedControl<DiscordChoice>
            label="Discord invites"
            value={discordEnabled ? 'invited' : 'off'}
            disabled={busy || (!discordEnabled && discord.kind !== 'ready')}
            onChange={(choice) => onDiscordChange(choice === 'invited')}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'invited', label: 'Friends I invite' },
            ]}
          />
          <p className="field-hint">{discordHint}</p>
        </div>
      )}
    </section>
  );
}
