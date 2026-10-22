import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { LoaderCircle } from 'lucide-react';
import { Kbd } from './Kbd';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  className = '',
  type = 'button',
  disabled,
  children,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type={type}
      className={`btn btn-${variant} btn-${size} ${block ? 'btn-block' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="spinner" size={16} aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

/** Rendered inline (no portal) so tooltips also work inside modal dialogs. */
export function Tooltip({
  content,
  shortcut,
  side = 'bottom',
  children,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <RadixTooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Content className="tooltip" side={side} sideOffset={6} collisionPadding={8}>
          {content}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </RadixTooltip.Content>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

export function IconButton({
  label,
  shortcut,
  size = 'md',
  attention = false,
  tooltip = true,
  className = '',
  type = 'button',
  children,
  ref,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string;
  shortcut?: string;
  size?: 'sm' | 'md';
  attention?: boolean;
  tooltip?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={`icon-btn ${size === 'sm' ? 'icon-btn-sm' : ''} ${className}`}
      {...props}
    >
      {children}
      {attention && <span className="attention-dot" aria-hidden="true" />}
    </button>
  );
  return tooltip ? (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
