// Click logs written by capture/capture.mjs next to each recorded clip.
import collabGuest from '../public/capture/collab-guest.json';
import collabHost from '../public/capture/collab-host.json';
import overlayLive from '../public/capture/overlay-live.json';
import overlaySettings from '../public/capture/overlay-settings.json';
import overlayShow from '../public/capture/overlay-show.json';
import share from '../public/capture/share.json';
import write from '../public/capture/write.json';

export type ClipEvent = {
  t: number;
  type: string;
  x?: number;
  y?: number;
};

export type ClipData = {
  width: number;
  height: number;
  duration: number;
  events: ClipEvent[];
};

export const clips = {
  collabGuest,
  collabHost,
  overlayLive,
  overlaySettings,
  overlayShow,
  share,
  write,
} satisfies Record<string, ClipData>;
