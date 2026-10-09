import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertNativeBuild, nativeBuildArtifact } from './native-build-artifact.mjs';
import { jsonVersions, verifyVersions } from './release-files.mjs';

const bytes = Buffer.from('test executable');
const expected = {
  sourceSha: 'a'.repeat(40),
  version: '0.1.2',
  workflowRun: '123',
  workflowAttempt: '2',
};
const metadata = {
  ...expected,
  executable: 'veil-desktop.exe',
  platform: 'windows-x86_64',
  sha256: createHash('sha256').update(bytes).digest('hex'),
};

test('native provenance accepts exact source and same-run retry builds', () => {
  assertNativeBuild(metadata, expected, bytes);
  assertNativeBuild({ ...metadata, workflowAttempt: '1' }, expected, bytes);
});

test('native provenance rejects mismatched identity, platform, executable and content', () => {
  for (const field of [
    'sourceSha',
    'version',
    'workflowRun',
    'workflowAttempt',
    'platform',
    'executable',
    'sha256',
  ])
    assert.throws(() => assertNativeBuild({ ...metadata, [field]: 'wrong' }, expected, bytes));
  for (const workflowAttempt of ['0', '3', '1.5', undefined])
    assert.throws(() => assertNativeBuild({ ...metadata, workflowAttempt }, expected, bytes));
  assert.throws(() => assertNativeBuild(metadata, expected, Buffer.from('tampered')), /checksum/);
  assert.throws(() => assertNativeBuild(metadata, expected, Buffer.alloc(0)), /checksum/);
  assert.throws(() => assertNativeBuild(metadata, { ...expected, workflowRun: undefined }, bytes));
});

test('artifact transfer verifies files before restoring and refuses a missing executable', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'veil-native-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [...jsonVersions, 'apps/desktop/src-tauri/Cargo.toml', 'Cargo.lock']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(file, join(root, file));
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'fixture',
    ],
    { cwd: root },
  );
  const env = { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
  const binary = join(root, 'target/release/veil-desktop.exe');
  const artifact = join(root, 'target/native-build');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, bytes);
  nativeBuildArtifact('create', artifact, root, env);
  rmSync(binary);
  nativeBuildArtifact('restore', artifact, root, { ...env, GITHUB_RUN_ATTEMPT: '2' });
  assert.deepEqual(readFileSync(binary), bytes);
  const savedMetadata = JSON.parse(readFileSync(join(artifact, 'native-build.json'), 'utf8'));
  assert.equal(savedMetadata.version, verifyVersions(root));
  writeFileSync(join(artifact, 'veil-desktop.exe'), 'tampered');
  assert.throws(() => nativeBuildArtifact('restore', artifact, root, env), /checksum/);
  assert.deepEqual(readFileSync(binary), bytes);
  rmSync(join(artifact, 'veil-desktop.exe'));
  assert.throws(() => nativeBuildArtifact('restore', artifact, root, env), /ENOENT/);
  assert.throws(() => nativeBuildArtifact('unknown', artifact, root, env), /Usage/);
});
