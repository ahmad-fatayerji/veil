import { Audio } from '@remotion/media';
import {
  Easing,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { clips } from '../capture';
import { font } from '../theme';
import { AppClip } from '../ui/AppClip';
import { Caption } from '../ui/Caption';

// A presenter's slide with the real overlay recording floating above it. The overlay
// shows Sam's edit arriving live, then Alex ticking a task and typing in place.
const OverlayLiveInner = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <>
      <Caption name="Caption" style={{ fontSize: 64 }}>
        Your notes float above everything. Edit them live.
      </Caption>
      <Audio name="Overlay appears" src={staticFile('sfx/whoosh.wav')} volume={0.3} />
      <div
        style={{
          position: 'absolute',
          left: 260,
          top: 232,
          width: 1400,
          height: 788,
          borderRadius: 10,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #22406f 0%, #3a2458 100%)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.09)',
          fontFamily: font.display,
          color: '#ffffff',
        }}
      >
        <div style={{ position: 'absolute', left: 90, top: 110, fontSize: 92, fontWeight: 600 }}>
          Q4 roadmap
        </div>
        <div style={{ position: 'absolute', left: 92, top: 240, fontSize: 38, opacity: 0.7 }}>
          Ship the overlay · Grow sharing
        </div>
        <div
          style={{
            position: 'absolute',
            left: 90,
            top: 360,
            display: 'flex',
            flexDirection: 'column',
            gap: 26,
          }}
        >
          {['Overlay polish', 'Faster joins', 'Self-hosting guide'].map((item, index) => (
            <div
              key={item}
              style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 40, opacity: 0.9 }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: 'rgba(255,255,255,0.14)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 30,
                  fontWeight: 600,
                }}
              >
                {index + 1}
              </div>
              {item}
            </div>
          ))}
        </div>
      </div>
      <Interactive.Div
        name="Overlay"
        style={{
          position: 'absolute',
          left: 1072,
          top: 268,
          opacity: interpolate(frame, [0, 0.3 * fps], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          scale: interpolate(frame, [0, 0.5 * fps], [0.92, 1], {
            easing: Easing.spring({ damping: 200 }),
            output: 'perceptual-scale',
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <AppClip
          src={staticFile('capture/overlay-live.mp4')}
          data={clips.overlayLive}
          scale={0.92}
          trimStart={0.4}
          rate={1.45}
          style={{ position: 'relative', borderRadius: 8 }}
        />
      </Interactive.Div>
    </>
  );
};

export const OverlayLive = Interactive.create({
  Component: OverlayLiveInner,
  layout: 'absolute-fill',
  schema: {},
});
