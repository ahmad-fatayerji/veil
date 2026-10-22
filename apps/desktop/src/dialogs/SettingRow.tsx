import { useId, type ReactNode } from 'react';

/** A titled group of related settings within a Settings page. */
export function SettingsGroup({
  title,
  aside,
  children,
}: {
  title: string;
  /** Short note shown at the end of the heading, e.g. where settings are saved. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="settings-group" aria-labelledby={id}>
      <div className="settings-group-heading">
        <h4 id={id}>{title}</h4>
        {aside && <span>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

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
