// Prepares assets the repository does not store: the app icon (copied from the UI
// package), the generated music bed, and third-party sound effects (downloaded).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pub = resolve(root, 'public');

await mkdir(resolve(pub, 'product'), { recursive: true });
await copyFile(
  resolve(root, '../packages/ui/src/assets/veil-icon.png'),
  resolve(pub, 'product/veil-icon.png'),
);

if (!existsSync(resolve(pub, 'music/veil-theme.wav'))) {
  execFileSync(process.execPath, [resolve(root, 'music/compose.mjs')], { stdio: 'inherit' });
}

// Sound effects from Remotion's public library (https://www.remotion.dev/docs/sfx).
const effects = ['mouse-click', 'whoosh', 'switch', 'ding', 'shutter-modern'];
await mkdir(resolve(pub, 'sfx'), { recursive: true });
for (const name of effects) {
  const target = resolve(pub, `sfx/${name}.wav`);
  if (existsSync(target)) continue;
  const response = await fetch(`https://remotion.media/${name}.wav`);
  if (!response.ok) throw new Error(`Could not download ${name}.wav: ${response.status}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  console.log(`Downloaded sfx/${name}.wav`);
}
