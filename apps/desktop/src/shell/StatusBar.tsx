import type { ReactNode } from 'react';

export function StatusBar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return (
    <footer className="statusbar">
      <div className="statusbar-start">{start}</div>
      <div className="statusbar-end">{end}</div>
    </footer>
  );
}
