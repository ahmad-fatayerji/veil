import { useId } from 'react';

export type DiscordStatus = 'online' | 'idle' | 'dnd' | 'offline';

/** Discord's presence shapes: a solid dot, a crescent moon, a dot with a bar and
 * a ring, each cut from a circle so they read the same as in Discord. */
export function DiscordStatusIcon({ status, size = 10 }: { status: DiscordStatus; size?: number }) {
  // useId punctuation is not safe inside url(#…) references.
  const mask = `discord-status-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <mask id={mask}>
        <circle cx="5" cy="5" r="5" fill="white" />
        {status === 'idle' && <circle cx="2.5" cy="2.5" r="3.75" fill="black" />}
        {status === 'dnd' && (
          <rect x="1.25" y="3.75" width="7.5" height="2.5" rx="1.25" fill="black" />
        )}
        {status === 'offline' && <circle cx="5" cy="5" r="2.5" fill="black" />}
      </mask>
      <circle cx="5" cy="5" r="5" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
}
