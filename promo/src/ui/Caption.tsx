import type React from 'react';
import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { color, font } from '../theme';

// A headline above the app that eases in and out over its own sequence.
const CaptionInner: React.FC<{
  readonly children: React.ReactNode;
  readonly style?: React.CSSProperties;
}> = ({ children, style }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        top: 72,
        left: 80,
        right: 80,
        textAlign: 'center',
        fontFamily: font.display,
        fontSize: 72,
        fontWeight: 600,
        letterSpacing: -1,
        color: color.fg,
        ...style,
      }}
    >
      <div
        style={{
          opacity: interpolate(
            frame,
            [0, 0.35 * fps, durationInFrames - 0.3 * fps, durationInFrames],
            [0, 1, 1, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          ),
          translate: interpolate(frame, [0, 0.5 * fps], ['0px 18px', '0px 0px'], {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const Caption = Interactive.create({
  Component: CaptionInner,
  layout: 'none',
  schema: {
    ...Interactive.textSchema,
    ...Interactive.childrenSchema,
  },
});
