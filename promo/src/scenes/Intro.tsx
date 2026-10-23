import { Audio } from '@remotion/media';
import {
  Easing,
  Img,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Chip, Shot, Watermark } from '../ui/Brand';

// Title card: brand on the left, a tilted stack of real screenshots on the right with
// the overlay in front, over the start screen's giant "V".
const IntroInner = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <>
      <Audio name="Whoosh" src={staticFile('sfx/whoosh.wav')} volume={0.3} />
      <Interactive.Div
        name="Watermark"
        style={{
          position: 'absolute',
          left: 760,
          top: -110,
          width: 1340,
          height: 1250,
          opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          translate: interpolate(frame, [0, durationInFrames], ['60px 0px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <Watermark id="intro-v" style={{ inset: 0, width: '100%', height: '100%' }} />
      </Interactive.Div>

      <div style={{ position: 'absolute', left: 150, top: 230 }}>
        <Img
          name="App icon"
          src={staticFile('product/veil-icon.png')}
          style={{
            width: 124,
            height: 124,
            opacity: interpolate(frame, [0, 0.3 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            scale: interpolate(frame, [0, 0.6 * fps], [0.75, 1], {
              easing: Easing.spring({ damping: 200 }),
              output: 'perceptual-scale',
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        />
        <Interactive.Div
          name="Wordmark"
          style={{
            fontFamily: '"Segoe UI Variable Display", "Segoe UI", sans-serif',
            fontSize: 200,
            fontWeight: 600,
            letterSpacing: -6,
            lineHeight: 1,
            color: '#f5f5f5',
            marginTop: 30,
            opacity: interpolate(frame, [0.12 * fps, 0.5 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            translate: interpolate(frame, [0.12 * fps, 0.7 * fps], ['0px 30px', '0px 0px'], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Veil
        </Interactive.Div>
        <Interactive.Div
          name="Tagline"
          style={{
            fontFamily: '"Segoe UI Variable Display", "Segoe UI", sans-serif',
            fontSize: 62,
            lineHeight: 1.15,
            color: '#c9c9c9',
            marginTop: 26,
            opacity: interpolate(frame, [0.3 * fps, 0.7 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Shared notes with
          <br />
          <span style={{ color: '#f06b6b' }}>a private overlay.</span>
        </Interactive.Div>
        <Interactive.Div
          name="Chips"
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 44,
            opacity: interpolate(frame, [0.5 * fps, 0.9 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <Chip>Windows 10 & 11</Chip>
          <Chip>Free and open source</Chip>
        </Interactive.Div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 960,
          top: 200,
          width: 880,
          height: 720,
          transform: 'perspective(2200px) rotateY(-14deg) rotateX(3deg)',
          transformOrigin: 'left center',
        }}
      >
        <Interactive.Div
          name="Light workspace"
          style={{
            opacity: interpolate(frame, [0.05 * fps, 0.45 * fps], [0, 0.9], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            translate: interpolate(frame, [0.05 * fps, 0.8 * fps], ['140px 0px', '0px 0px'], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <Shot
            src={staticFile('capture/workspace-light.png')}
            width={620}
            style={{ left: 250, top: 0 }}
          />
        </Interactive.Div>
        <Interactive.Div
          name="Dark home"
          style={{
            opacity: interpolate(frame, [0.18 * fps, 0.55 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            translate: interpolate(frame, [0.18 * fps, 0.95 * fps], ['140px 0px', '0px 0px'], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <Shot
            src={staticFile('capture/home-dark.png')}
            width={700}
            style={{ left: 0, top: 170 }}
          />
        </Interactive.Div>
        <Interactive.Div
          name="Overlay"
          style={{
            opacity: interpolate(frame, [0.35 * fps, 0.7 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            translate: interpolate(frame, [0.35 * fps, 1.1 * fps], ['0px 80px', '0px 0px'], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <Shot
            src={staticFile('capture/overlay.png')}
            width={330}
            style={{
              left: 500,
              top: 330,
              borderRadius: 10,
              boxShadow: '0 40px 90px rgba(0,0,0,0.75), 0 0 0 1px rgba(240,107,107,0.45)',
            }}
          />
        </Interactive.Div>
      </div>
    </>
  );
};

export const Intro = Interactive.create({
  Component: IntroInner,
  layout: 'absolute-fill',
  schema: {
    ...Interactive.backgroundSchema,
  },
});
