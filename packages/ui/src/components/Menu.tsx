import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Tooltip } from './buttons';

export function Menu({
  label,
  trigger,
  attention = false,
  align = 'end',
  triggerClassName = 'icon-btn',
  tooltip = true,
  children,
}: {
  label: string;
  trigger: ReactNode;
  attention?: boolean;
  align?: 'start' | 'center' | 'end';
  triggerClassName?: string;
  tooltip?: boolean;
  children: ReactNode;
}) {
  const button = (
    <DropdownMenu.Trigger className={triggerClassName} aria-label={label}>
      {trigger}
      {attention && <span className="attention-dot" aria-hidden="true" />}
    </DropdownMenu.Trigger>
  );
  return (
    <DropdownMenu.Root modal={false}>
      {tooltip ? (
        <Tooltip content={label}>{button}</Tooltip>
      ) : (
        button
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align={align} sideOffset={6} collisionPadding={8}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  icon,
  tone,
  disabled,
  shortcut,
  onSelect,
  children,
}: {
  icon?: ReactNode;
  shortcut?: string;
  tone?: 'danger';
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Item
      className="menu-item"
      data-tone={tone}
      disabled={disabled}
      onSelect={onSelect}
    >
      {icon}
      {children}
      {shortcut && (
        <kbd className="kbd" aria-hidden="true">
          {shortcut}
        </kbd>
      )}
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="menu-separator" />;
}
