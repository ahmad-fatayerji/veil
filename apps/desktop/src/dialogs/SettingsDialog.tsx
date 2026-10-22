import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  Globe,
  Info,
  Keyboard,
  Monitor,
  PictureInPicture2,
  Server,
  Share2,
} from 'lucide-react';
import {
  AppVersion,
  Banner,
  BrandMark,
  Button,
  DeveloperCredit,
  Dialog,
  Field,
  Input,
  SegmentedControl,
  Select,
  Switch,
  windowsColors,
  type Accent,
  type Appearance,
} from '@veil/ui';
import { SettingRow, SettingsGroup } from './SettingRow';
import { KeybindSettings } from './KeybindSettings';
import { OverlayControls } from '../overlay/Controls';
import { Updates } from '../Updates';
import type { useDiscordPresence } from '../discord';
import { useWindowsStartup } from '../startup';
import { SELF_HOSTING_URL } from '../capacity';

// Pages group settings by purpose; each page is split into titled groups.
export type Section = 'General' | 'Sharing' | 'Overlay' | 'Keybinds' | 'About & updates';
const sections: { id: Section; icon: typeof Monitor }[] = [
  { id: 'General', icon: Monitor },
  { id: 'Sharing', icon: Share2 },
  { id: 'Overlay', icon: PictureInPicture2 },
  { id: 'Keybinds', icon: Keyboard },
  { id: 'About & updates', icon: Info },
];
const updatesSection: Section = 'About & updates';

const veilBlue = '#0f62d6';
const columns = 9;

/**
 * Veil blue followed by the Windows color grid, so a color can match the Windows accent
 * exactly. Swatches have radio semantics; arrows move within the grid.
 */
