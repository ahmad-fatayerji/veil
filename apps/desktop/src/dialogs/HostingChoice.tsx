import { useRef, type KeyboardEvent } from 'react';
import { Check, ExternalLink, Globe, Server } from 'lucide-react';
import { Button, Field, Input } from '@veil/ui';

/** Our free public servers, or another server (which may be ours, used privately with a credential). */
export type HostingMode = 'public' | 'custom';
export type HostingForm = {
  server: string;
  credential: string;
  savedServer: string;
  mode: HostingMode;
  status: string;
  testing: boolean;
  saving: boolean;
  onModeChange: (mode: HostingMode) => void;
  onServerChange: (value: string) => void;
  onCredentialChange: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onForget: () => void;
};

const publicLimits = [
  'Up to 5 guests per document',
  'A few shared documents at a time',
  'Limited relay for strict networks',
  'No uptime guarantee',
];

const options: {
  mode: HostingMode;
  icon: typeof Globe;
  title: string;
  description: string;
  recommended?: boolean;
}[] = [
  {
    mode: 'public',
    icon: Globe,
    title: 'Veil public servers',
    description: 'Free and ready to use. No setup or credential needed.',
  },
  {
    mode: 'custom',
    icon: Server,
    title: 'My own server',
    description: 'A server you run, or one an operator gives you access to.',
    recommended: true,
  },
];

/**
 * Which server sharing uses, shown side by side so both choices stay visible. Our public
 * servers are free and need nothing; another server asks for its address and credential.
 * `id` keeps field ids unique while Settings and Share both render this choice.
 */
export function HostingChoice({
  id,
  hosting,
  busy,
  onSelfHosting,
}: {
  id: string;
  hosting: HostingForm;
  busy: boolean;
  onSelfHosting: () => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  function choose(mode: HostingMode) {
    if (mode === hosting.mode) return;
    hosting.onModeChange(mode);
    if (mode === 'custom')
      requestAnimationFrame(() => window.document.getElementById(`${id}-server`)?.focus());
  }
  function onKeyDown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = hosting.mode === 'public' ? 1 : 0;
    hosting.onModeChange(options[next].mode);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }
  return (
    <div className="hosting-choice">
      <div
        ref={group}
        className="hosting-options"
        role="radiogroup"
        aria-label="Hosting server"
        onKeyDown={onKeyDown}
      >
        {options.map(({ mode, icon: Icon, title, description, recommended }) => {
          const checked = hosting.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              className="hosting-option"
              aria-checked={checked}
              aria-labelledby={`${id}-${mode}-title`}
              aria-describedby={`${id}-${mode}-description`}
              tabIndex={checked ? 0 : -1}
              disabled={busy}
              onClick={() => choose(mode)}
            >
              <span className="hosting-option-header">
                <span className="hosting-option-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                {recommended && <span className="hosting-option-badge">Recommended</span>}
                <span className="hosting-option-check" aria-hidden="true">
                  {checked && <Check size={12} strokeWidth={3} />}
                </span>
              </span>
              <span className="hosting-option-title" id={`${id}-${mode}-title`}>
                {title}
              </span>
              <span className="hosting-option-description" id={`${id}-${mode}-description`}>
                {description}
              </span>
            </button>
          );
        })}
      </div>
      {hosting.mode === 'public' ? (
        // A panel of its own, like the fields of another server, so the limits read as
        // belonging to the public servers rather than to whichever column they sit under.
        <div className="hosting-details hosting-panel">
          <span className="hosting-panel-title" id={`${id}-limits`}>
            Veil public server limits
          </span>
          <ul className="server-limits" aria-labelledby={`${id}-limits`}>
            {publicLimits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
          <p className="field-hint">
            For reliable or larger sessions, use your own server.{' '}
            <button type="button" className="text-link" onClick={onSelfHosting}>
              Self-hosting guide
              <ExternalLink size={12} aria-hidden="true" />
            </button>
          </p>
        </div>
      ) : (
        <div className="hosting-details hosting-panel hosting-fields">
          <Field label="Server address" htmlFor={`${id}-server`}>
            <Input
              id={`${id}-server`}
              value={hosting.server}
              placeholder="https://signal.example.com"
              autoComplete="off"
              disabled={busy}
              onChange={(event) => hosting.onServerChange(event.target.value)}
            />
          </Field>
          <Field
            label="Host access credential"
            htmlFor={`${id}-credential`}
            optional
            hint="Your server's operator provides it when required. Leave empty to keep a saved credential."
          >
            <Input
              id={`${id}-credential`}
              type="password"
              value={hosting.credential}
              autoComplete="off"
              disabled={busy}
              aria-describedby={`${id}-credential-hint`}
              onChange={(event) => hosting.onCredentialChange(event.target.value)}
            />
          </Field>
          <div>
            <Button
              size="sm"
              loading={hosting.testing}
              disabled={busy || !hosting.server.trim()}
              onClick={hosting.onTest}
            >
              Test connection
            </Button>
          </div>
        </div>
      )}
      <p className="settings-status" role="status" aria-live="polite">
        {hosting.status}
      </p>
    </div>
  );
}
