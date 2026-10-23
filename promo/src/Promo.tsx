import { Audio } from '@remotion/media';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AbsoluteFill, staticFile } from 'remotion';
import { Collab, OverlaySettings, OverlayShow, Share, Write } from './scenes/Clips';
import { Exclusion } from './scenes/Exclusion';
import { HomeThemes } from './scenes/HomeThemes';
import { Intro } from './scenes/Intro';
import { OverlayLive } from './scenes/OverlayLive';
import { Outro } from './scenes/Outro';

// Cuts land on the music's beat grid (120 BPM, 15 frames a beat): scenes start at
// 0, 60, 150, 270, 360, 480 (overlay, full section), 510, 630, 720 (impact), 840.
// Clip scenes are shorter than their trimmed, sped-up recordings.
// Sum 1010 frames minus eight 10-frame fades = 930 (31 s).
export const Promo = () => {
  const centred = {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
  } as const;

  return (
    <>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(1200px 700px at 50% 0%, #2a1a1c 0%, rgba(17,17,17,0) 70%), #111111',
        }}
      />
      <Audio name="Music" src={staticFile('music/veil-theme.wav')} volume={0.6} />
      <TransitionSeries>
        <TransitionSeries.Sequence name="Intro" durationInFrames={70}>
          <Intro name="Intro" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Home, light and dark" durationInFrames={90}>
          <HomeThemes name="Home, light and dark" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Sequence name="Write" durationInFrames={130}>
          <Write name="Write" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Share" durationInFrames={100}>
          <Share name="Share" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Collaborate" durationInFrames={130}>
          <Collab name="Collaborate" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Show overlay" durationInFrames={40}>
          <OverlayShow name="Show overlay" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Overlay, live" durationInFrames={130}>
          <OverlayLive name="Overlay, live" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Overlay settings" durationInFrames={100}>
          <OverlaySettings name="Overlay settings" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Capture exclusion" durationInFrames={130}>
          <Exclusion name="Capture exclusion" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Outro" durationInFrames={90}>
          <Outro name="Outro" style={centred} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </>
  );
};
