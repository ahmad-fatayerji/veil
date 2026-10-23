import type { CSSProperties } from 'react';
import type { Participant } from '@veil/collaboration';

export const activityLabels = {
  typing: 'Typing…',
  selecting: 'Selecting text',
  document: 'In document',
  away: 'Away from document',
};

export function initial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

export function Avatar({
  person,
  size = 'md',
  variant = 'soft',
}: {
  person: Pick<Participant, 'name' | 'color'>;
  size?: 'sm' | 'md';
  variant?: 'soft' | 'solid';
}) {
  return (
    <span
      className={`avatar ${size === 'sm' ? 'avatar-sm' : ''} ${variant === 'solid' ? 'avatar-solid' : ''}`}
      style={{ '--person-color': person.color } as CSSProperties}
      aria-hidden="true"
    >
      {initial(person.name)}
    </span>
  );
}

export function AvatarStack({ people, max = 3 }: { people: Participant[]; max?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack" aria-hidden="true">
      {shown.map((person) => (
        <Avatar key={person.id} person={person} size="sm" />
      ))}
      {extra > 0 && <span className="avatar avatar-sm avatar-more">+{extra}</span>}
    </span>
  );
}
