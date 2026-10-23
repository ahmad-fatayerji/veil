// Composes the promo's original background track (no samples, no licensing): a calm
// 120 BPM piece whose sections line up with the video's cuts. Bars are 2 seconds:
//   bars 0-1   intro (pad, then arpeggio)       video: logo, home
//   bars 2-7   groove (bass, kick, melody, hats) video: write, share, collaborate
//   bars 8-11  full (overlay is the highlight)    video: overlay scenes
//   bar 12     impact                             video: capture test
//   bars 14-15 resolve and fade                   video: outro
// Output: public/music/veil-theme.wav (44.1 kHz, 16-bit stereo).
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const RATE = 44100;
const LENGTH = 31.5;
const BEAT = 0.5;
const BAR = BEAT * 4;
const N = Math.ceil(LENGTH * RATE);
const dry = [new Float32Array(N), new Float32Array(N)];
const send = [new Float32Array(N), new Float32Array(N)];
const duck = new Float32Array(N).fill(1);

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const n = (name) => {
  const [, letter, accidental, octave] = name.match(/^([A-G])(#|b)?(-?\d)$/);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter];
  return base + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + (Number(octave) + 1) * 12;
};

// Adds a mono voice with pan and reverb send. `fn(t)` returns a sample at note time t.
function add(start, duration, fn, { gain = 1, pan = 0, reverb = 0.2, ducked = false } = {}) {
  const from = Math.max(0, Math.floor(start * RATE));
  const to = Math.min(N, Math.floor((start + duration) * RATE));
  const left = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const right = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = from; i < to; i++) {
    // Flooring the start can put the first sample a hair before t = 0.
    let value = fn(Math.max(0, i / RATE - start));
    if (ducked) value *= duck[i];
    dry[0][i] += value * left;
    dry[1][i] += value * right;
    send[0][i] += value * left * reverb;
    send[1][i] += value * right * reverb;
  }
}

const TAU = Math.PI * 2;
const adsr = (t, duration, attack, release) =>
  Math.min(1, t / attack) * (t > duration - release ? Math.max(0, (duration - t) / release) : 1);

// Chords per bar: Fmaj7 | G6/9 | Am7 | Cmaj7/E, resolving to Fmaj7 | Cmaj9 at the end.
const progression = [
  ['F3', 'A3', 'C4', 'E4'],
  ['G3', 'B3', 'D4', 'E4'],
  ['A3', 'C4', 'E4', 'G4'],
  ['E3', 'G3', 'C4', 'B3'],
].map((chord) => chord.map(n));
const roots = ['F2', 'G2', 'A2', 'C2'].map(n);
const ending = { chord: ['C3', 'G3', 'B3', 'D4', 'E4'].map(n), root: n('C2') };
const chordAt = (bar) => (bar >= 15 ? ending.chord : progression[bar % 4]);
const rootAt = (bar) => (bar >= 15 ? ending.root : roots[bar % 4]);

// Sidechain-style ducking curve from kick hits, applied to pad and bass.
const kicks = [];
for (let bar = 2; bar < 14; bar++) {
  for (const beat of bar >= 8 && bar < 12 ? [0, 1, 2, 3] : [0, 2])
    kicks.push(bar * BAR + beat * BEAT);
}
for (const time of kicks) {
  const from = Math.floor(time * RATE);
  for (let i = from; i < Math.min(N, from + RATE * 0.4); i++) {
    duck[i] = Math.min(duck[i], 1 - 0.45 * Math.exp(-(i - from) / RATE / 0.11));
  }
}

// Pad: detuned band-limited saws through a gentle low-pass, ducked under the kick.
for (let bar = 0; bar < 16; bar++) {
  const length = bar === 15 ? 3.4 : BAR + 0.6;
  const level = bar < 2 ? 0.05 + bar * 0.02 : bar >= 8 && bar < 12 ? 0.1 : 0.085;
  for (const [index, midi] of chordAt(bar).entries()) {
    for (const detune of [-0.08, 0.08]) {
      const f = hz(midi + detune);
      let state = 0;
      add(
        bar * BAR,
        length,
        (t) => {
          let saw = 0;
          for (let h = 1; h <= 7; h++) saw += Math.sin(TAU * f * h * t + h) / h;
          state += 0.08 * (saw - state);
          return state * adsr(t, length, 0.45, 0.9);
        },
        { gain: level, pan: detune * 6 * (index % 2 ? 1 : -1), reverb: 0.35, ducked: true },
      );
    }
  }
}

// Plucked arpeggio in eighth notes from bar 1.
const arpPattern = [0, 1, 2, 3, 2, 1, 2, 3];
for (let bar = 1; bar < 15; bar++) {
  const chord = chordAt(bar);
  arpPattern.forEach((step, index) => {
    const midi = chord[step % chord.length] + 12;
    const f = hz(midi);
    const accent = index % 2 === 0 ? 1 : 0.7;
    add(
      bar * BAR + index * (BEAT / 2),
      0.6,
      (t) =>
        (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t)) *
        Math.exp(-t / 0.16) *
        Math.min(1, t / 0.004),
      { gain: (bar < 2 ? 0.05 : 0.075) * accent, pan: index % 2 ? 0.35 : -0.35, reverb: 0.4 },
    );
  });
}

