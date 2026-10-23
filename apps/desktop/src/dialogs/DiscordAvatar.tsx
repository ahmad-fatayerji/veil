import { useEffect, useRef, useState } from 'react';
import type { DiscordPerson } from '../discord-social';
import { invoke } from '../overlay/api';

function AvatarImage({ person }: { person: DiscordPerson }) {
  const [failed, setFailed] = useState(false);
  const [downloaded, setDownloaded] = useState<string | undefined>();
  const container = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (person.avatarDataUrl || person.id === '0') return;
    let active = true;
    const observer = new IntersectionObserver(
      (items) => {
        if (!items.some((item) => item.isIntersecting)) return;
        observer.disconnect();
        void invoke<string | null>('discord_avatar', { personId: person.id })
          .then((value) => {
            if (active && value) setDownloaded(value);
          })
          .catch(() => {});
      },
      { rootMargin: '100px' },
    );
    if (container.current) observer.observe(container.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [person.id, person.avatarDataUrl, person.avatarRevision]);
  const image = person.avatarDataUrl ?? downloaded;
  const raster =
    image &&
    image.length <= 512 * 1024 &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(image);
  return (
    <span ref={container} className="discord-avatar" aria-hidden="true">
      {raster && !failed ? (
        <img src={image} alt="" onError={() => setFailed(true)} />
      ) : (
        Array.from(person.displayName.trim() || person.username)[0]?.toUpperCase() || '?'
      )}
    </span>
  );
}

export function DiscordAvatar({ person }: { person: DiscordPerson }) {
  return <AvatarImage key={`${person.id}:${person.avatarRevision ?? ''}`} person={person} />;
}
