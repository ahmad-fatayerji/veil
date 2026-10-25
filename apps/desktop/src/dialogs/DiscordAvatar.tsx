import { useEffect, useRef, useState } from 'react';
import type { DiscordPerson } from '../discord-social';
import { invoke } from '../overlay/api';

/** Avatars already fetched this connection, so reopening a list needs no IPC.
 * Keyed by person and avatar revision; cleared with the Discord identity. */
const downloadedAvatars = new Map<string, string>();
const AVATAR_ENTRIES = 256;

export function clearDiscordAvatarCache() {
  downloadedAvatars.clear();
}

function AvatarImage({ person, small }: { person: DiscordPerson; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const cacheKey = `${person.id}:${person.avatarRevision ?? ''}`;
  const [downloaded, setDownloaded] = useState(() => downloadedAvatars.get(cacheKey));
  const container = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (person.avatarDataUrl || person.id === '0' || downloadedAvatars.has(cacheKey)) return;
    let active = true;
    const observer = new IntersectionObserver(
      (items) => {
        if (!items.some((item) => item.isIntersecting)) return;
        observer.disconnect();
        void invoke<string | null>('discord_avatar', { personId: person.id })
          .then((value) => {
            if (!value) return;
            if (downloadedAvatars.size >= AVATAR_ENTRIES)
              downloadedAvatars.delete(downloadedAvatars.keys().next().value!);
            downloadedAvatars.set(cacheKey, value);
            if (active) setDownloaded(value);
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
  }, [person.id, person.avatarDataUrl, cacheKey]);
  const image = person.avatarDataUrl ?? downloaded;
  const raster =
    image &&
    image.length <= 512 * 1024 &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(image);
  return (
    <span
      ref={container}
      className={`discord-avatar ${small ? 'discord-avatar-sm' : ''}`}
      aria-hidden="true"
    >
      {raster && !failed ? (
        <img src={image} alt="" onError={() => setFailed(true)} />
      ) : (
        Array.from(person.displayName.trim() || person.username)[0]?.toUpperCase() || '?'
      )}
    </span>
  );
}

export function DiscordAvatar({ person, small }: { person: DiscordPerson; small?: boolean }) {
  return (
    <AvatarImage
      key={`${person.id}:${person.avatarRevision ?? ''}`}
      person={person}
      small={small}
    />
  );
}
