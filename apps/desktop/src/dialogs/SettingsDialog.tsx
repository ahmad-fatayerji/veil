import { useEffect, useRef } from 'react';
import { Info, Keyboard, Monitor, PictureInPicture2, Share2 } from 'lucide-react';
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
  accents,
  type Accent,
  type Appearance,
} from '@veil/ui';
import { SettingRow, SettingsGroup } from './SettingRow';
import { KeybindSettings } from './KeybindSettings';
import { OverlayControls } from '../overlay/Controls';
import { Updates } from '../Updates';
import type { useDiscordPresence } from '../discord';
import { useWindowsStartup } from '../startup';

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

const accentNames: Record<Accent, string> = {
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  orange: 'Orange',
  green: 'Green',
  teal: 'Teal',
  graphite: 'Graphite',
};

/** Color swatches with radio semantics; each previews its accent through the shared tokens. */
function AccentPicker({ value, onChange }: { value: Accent; onChange: (value: Accent) => void }) {
  const group = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={group}
      className="accent-picker"
      role="radiogroup"
      aria-label="Accent color"
      onKeyDown={(event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const next = (accents.indexOf(value) + step + accents.length) % accents.length;
        onChange(accents[next]);
        group.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}
    >
      {accents.map((accent) => (
        <button
          key={accent}
          type="button"
          role="radio"
          className="accent-swatch"
          data-accent={accent}
          aria-checked={accent === value}
          aria-label={accentNames[accent]}
          title={accentNames[accent]}
          tabIndex={accent === value ? 0 : -1}
          onClick={() => onChange(accent)}
        />
      ))}
    </div>
  );
}

export type HostingForm = {
  server: string;
  credential: string;
  savedServer: string;
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
  onAccentChange: (value: Accent) => void;
  hosting: HostingForm;
  notice: string;
  error: string;
  onOpenUrl: (url: string) => void;
}) {
  const startup = useWindowsStartup(open);
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
                <SettingRow
                  label="Accent color"
                  description="Used for buttons, highlights and selections in both windows."
                >
                  <AccentPicker value={accent} onChange={onAccentChange} />
                </SettingRow>
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
              <form
                className="settings-card setting-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  hosting.onSave();
                }}
              >
                <div className="setting-row">
                  <div className="setting-form-fields">
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
                      hint="Leave empty to keep your saved credential."
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
                      <Button
                        variant="ghost"
                        disabled={busy || !hosting.savedServer}
                        onClick={hosting.onForget}
                      >
                        Forget credential
                      </Button>
                    </div>
                    <p className="settings-status" role="status" aria-live="polite">
                      {hosting.status}
                    </p>
                  </div>
                </div>
              </form>
              <p>
                Your server operator provides the address and credential. Changes apply when you
                start sharing a new document.
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
