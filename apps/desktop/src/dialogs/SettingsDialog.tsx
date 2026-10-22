import type { ReactNode } from 'react';
import { Download, Info, Monitor, Palette, PictureInPicture2, Server } from 'lucide-react';
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
  type Appearance,
} from '@veil/ui';
import { OverlayControls } from '../overlay/Controls';
import { Updates } from '../Updates';

export type Section = 'General' | 'Appearance' | 'Hosting server' | 'Overlay' | 'Updates' | 'About';
const sections: { id: Section; icon: typeof Monitor }[] = [
  { id: 'General', icon: Monitor },
  { id: 'Appearance', icon: Palette },
  { id: 'Hosting server', icon: Server },
  { id: 'Overlay', icon: PictureInPicture2 },
  { id: 'Updates', icon: Download },
  { id: 'About', icon: Info },
];

export function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-text">
        {htmlFor ? (
          <label className="setting-row-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="setting-row-label">{label}</span>
        )}
        {description && <p>{description}</p>}
      </div>
      {children}
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
  closeBehavior,
  closeBehaviorDisabled,
  onCloseBehaviorChange,
  appearance,
  onAppearanceChange,
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
  closeBehavior: string;
  closeBehaviorDisabled: boolean;
  onCloseBehaviorChange: (value: string) => void;
  appearance: Appearance;
  onAppearanceChange: (value: Appearance) => void;
  hosting: HostingForm;
  notice: string;
  error: string;
  onOpenUrl: (url: string) => void;
}) {
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
                id === 'Updates' && updateAttention ? 'Update requires attention' : undefined
              }
              aria-current={section === id ? 'page' : undefined}
              data-autofocus={section === id ? '' : undefined}
              disabled={updating && id !== 'Updates'}
              onClick={() => onSectionChange(id)}
            >
              <Icon size={16} aria-hidden="true" />
              {id}
              {id === 'Updates' && updateAttention && (
                <span className="settings-nav-attention" aria-hidden="true" />
              )}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <section hidden={section !== 'General'}>
            <h3>General</h3>
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
            <p>You can also reopen Veil, show or hide the overlay, or quit from the tray menu.</p>
          </section>

          <section hidden={section !== 'Appearance'}>
            <h3>Appearance</h3>
            <div className="settings-card">
              <SettingRow label="Theme" description="Applies to the control panel and the overlay.">
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
            </div>
          </section>

          <section hidden={section !== 'Hosting server'}>
            <h3>Hosting server</h3>
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
              Your server operator provides the address and credential. Changes apply when you start
              sharing a new document.
            </p>
          </section>

          <section hidden={section !== 'Overlay'}>
            <h3>Overlay</h3>
            <OverlayControls settingsOnly />
          </section>

          <section hidden={section !== 'Updates'}>
            <h3>Updates</h3>
            <Updates onBusy={onUpdateBusy} settingsView />
          </section>

          <section hidden={section !== 'About'}>
            <h3>About</h3>
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
            <div>
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
            </div>
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
