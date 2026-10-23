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
import { appFrame, color, font } from '../theme';
import { AppClip } from '../ui/AppClip';
import { Caption } from '../ui/Caption';

const framed = { left: appFrame.x, top: appFrame.y };

// Alex starts a document from the home screen and writes it (Markdown shortcuts).
const WriteInner = () => {
  return (
    <>
      <Caption name="Caption">Start a note. Write with Markdown shortcuts.</Caption>
      <AppClip
        src={staticFile('capture/write.mp4')}
        data={clips.write}
        scale={appFrame.scale}
        trimStart={0.3}
        rate={2.88}
        style={framed}
      />
    </>
  );
};
export const Write = Interactive.create({
  Component: WriteInner,
  layout: 'absolute-fill',
  schema: {},
});

// Alex opens Share and copies the reusable invite link.
const ShareInner = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Caption name="Caption">Invite people with one link</Caption>
      <Audio
        name="Link copied"
        src={staticFile('sfx/ding.wav')}
        from={Math.round(1.6 * fps)}
        volume={0.22}
      />
      <AppClip
        src={staticFile('capture/share.mp4')}
        data={clips.share}
        scale={appFrame.scale}
        trimStart={0.3}
        rate={1.2}
        style={framed}
      />
    </>
  );
};
export const Share = Interactive.create({
  Component: ShareInner,
  layout: 'absolute-fill',
  schema: {},
});

const Label: React.FC<{ readonly children: React.ReactNode; readonly left: number }> = ({
  children,
  left,
}) => (
  <div
    style={{
      position: 'absolute',
      left,
      top: 838,
      width: 870,
      textAlign: 'center',
      fontFamily: font.ui,
      fontSize: 34,
      color: color.fgMuted,
    }}
  >
    {children}
  </div>
);

// The same live session from Alex (dark) and Sam (light), recorded at the same time.
const CollabInner = () => (
  <>
    <Caption name="Caption">Write together, live.</Caption>
    <AppClip
      src={staticFile('capture/collab-host.mp4')}
      data={clips.collabHost}
      scale={0.68}
      rate={1.95}
      style={{ left: 70, top: 270 }}
    />
    <AppClip
      src={staticFile('capture/collab-guest.mp4')}
      data={clips.collabGuest}
      scale={0.68}
      rate={1.95}
      cursor={false}
      style={{ left: 980, top: 270 }}
    />
    <Label left={70}>Alex, hosting</Label>
    <Label left={980}>Sam, joined from the link</Label>
  </>
);
export const Collab = Interactive.create({
  Component: CollabInner,
  layout: 'absolute-fill',
  schema: {},
});

// Alex clicks Show overlay; the camera leans in on the title bar button.
const OverlayShowInner = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <>
      <Caption name="Caption">Then bring your notes on top</Caption>
      <Interactive.Div
        name="Zoom"
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '1363px 255px',
          scale: interpolate(frame, [0, 0.9 * fps], [1, 1.45], {
            easing: Easing.bezier(0.45, 0, 0.2, 1),
            output: 'perceptual-scale',
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <AppClip
          src={staticFile('capture/overlay-show.mp4')}
          data={clips.overlayShow}
          scale={appFrame.scale}
          trimStart={0.4}
          style={framed}
        />
      </Interactive.Div>
    </>
  );
};
export const OverlayShow = Interactive.create({
  Component: OverlayShowInner,
  layout: 'absolute-fill',
  schema: {},
});

// The real Overlay settings: window opacity and font size sliders.
const OverlaySettingsInner = () => (
  <>
    <Caption name="Caption">Tune its opacity and text size</Caption>
    <AppClip
      src={staticFile('capture/overlay-settings.mp4')}
      data={clips.overlaySettings}
      scale={appFrame.scale}
      trimStart={0.3}
      rate={1.4}
      style={framed}
    />
  </>
);
export const OverlaySettings = Interactive.create({
  Component: OverlaySettingsInner,
  layout: 'absolute-fill',
  schema: {},
});
