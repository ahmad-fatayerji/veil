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
import { Caption } from '../ui/Caption';
import { appFrame } from '../theme';

// The real home screen in light, then a quick circular wipe to dark.
const HomeThemesInner = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const radius = interpolate(frame, [0.8 * fps, 1.5 * fps], [0, 150], {
    easing: Easing.bezier(0.65, 0, 0.35, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <>
      <Caption name="Caption">Light or dark, made for Windows</Caption>
      <Audio
        name="Theme switch"
        src={staticFile('sfx/switch.wav')}
        from={Math.round(0.75 * fps)}
        volume={0.45}
      />
      <div
        style={{
          position: 'absolute',
          left: appFrame.x,
          top: appFrame.y,
          width: 1280 * appFrame.scale,
          height: 800 * appFrame.scale,
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.09)',
        }}
      >
        <Img
          name="Home, light"
          src={staticFile('capture/home-light.png')}
          style={{ width: '100%', height: '100%' }}
        />
        <Img
          name="Home, dark"
          src={staticFile('capture/home-dark.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            clipPath: `circle(${radius}% at 50% 45%)`,
          }}
        />
      </div>
    </>
  );
};

export const HomeThemes = Interactive.create({
  Component: HomeThemesInner,
  layout: 'absolute-fill',
  schema: {
    ...Interactive.backgroundSchema,
  },
});
