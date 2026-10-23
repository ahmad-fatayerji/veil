// Re-encodes a capture run's clips from saved timings: node capture/reencode.mjs <run-dir>
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeTimed } from './lib.mjs';

const run = process.argv[2];
const output = resolve(import.meta.dirname, '../public/capture');
for (const name of await readdir(resolve(run, 'frames'))) {
  const out = resolve(run, 'frames', name);
  let timed, total;
  if (existsSync(resolve(out, 'timing.json'))) {
    ({ frames: timed, total } = JSON.parse(await readFile(resolve(out, 'timing.json'), 'utf8')));
  } else {
    // Older runs only kept the concat list: rebuild times from its durations.
    const lines = (await readFile(resolve(out, 'list.ffconcat'), 'utf8')).split('\n');
    timed = [];
    let at = 0;
    for (let index = 1; index < lines.length; index++) {
      const file = lines[index].match(/^file '(.*)'$/)?.[1];
      const duration = Number(lines[index + 1]?.match(/^duration (.*)$/)?.[1]);
      if (file && Number.isFinite(duration)) {
        timed.push({ file, at });
        at += duration;
      }
    }
    total = at;
  }
  await encodeTimed(out, timed, total, resolve(output, `${name}.mp4`));
  console.log(`${name}: ${total.toFixed(2)}s`);
}
