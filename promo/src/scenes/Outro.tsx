import {
  Easing,
  Img,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Watermark } from '../ui/Brand';

// End card: centred brand over the start screen's "V", with where to get it.
const OutroInner = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <>
      <Interactive.Div
        name="Watermark"
        style={{
          position: 'absolute',
          left: 330,
          top: -40,
          width: 1260,
          height: 1176,
          opacity: interpolate(frame, [0, 0.8 * fps], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          scale: interpolate(frame, [0, 3 * fps], [1.08, 1], {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: 'perceptual-scale',
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <Watermark id="outro-v" style={{ inset: 0, width: '100%', height: '100%' }} />
      </Interactive.Div>
      <Img
        name="App icon"
        src={staticFile('product/veil-icon.png')}
        style={{
          width: 132,
          height: 132,
          opacity: interpolate(frame, [0, 0.35 * fps], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          scale: interpolate(frame, [0, 0.7 * fps], [0.8, 1], {
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
          fontSize: 170,
          fontWeight: 600,
          letterSpacing: -5,
          lineHeight: 1,
          color: '#f5f5f5',
          marginTop: 26,
          opacity: interpolate(frame, [0.15 * fps, 0.55 * fps], [0, 1], {
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
          fontSize: 56,
          color: '#c9c9c9',
          marginTop: 22,
          opacity: interpolate(frame, [0.3 * fps, 0.7 * fps], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        Shared notes with <span style={{ color: '#f06b6b' }}>a private overlay.</span>
      </Interactive.Div>
      <Interactive.Div
        name="Call to action"
        style={{
          marginTop: 56,
          padding: '20px 48px',
          borderRadius: 999,
          background: 'linear-gradient(135deg, #f58a7a 0%, #e5484d 100%)',
          boxShadow: '0 18px 50px rgba(229,72,77,0.35)',
          fontFamily: '"Segoe UI Variable Text", "Segoe UI", sans-serif',
          fontSize: 40,
          fontWeight: 600,
          color: '#2b0a0e',
          opacity: interpolate(frame, [0.55 * fps, 0.9 * fps], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          scale: interpolate(frame, [0.55 * fps, 1.1 * fps], [0.9, 1], {
            easing: Easing.spring({ damping: 200 }),
            output: 'perceptual-scale',
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        Free for Windows 10 & 11
      </Interactive.Div>
      <Interactive.Div
        name="Link"
        style={{
          fontFamily: '"Segoe UI Variable Text", "Segoe UI", sans-serif',
          fontSize: 32,
          color: '#9a9a9a',
          marginTop: 24,
          opacity: interpolate(frame, [0.8 * fps, 1.2 * fps], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        github.com/ahmad-fatayerji/veil
      </Interactive.Div>
    </>
  );
};

export const Outro = Interactive.create({
  Component: OutroInner,
  layout: 'absolute-fill',
  schema: {
    ...Interactive.backgroundSchema,
  },
});
