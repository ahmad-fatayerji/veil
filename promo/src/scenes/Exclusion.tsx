import { Audio, Video } from '@remotion/media';
import type React from 'react';
import {
  Easing,
  Img,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import exclusion from '../../public/capture/exclusion.json';
import { color, font } from '../theme';
import { Caption } from '../ui/Caption';

// Region 640x440 captured by capture/exclusion.mjs; the overlay sat at (pad, pad) in it.
const S = 1.22;
const W = exclusion.region.width * S;
const H = exclusion.region.height * S;
const LEFT = (1920 - W * 2 - 80) / 2;
const RIGHT = LEFT + W + 80;
const TOP = 300;

const Panel: React.FC<{ readonly left: number; readonly children: React.ReactNode }> = ({
  left,
  children,
}) => (
  <div
    style={{
      position: 'absolute',
      left,
      top: TOP,
      width: W,
      height: H,
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.09)',
    }}
  >
    {children}
  </div>
);

const PanelTitle: React.FC<{ readonly left: number; readonly children: React.ReactNode }> = ({
  left,
  children,
}) => (
  <div
    style={{
      position: 'absolute',
      left,
      top: TOP - 62,
      width: W,
      fontFamily: font.ui,
      fontSize: 38,
      fontWeight: 600,
      color: color.fg,
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    }}
  >
    {children}
  </div>
);

// Left: what the presenter sees (the slide with the overlay on top). Right: the real
// GDI screen capture of the same region at the same moment, which records only the slide.
const ExclusionInner = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <>
      <Caption name="Caption">Hidden from compatible screen capture</Caption>
      <Audio
        name="Capture"
        src={staticFile('sfx/shutter-modern.wav')}
        from={Math.round(0.5 * fps)}
        volume={0.35}
      />
      <PanelTitle left={LEFT}>
        <span style={{ width: 14, height: 14, borderRadius: 7, background: '#6ccb5f' }} />
        On your screen
      </PanelTitle>
      <Panel left={LEFT}>
        <Img
          name="Slide"
          src={staticFile('capture/exclusion-last.png')}
          style={{ width: '100%', height: '100%' }}
        />
        <Img
          name="Overlay"
          src={staticFile('capture/exclusion-overlay.png')}
          style={{
            position: 'absolute',
            left: exclusion.pad * S,
            top: exclusion.pad * S,
            width: exclusion.rect.width * S,
            borderRadius: 8,
            boxShadow: '0 18px 40px rgba(0,0,0,0.5)',
          }}
        />
      </Panel>
      <Interactive.Div
        name="Capture panel"
        style={{
          opacity: interpolate(frame, [0.4 * fps, 0.8 * fps], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          translate: interpolate(frame, [0.4 * fps, 1 * fps], ['30px 0px', '0px 0px'], {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <PanelTitle left={RIGHT}>
          <span style={{ width: 14, height: 14, borderRadius: 7, background: '#ff5f57' }} />
          In a screen capture
        </PanelTitle>
        <Panel left={RIGHT}>
          <Img
            name="Captured frame"
            src={staticFile('capture/exclusion-last.png')}
            style={{ width: '100%', height: '100%' }}
          />
          <Video
            name="Screen capture"
            src={staticFile('capture/exclusion-gdigrab.mp4')}
            muted
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        </Panel>
      </Interactive.Div>
      <Interactive.Div
        name="Footnote"
        style={{
          position: 'absolute',
          left: 120,
          right: 120,
          top: TOP + H + 44,
          textAlign: 'center',
          fontFamily: '"Segoe UI Variable Text", "Segoe UI", sans-serif',
          fontSize: 30,
          lineHeight: 1.45,
          color: '#a8a8a8',
          opacity: interpolate(frame, [1 * fps, 1.5 * fps], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        Recorded with Windows screen capture (GDI) on Windows 11 while the overlay was on top.
        <br />
        Capture exclusion is best effort and depends on the capture method.
      </Interactive.Div>
    </>
  );
};

export const Exclusion = Interactive.create({
  Component: ExclusionInner,
  layout: 'absolute-fill',
  schema: {},
});
