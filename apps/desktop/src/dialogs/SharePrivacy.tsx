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

type DiscordJoin = 'invite' | 'public';

export function DiscordJoinControl({
  publicJoin,
  disabled,
  onChange,
  hint,
}: {
  publicJoin: boolean;
  disabled: boolean;
  onChange: (publicJoin: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="field">
      <span className="field-label">Joining from Discord</span>
      <SegmentedControl<DiscordJoin>
        label="Joining from Discord"
        value={publicJoin ? 'public' : 'invite'}
        disabled={disabled}
        onChange={(choice) => onChange(choice === 'public')}
        options={[
          { value: 'public', label: 'Friends can join' },
          { value: 'invite', label: 'Invite only' },
        ]}
      />
      <p className="field-hint">
        {publicJoin
          ? 'Discord friends join straight away from Join a session or your Discord profile. Who can join above still applies.'
          : 'Friends you invite join straight away. Others can ask, and you let each one in.'}
        {hint && ` ${hint}`}
      </p>
    </div>
  );
}

export function SharePrivacy({
  joinMode,
  onJoinModeChange,
  busy,
  discord,
  publicJoin,
  discordElsewhere,
  onPublicJoinChange,
}: {
  joinMode: JoinMode;
  onJoinModeChange: (mode: JoinMode) => void;
  busy: boolean;
  discord: DiscordShareState;
  /** Whether Discord friends may join this document from the host's profile. */
  publicJoin: boolean;
  /** Title of another document Discord currently points to, if any. */
  discordElsewhere: string | null;
  onPublicJoinChange: (publicJoin: boolean) => void;
}) {
  return (
    <section className="share-section" aria-labelledby="share-privacy-heading">
      <h3 id="share-privacy-heading" className="share-section-title">
        Privacy
      </h3>
      <JoinModeControl value={joinMode} disabled={busy} onChange={onJoinModeChange} started />
      {discord.kind === 'ready' && (
        <DiscordJoinControl
          publicJoin={publicJoin}
          disabled={busy}
          onChange={onPublicJoinChange}
          hint={
            discordElsewhere
              ? `Your Discord status points to “${discordElsewhere}”; changing this moves it here.`
              : undefined
          }
        />
      )}
    </section>
  );
}