function AccentPicker({ value, onChange }: { value: Accent; onChange: (value: Accent) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const options: Accent[] = ['veil', ...windowsColors];
  const selected = options.indexOf(value);
  return (
    <div
      ref={group}
      className="accent-picker"
      role="radiogroup"
      aria-label="Accent color"
      onKeyDown={(event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[
          event.key
        ];
        if (!step) return;
        event.preventDefault();
        const next = Math.min(options.length - 1, Math.max(0, Math.max(selected, 0) + step));
        onChange(options[next]);
        group.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}
    >
      {options.map((option, index) => {
        const label = option === 'veil' ? 'Veil blue (default)' : option.toUpperCase();
        return (
          <button
            key={option}
            type="button"
            role="radio"
            className="accent-swatch"
            style={{ background: option === 'veil' ? veilBlue : option }}
            aria-checked={option === value}
            aria-label={label}
            title={label}
            tabIndex={option === value || (selected < 0 && index === 0) ? 0 : -1}
            onClick={() => onChange(option)}
          />
        );
      })}
    </div>
  );
}
const publicLimits = [
  'Up to 5 guests per document',
  'A few shared documents at a time',
  'Limited relay for strict networks',
  'No uptime guarantee',
];

/** Which server sharing uses: our free public servers by default, or the user's own. */
function ServerChoice({
  official,
  busy,
  onUseAnother,
  onUseOfficial,
  onSelfHosting,
}: {
  official: boolean;
  busy: boolean;
  onUseAnother: () => void;
  onUseOfficial: () => void;
  onSelfHosting: () => void;
}) {
  const Icon = official ? Globe : Server;
  return (
    <div className="settings-card server-choice">
      <div className="setting-row">
        <div className="server-choice-title">
          <span className="server-choice-icon" aria-hidden="true">
            <Icon size={18} />
          </span>
          <div className="setting-row-text">
            <span className="setting-row-label">
              {official ? 'Our own public servers' : 'Another server'}
            </span>
            <p>
              {official
                ? 'Free and ready to use. No setup or credential needed.'
                : 'Your own server, or one an operator gives you access to. A credential gives you private, unshared capacity.'}
            </p>
          </div>
        </div>
        <Button size="sm" disabled={busy} onClick={official ? onUseAnother : onUseOfficial}>
          {official ? 'Use another server' : 'Use our own public servers'}
        </Button>
      </div>
      {official && (
        <div className="setting-row server-choice-details">
          <ul className="server-limits" aria-label="Public server limits">
            {publicLimits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
          <p className="setting-row-hint">
            For reliable or larger sessions, use your own server.{' '}
            <button type="button" className="text-link" onClick={onSelfHosting}>
              Self-hosting guide
              <ExternalLink size={12} aria-hidden="true" />
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

/** Our free public servers, or another server (which may be ours, used privately with a credential). */
export type HostingMode = 'public' | 'custom';
export type HostingForm = {
  server: string;
  credential: string;
  savedServer: string;
  mode: HostingMode;
  onUseAnother: () => void;
  onUseOfficial: () => void;
  status: string;
  testing: boolean;
  saving: boolean;
  resumeShare: boolean;
  onServerChange: (value: string) => void;
  onCredentialChange: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onForget: () => void;
};

export function SettingsDialog({
  open,
  section,
  onSectionChange,
  onClose,
  updating,
  busy,
  updateAttention,
  onUpdateBusy,
  name,
  onNameChange,
  discord,
  restoreTabs = false,
  onRestoreTabsChange,
  restoreTabsDisabled = false,
  closeBehavior,
  closeBehaviorDisabled,
  onCloseBehaviorChange,
  appearance,
  onAppearanceChange,
  accent,
  systemAccent,
  onAccentChange,
  hosting,
  notice,
  error,
  onOpenUrl,
}: {
  open: boolean;
  section: Section;
  onSectionChange: (section: Section) => void;
  onClose: () => void;
  updating: boolean;
  busy: boolean;
  updateAttention: boolean;
  onUpdateBusy: (busy: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  discord: ReturnType<typeof useDiscordPresence>;
  restoreTabs?: boolean;
  onRestoreTabsChange?: (enabled: boolean) => void;
  restoreTabsDisabled?: boolean;
  closeBehavior: string;
  closeBehaviorDisabled: boolean;
  onCloseBehaviorChange: (value: string) => void;
  appearance: Appearance;
  onAppearanceChange: (value: Appearance) => void;
  accent: Accent;
  /** The Windows accent ramp, when the system provides one. */
  systemAccent: string[] | null;
  onAccentChange: (value: Accent) => void;
  hosting: HostingForm;
  notice: string;
  error: string;
  onOpenUrl: (url: string) => void;
}) {
  const startup = useWindowsStartup(open);
  const [colorsOpen, setColorsOpen] = useState(false);
  // Every page starts at its top; pages share one scrolling area.
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [section]);
  return (
    <Dialog
      open={open}
      title="Settings"
      locked={updating}
      dismissOnBackdrop
      wide
      className="settings-dialog"
      onClose={onClose}
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-label={id}
              aria-description={
                id === updatesSection && updateAttention ? 'Update requires attention' : undefined
              }
              aria-current={section === id ? 'page' : undefined}
              data-autofocus={section === id ? '' : undefined}
              disabled={updating && id !== updatesSection}
              onClick={() => onSectionChange(id)}
            >
              <Icon size={16} aria-hidden="true" />
              {id}
              {id === updatesSection && updateAttention && (
                <span className="settings-nav-attention" aria-hidden="true" />
              )}
            </button>
          ))}
        </nav>
        <div ref={content} className="settings-content">
          <section hidden={section !== 'General'}>
            <h3>General</h3>
            <SettingsGroup title="Profile">
              <div className="settings-card">
                <SettingRow
                  label="Your name"
                  htmlFor="settings-name"
                  description="Shown to people in your documents."
                >
                  <Input
                    id="settings-name"
                    value={name}
                    maxLength={40}
                    placeholder="e.g. Alex"
                    autoComplete="nickname"
                    onChange={(event) => onNameChange(event.target.value)}
                  />
                </SettingRow>
              </div>
            </SettingsGroup>
            <SettingsGroup title="Appearance">
              <div className="settings-card">
                <SettingRow
                  label="Theme"
                  description="Applies to the control panel and the overlay."
                >
                  <SegmentedControl
                    label="Theme"
                    value={appearance}
                    onChange={onAppearanceChange}
                    options={[
                      { value: 'system', label: 'System' },
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                  />
                </SettingRow>
                {systemAccent && (
                  <SettingRow
                    label="Match Windows accent color"
                    htmlFor="accent-windows"
                    description="Follows your Windows accent, including later changes."
                  >
                    <span className="accent-system">
                      <span
                        className="accent-system-swatch"
                        style={{ background: systemAccent[3] }}
                        aria-hidden="true"
                      />
                      <Switch
                        id="accent-windows"
                        checked={accent === 'windows'}
                        onChange={(event) => {
                          // Turning matching off keeps the current Windows color as a choice
                          // and opens the colors to pick another.
                          onAccentChange(
                            event.target.checked ? 'windows' : (systemAccent[3] as Accent),
                          );
                          setColorsOpen(!event.target.checked);
                        }}
                      />
                    </span>
                  </SettingRow>
                )}
                {/* The color grid stays collapsed until asked for, and is hidden while
                    matching Windows. Without a system palette it is the only choice. */}
                {(accent !== 'windows' || !systemAccent) && (
                  <div className="setting-row accent-row">
                    <div className="accent-row-header">
                      <div className="setting-row-text">
                        <span className="setting-row-label">Accent color</span>
                        <p>Used for buttons, highlights and selections in both windows.</p>
                      </div>
                      <button
                        type="button"
                        className="accent-disclosure"
                        aria-expanded={colorsOpen}
                        aria-controls="accent-colors"
                        onClick={() => setColorsOpen(!colorsOpen)}
                      >
                        <span
                          className="accent-system-swatch"
                          style={{ background: accent.startsWith('#') ? accent : veilBlue }}
                          aria-hidden="true"
                        />
                        {colorsOpen ? 'Hide colors' : 'Choose color'}
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                    </div>
                    {colorsOpen && (
                      <div id="accent-colors">
                        <AccentPicker value={accent} onChange={onAccentChange} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SettingsGroup>
            {onRestoreTabsChange && (
              <SettingsGroup title="Documents">
                <div className="settings-card">
                  <SettingRow
                    label="Reopen tabs and unsaved drafts"
                    htmlFor="restore-tabs"
                    description="Reopen saved files and recover drafts after an unexpected exit. Draft contents are stored locally on this device. Quitting still asks you to save or discard changes."
                  >
                    <Switch
                      id="restore-tabs"
                      checked={restoreTabs}
                      disabled={restoreTabsDisabled || updating}
                      onChange={(event) => onRestoreTabsChange(event.target.checked)}
                    />
                  </SettingRow>
                </div>
              </SettingsGroup>
            )}
            <SettingsGroup title="Startup and closing">
              <div className="settings-card">
                {startup.status?.supported && (
                  <SettingRow
                    label="Start Veil with Windows"
                    htmlFor="windows-startup"
                    description="Launch quietly in the system tray when you sign in."
                  >
                    <Switch
                      id="windows-startup"
                      checked={startup.status.enabled}
                      disabled={startup.loading || startup.saving || updating}
                      aria-describedby={startup.error ? 'windows-startup-error' : undefined}
                      onChange={(event) => void startup.configure(event.target.checked)}
                    />
                  </SettingRow>
                )}
                <SettingRow
                  label="When closing the main window"
                  htmlFor="close-behavior"
                  description="Minimize to tray keeps your document, connections and overlay running."
                >
                  <Select
                    id="close-behavior"
                    value={closeBehavior}
                    disabled={closeBehaviorDisabled}
                    onChange={(event) => onCloseBehaviorChange(event.target.value)}
                  >
                    <option value="tray">Minimize to tray</option>
                    <option value="quit">Quit app</option>
                  </Select>
                </SettingRow>
              </div>
              {startup.error && (
                <p id="windows-startup-error" className="error" role="alert">
                  {startup.error}
                </p>
              )}
              <p>You can also reopen Veil, show or hide the overlay, or quit from the tray menu.</p>
            </SettingsGroup>
          </section>

          <section hidden={section !== 'Sharing'}>
            <h3>Sharing</h3>
            <SettingsGroup title="Hosting server">
              <p>Configure once to share your documents. Guests only need your link.</p>
              {hosting.resumeShare && (
                <Banner tone="info">
                  Save your server settings to continue sharing this document.
                </Banner>
              )}
              <ServerChoice
                official={hosting.mode === 'public'}
                busy={busy}
                onUseAnother={hosting.onUseAnother}
                onUseOfficial={hosting.onUseOfficial}
                onSelfHosting={() => onOpenUrl(SELF_HOSTING_URL)}
              />
              <form
                className={
                  hosting.mode === 'custom'
                    ? 'settings-card setting-form'
                    : 'setting-form setting-form-plain'
                }
                onSubmit={(event) => {
                  event.preventDefault();
                  hosting.onSave();
                }}
              >
                <div className="setting-row">
                  <div className="setting-form-fields">
                    {hosting.mode === 'custom' && (
                      <>
                        <Field label="Server address" htmlFor="automatic-server">
                          <Input
                            id="automatic-server"
                            value={hosting.server}
                            placeholder="https://signal.example.com"
                            autoComplete="off"
                            disabled={busy}
                            onChange={(event) => hosting.onServerChange(event.target.value)}
                          />
                        </Field>
                        <Field
                          label="Host access credential"
                          htmlFor="automatic-credential"
                          hint="Leave empty to keep a saved credential, or on servers that offer public hosting."
                        >
                          <Input
                            id="automatic-credential"
                            type="password"
                            value={hosting.credential}
                            autoComplete="off"
                            disabled={busy}
                            aria-describedby="automatic-credential-hint"
                            onChange={(event) => hosting.onCredentialChange(event.target.value)}
                          />
                        </Field>
                      </>
                    )}
                    <div className="dialog-actions dialog-actions-start">
                      <Button
                        type="submit"
                        variant="primary"
                        loading={hosting.saving}
                        disabled={busy || !hosting.server.trim()}
                      >
                        {hosting.resumeShare ? 'Save and share' : 'Save settings'}
                      </Button>
                      <Button
                        loading={hosting.testing}
                        disabled={busy || !hosting.server.trim()}
                        onClick={hosting.onTest}
                      >
                        Test connection
                      </Button>
                      {hosting.mode === 'custom' && (
                        <Button
                          variant="ghost"
                          disabled={busy || !hosting.savedServer}
                          onClick={hosting.onForget}
                        >
                          Forget credential
                        </Button>
                      )}
                    </div>
                    <p className="settings-status" role="status" aria-live="polite">
                      {hosting.status}
                    </p>
                  </div>
                </div>
              </form>
              <p>
                {hosting.mode === 'custom' &&
                  "The server's operator provides the address and, when required, a credential. "}
                Changes apply when you start sharing a new document.
              </p>
            </SettingsGroup>
            <SettingsGroup title="Discord">
              <div className="settings-card">
                <SettingRow
                  label="Discord Rich Presence"
                  htmlFor="discord-enabled"
                  description="Share your editing activity on Discord."
                >
                  <Switch
                    id="discord-enabled"
                    checked={discord.preferences?.enabled ?? true}
                    disabled={!discord.preferences || discord.saving || updating}
                    onChange={(event) => void discord.configure({ enabled: event.target.checked })}
                  />
                </SettingRow>
                <SettingRow
                  label="Show document title"
                  htmlFor="discord-title"
                  description="Include your current document title in your Discord activity."
                >
                  <Switch
                    id="discord-title"
                    checked={discord.preferences?.showDocumentTitle ?? true}
                    disabled={!discord.preferences?.enabled || discord.saving || updating}
                    onChange={(event) =>
                      void discord.configure({ showDocumentTitle: event.target.checked })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label="Show participant count"
                  htmlFor="discord-count"
                  description="Include how many other people are connected to your document."
                >
                  <Switch
                    id="discord-count"
                    checked={discord.preferences?.showParticipantCount ?? true}
                    disabled={!discord.preferences?.enabled || discord.saving || updating}
                    onChange={(event) =>
                      void discord.configure({ showParticipantCount: event.target.checked })
                    }
                  />
                </SettingRow>
              </div>
              {discord.error && <Banner tone="danger">{discord.error}</Banner>}
            </SettingsGroup>
          </section>

          <section hidden={section !== 'Overlay'}>
            <h3>Overlay</h3>
            <OverlayControls settingsOnly />
          </section>

          <section hidden={section !== 'Keybinds'}>
            {open && section === 'Keybinds' && <KeybindSettings disabled={updating} />}
          </section>

          <section hidden={section !== updatesSection}>
            <h3>About &amp; updates</h3>
            <SettingsGroup title="Updates">
              {/* Updates polls native state frequently, so it runs only while shown or installing. */}
              {((open && section === updatesSection) || updating) && (
                <Updates onBusy={onUpdateBusy} settingsView />
              )}
            </SettingsGroup>
            <SettingsGroup title="About Veil">
              <div className="settings-card about-card">
                <BrandMark size={40} />
                <div>
                  <strong>Veil</strong>
                  <AppVersion />
                </div>
              </div>
              <DeveloperCredit
                onVisit={(event) => {
                  event.preventDefault();
                  onOpenUrl('https://ahmadfatayerji.com');
                }}
              />
              <div className="about-links">
                <Button
                  icon={
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.084-.729.084-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.333-5.466-5.93 0-1.31.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 3.003-.404c1.02.005 2.047.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.654 1.652.243 2.873.12 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.803 5.625-5.475 5.922.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                    </svg>
                  }
                  onClick={() => onOpenUrl('https://github.com/ahmad-fatayerji/veil')}
                >
                  View repository on GitHub
                </Button>
                <Button
                  icon={
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                    </svg>
                  }
                  onClick={() => onOpenUrl('https://discord.gg/PHQQfyYNRE')}
                >
                  Join the Veil Discord
                </Button>
              </div>
            </SettingsGroup>
          </section>

          {notice && (
            <p className="settings-status" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