// Bass from bar 2: root on beats 1 and 3, an octave pickup before the next bar.
for (let bar = 2; bar < 16; bar++) {
  const f = hz(rootAt(bar));
  const hits =
    bar === 15
      ? [[0, 3.2]]
      : [
          [0, 0.9],
          [1, 0.9],
          [1.5, 0.45],
        ];
  for (const [beat, length] of hits) {
    const freq = beat === 1.5 ? f * 2 : f;
    add(
      bar * BAR + beat * BEAT * 2,
      length,
      (t) =>
        (Math.sin(TAU * freq * t) + 0.25 * Math.sin(TAU * 2 * freq * t)) *
        adsr(t, length, 0.01, 0.12),
      { gain: 0.22, reverb: 0.02, ducked: true },
    );
  }
}

// Drums: soft kick, offbeat hats from bar 4, claps on 2 and 4 in the full section.
let seed = 7;
const noise = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed / 2147483647) * 2 - 1;
};
for (const time of kicks) {
  add(
    time,
    0.45,
    (t) => {
      const phase = TAU * (45 * t + 75 * 0.03 * (1 - Math.exp(-t / 0.03)));
      return Math.sin(phase) * Math.exp(-t / 0.16);
    },
    { gain: 0.5, reverb: 0 },
  );
}
for (let bar = 4; bar < 14; bar++) {
  for (let beat = 0; beat < 4; beat++) {
    let last = 0;
    add(
      bar * BAR + beat * BEAT + BEAT / 2,
      0.08,
      (t) => {
        const white = noise();
        const high = white - last;
        last = white;
        return high * Math.exp(-t / 0.025);
      },
      { gain: bar >= 8 && bar < 12 ? 0.07 : 0.05, pan: 0.25, reverb: 0.05 },
    );
    if (bar >= 8 && bar < 12 && (beat === 1 || beat === 3)) {
      add(
        bar * BAR + beat * BEAT,
        0.3,
        (t) => {
          const bursts = [0, 0.012, 0.024].reduce(
            (sum, at) => sum + (t >= at ? Math.exp(-(t - at) / (at === 0.024 ? 0.09 : 0.006)) : 0),
            0,
          );
          return noise() * bursts;
        },
        { gain: 0.09, pan: -0.1, reverb: 0.3 },
      );
    }
  }
}

// Bell melody: bars 4-7 state the phrase, bars 8-11 repeat it an octave up, then resolve.
const phrase = [
  [
    ['A5', 1],
    ['G5', 1],
    ['E5', 2],
  ],
  [
    ['D5', 1],
    ['E5', 1],
    ['G5', 2],
  ],
  [
    ['C6', 1],
    ['B5', 1],
    ['A5', 2],
  ],
  [
    ['G5', 2],
    ['E5', 2],
  ],
];
const bell = (f, length) => (t) =>
  (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t) + 0.12 * Math.sin(TAU * 3.01 * f * t)) *
  Math.exp(-t / 0.55) *
  Math.min(1, t / 0.006) *
  (t > length - 0.05 ? Math.max(0, (length + 0.5 - t) / 0.55) : 1);
