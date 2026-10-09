import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import semver from 'semver';

export const jsonVersions = [
  'package.json',
  'apps/desktop/package.json',
  'apps/desktop/src-tauri/tauri.conf.json',
];
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
export function setVersion(version, root = '.') {
  if (!semver.valid(version)) throw new Error('Invalid version.');
  for (const path of jsonVersions) {
    const file = resolve(root, path);
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, `$1${version}$2`),
    );
  }
  const cargoPath = resolve(root, 'apps/desktop/src-tauri/Cargo.toml');
  writeFileSync(
    cargoPath,
    readFileSync(cargoPath, 'utf8').replace(
      /(\[package\][\s\S]*?\nversion = ")[^"]+("\r?\n)/,
      `$1${version}$2`,
    ),
  );
  const lockPath = resolve(root, 'Cargo.lock');
  writeFileSync(
    lockPath,
    readFileSync(lockPath, 'utf8').replace(
      /(\[\[package\]\]\r?\nname = "veil-desktop"\r?\nversion = ")[^"]+("\r?\n)/,
      `$1${version}$2`,
    ),
  );
  verifyVersions(root);
}
export function verifyVersions(root = '.') {
  const version = readJson(resolve(root, jsonVersions[0])).version;
  if (!semver.valid(version)) throw new Error('Invalid app version.');
  for (const path of jsonVersions)
    if (readJson(resolve(root, path)).version !== version)
      throw new Error(`Version mismatch: ${path}`);
  for (const [path, pattern] of [
    ['apps/desktop/src-tauri/Cargo.toml', /\[package\][\s\S]*?\nversion = "([^"]+)"/],
    ['Cargo.lock', /\[\[package\]\]\r?\nname = "veil-desktop"\r?\nversion = "([^"]+)"/],
  ])
    if (readFileSync(resolve(root, path), 'utf8').match(pattern)?.[1] !== version)
      throw new Error(`Version mismatch: ${path}`);
  // pnpm workspace importers have no version field; their frozen lockfile is checked by CI.
  return version;
}
