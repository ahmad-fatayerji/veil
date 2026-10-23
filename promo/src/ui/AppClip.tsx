import { Audio, Video } from '@remotion/media';
import type React from 'react';
import { Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ClipData } from '../capture';

type Point = { t: number; x: number; y: number };

// Cursor keyframes from the click log: each move glides to its target, drags follow
// the pointer between down and up.
function cursorPath(data: ClipData): Point[] {
  const points: Point[] = [];
  const events = data.events.filter((event) => event.x !== undefined);
  if (!events.length) return points;
  const first = events[0];
  points.push({ t: 0, x: first.x! + 180, y: first.y! + 140 });
  events.forEach((event, index) => {
    const previous = points[points.length - 1];
    if (event.type === 'move') {
      const next = events[index + 1]?.t ?? event.t + 0.4;
      points.push({ t: event.t, x: previous.x, y: previous.y });
      points.push({ t: Math.min(event.t + 0.34, next - 0.02), x: event.x!, y: event.y! });
    } else if (event.type === 'up') {
      points.push({ t: event.t, x: event.x!, y: event.y! });
    }
  });
  return points;
}

const ease = Easing.bezier(0.3, 0, 0.2, 1);

const Pointer: React.FC<{
  readonly path: Point[];
  readonly t: number;
  readonly pressed: boolean;
}> = ({ path, t, pressed }) => {
  let index = path.findIndex((point) => point.t > t);
  if (index === -1) index = path.length;
  const a = path[Math.max(0, index - 1)];
  const b = path[Math.min(path.length - 1, index)];
  const p = b.t === a.t ? 1 : ease(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
  const x = a.x + (b.x - a.x) * p;
  const y = a.y + (b.y - a.y) * p;
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 20 20"
      style={{
        position: 'absolute',
        left: x - 3,
        top: y - 2,
        scale: pressed ? 0.88 : 1,
        transformOrigin: '3px 2px',
        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.45))',
      }}
    >
      <path
        d="M2 1 L2 16.5 L6 12.8 L8.7 18.6 L11.3 17.4 L8.7 11.8 L14 11.8 Z"
        fill="#ffffff"
        stroke="#111111"
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
    </svg>
  );
};

// One recorded app clip, framed like a window, with the logged pointer and click sounds.
export const AppClip: React.FC<{
  readonly src: string;
  readonly data: ClipData;
  readonly scale: number;
  readonly trimStart?: number;
  readonly rate?: number;
  readonly cursor?: boolean;
  readonly sounds?: boolean;
  readonly style?: React.CSSProperties;
}> = ({ src, data, scale, trimStart = 0, rate = 1, cursor = true, sounds = true, style }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = trimStart + (frame / fps) * rate;
  const clicks = data.events.filter((event) => event.type === 'click' || event.type === 'down');
  const toFrame = (clipTime: number) => Math.round(((clipTime - trimStart) / rate) * fps);
  const pressed = data.events.some(
    (event) =>
      (event.type === 'click' && t >= event.t && t < event.t + 0.12) ||
      (event.type === 'down' &&
        t >= event.t &&
        t < (data.events.find((up) => up.type === 'up' && up.t > event.t)?.t ?? event.t)),
  );
  return (
    <div
      style={{
        position: 'absolute',
        width: data.width * scale,
        height: data.height * scale,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.09)',
        ...style,
      }}
    >
      <Video
        src={src}
        trimBefore={Math.round(trimStart * fps)}
        playbackRate={rate}
        muted
        style={{ width: '100%', height: '100%' }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: data.width,
          height: data.height,
          scale: `${scale}`,
          transformOrigin: '0 0',
        }}
      >
        {clicks.map((click) => {
          const age = t - click.t;
          if (age < 0 || age > 0.45) return null;
          return (
            <div
              key={click.t}
              style={{
                position: 'absolute',
                left: click.x! - 22,
                top: click.y! - 22,
                width: 44,
                height: 44,
                borderRadius: 22,
                border: '3px solid #f06b6b',
                opacity: interpolate(age, [0, 0.45], [0.9, 0]),
                scale: interpolate(age, [0, 0.45], [0.4, 1.4]),
              }}
            />
          );
        })}
        {cursor ? <Pointer path={cursorPath(data)} t={t} pressed={pressed} /> : null}
      </div>
      {sounds
        ? clicks
            .filter((click) => toFrame(click.t) >= 0 && toFrame(click.t) < durationInFrames)
            .map((click) => (
              <Audio
                key={click.t}
                src={staticFile('sfx/mouse-click.wav')}
                from={toFrame(click.t)}
                volume={0.5}
              />
            ))
        : null}
    </div>
  );
};