for (let bar = 4; bar < 12; bar++) {
  let beat = 0;
  for (const [name, beats] of phrase[bar % 4]) {
    const midi = n(name) + (bar >= 8 ? 12 : 0);
    const length = beats * BEAT + 0.6;
    add(bar * BAR + beat * BEAT, length, bell(hz(midi), length), {
      gain: bar >= 8 ? 0.11 : 0.13,
      pan: 0.1,
      reverb: 0.45,
    });
    if (bar >= 8)
      add(bar * BAR + beat * BEAT, length, bell(hz(midi - 12), length), {
        gain: 0.07,
        pan: -0.15,
        reverb: 0.4,
      });
    beat += beats;
  }
}
// Final notes: E5 then a held G5 over the closing chord.
add(14 * BAR, 1.5, bell(hz(n('E5')), 1.5), { gain: 0.12, reverb: 0.5 });
add(14 * BAR + 1, 3, bell(hz(n('G5')), 3), { gain: 0.12, reverb: 0.5 });

// Riser into the capture test, then an impact on its first frame (24 s).
const impact = 12 * BAR;
add(
  impact - 1.6,
  1.6,
  (t) => noise() * (t / 1.6) ** 2.2 * (0.6 + 0.4 * Math.sin(TAU * (2 + 6 * t) * t)),
  {
    gain: 0.12,
    reverb: 0.3,
  },
);
add(impact, 1.8, (t) => Math.sin(TAU * (38 + 40 * Math.exp(-t / 0.08)) * t) * Math.exp(-t / 0.45), {
  gain: 0.45,
  reverb: 0.2,
});
add(impact, 1.2, (t) => noise() * Math.exp(-t / 0.25), { gain: 0.06, reverb: 0.6 });

// Schroeder reverb on the send bus, slightly different per channel.
function reverb(input, offset) {
  const output = new Float32Array(N);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const delay = Math.floor(((ms + offset) / 1000) * RATE);
    const buffer = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      buffer[i] = input[i] + (i >= delay ? buffer[i - delay] * 0.82 : 0);
      output[i] += buffer[i] * 0.25;
    }
  }
  for (const [ms, g] of [
    [5, 0.7],
    [1.7, 0.7],
  ]) {
    const delay = Math.floor((ms / 1000) * RATE);
    const copy = output.slice();
    for (let i = 0; i < N; i++) {
      const delayedIn = i >= delay ? copy[i - delay] : 0;
      const delayedOut = i >= delay ? output[i - delay] : 0;
      output[i] = -g * copy[i] + delayedIn + g * delayedOut;
    }
  }
  return output;
}
const wet = [reverb(send[0], 0), reverb(send[1], 2.3)];

// Mix, gentle saturation, master fade-in/out, normalise to -1 dBFS.
const mix = [new Float32Array(N), new Float32Array(N)];
let peak = 0;
for (let c = 0; c < 2; c++) {
  for (let i = 0; i < N; i++) {
    const t = i / RATE;
    const fade = Math.min(1, t / 0.3) * Math.min(1, Math.max(0, (LENGTH - t) / 2.2));
    mix[c][i] = Math.tanh((dry[c][i] + wet[c][i] * 0.9) * 1.1) * fade;
    peak = Math.max(peak, Math.abs(mix[c][i]));
  }
}
const scale = 0.89 / peak;
const pcm = Buffer.alloc(44 + N * 4);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + N * 4, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(RATE, 24);
pcm.writeUInt32LE(RATE * 4, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  for (let c = 0; c < 2; c++) {
    pcm.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, mix[c][i] * scale)) * 32767),
      44 + i * 4 + c * 2,
    );
  }
}
const output = resolve(import.meta.dirname, '../public/music');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'veil-theme.wav'), pcm);
console.log(`veil-theme.wav: ${LENGTH}s, peak scaled by ${scale.toFixed(2)}`);
