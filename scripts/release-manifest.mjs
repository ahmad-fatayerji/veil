import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const installer = resolve(process.argv[2]);
const config = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
const baseUrl = new URL(
  process.argv[3] ??
    `https://github.com/ahmad-fatayerji/veil/releases/download/v${config.version}/`,
);
if (baseUrl.protocol !== 'https:') throw new Error('Release URLs must use HTTPS.');
const notes = readFileSync(`docs/releases/${config.version}.md`, 'utf8');
const signature = readFileSync(`${installer}.sig`, 'utf8').trim();
const directory = resolve('target/release/share');
const { mkdirSync, copyFileSync } = await import('node:fs');
mkdirSync(directory, { recursive: true });
const name = basename(installer);
copyFileSync(installer, resolve(directory, name));
copyFileSync(`${installer}.sig`, resolve(directory, `${name}.sig`));
writeFileSync(
  resolve(directory, 'latest.json'),
  `${JSON.stringify({ version: config.version, notes, pub_date: new Date().toISOString(), platforms: { 'windows-x86_64': { signature, url: new URL(encodeURIComponent(name), baseUrl).href } } }, null, 2)}\n`,
);
writeFileSync(
  resolve(directory, 'SHA256SUMS.txt'),
  `${createHash('sha256').update(readFileSync(installer)).digest('hex')}  ${name}\n`,
);
copyFileSync('docs/tester-guide.md', resolve(directory, 'TESTING.md'));
console.log(`Release assets prepared: ${directory}`);
