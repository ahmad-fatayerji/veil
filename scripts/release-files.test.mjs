import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { jsonVersions, setVersion, verifyVersions } from './release-files.mjs';

test('one version update synchronizes every app manifest and Cargo lock without changing the host crate', () => {
  const root = mkdtempSync(join(tmpdir(), 'veil-version-'));
  for (const path of [...jsonVersions, 'apps/desktop/src-tauri/Cargo.toml', 'Cargo.lock']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(path, join(root, path));
  }
  const before = readFileSync(join(root, 'Cargo.lock'), 'utf8');
  const hostVersion = before.match(/name = "veil-host"\r?\nversion = "([^"]+)"/)[1];
  setVersion('0.2.0-beta.12', root);
  assert.equal(verifyVersions(root), '0.2.0-beta.12');
  assert.equal(
    readFileSync(join(root, 'Cargo.lock'), 'utf8').match(
      /name = "veil-host"\r?\nversion = "([^"]+)"/,
    )[1],
    hostVersion,
  );
  setVersion('0.2.0', root);
  assert.equal(verifyVersions(root), '0.2.0');
  const manifest = join(root, 'apps/desktop/package.json');
  writeFileSync(manifest, JSON.stringify({ version: '0.1.2' }));
  assert.throws(() => verifyVersions(root), /Version mismatch/);
});
