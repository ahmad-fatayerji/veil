import type { ReactNode } from 'react';
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { IconButton } from './buttons';

type Tone = 'neutral' | 'info' | 'warning' | 'danger';
const toneIcons = {
  neutral: Info,
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export function Banner({
  tone = 'neutral',
  icon,
  actions,
  onDismiss,
  role = 'status',
  className = '',
  children,
}: {
  tone?: Tone;
  icon?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  role?: 'status' | 'alert' | 'group';
  className?: string;
  children: ReactNode;
}) {
  const ToneIcon = toneIcons[tone];
  return (
    <div className={`banner ${className}`} data-tone={tone} role={role}>
      {icon ?? <ToneIcon size={16} aria-hidden="true" />}
      <div className="banner-body">{children}</div>
      {actions && <div className="banner-actions">{actions}</div>}
      {onDismiss && (
        <IconButton label="Dismiss" size="sm" tooltip={false} onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}

/** Fixed, bottom-centred messages. Each child should be a Banner with className="toast". */
export function ToastRegion({ children }: { children: ReactNode }) {
  return (
    <div className="toast-region" aria-live="polite">
      {children}
    </div>
  );
}

export function StatusIndicator({
  icon,
  label,
  tone = 'neutral',
  title,
}: {
  icon: ReactNode;
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  title?: string;
}) {
  return (
    <span className="status-indicator" data-tone={tone} role="status" title={title}>
      {icon}
      <span className="status-label">{label}</span>
    </span>
  );
}
