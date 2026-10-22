import type { ReactNode } from 'react';

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
