import test from 'node:test';
import assert from 'node:assert/strict';
import { planChecks, reusableGate, validatedSource, checkNames } from './ci-plan.mjs';

const selected = (paths) => checkNames.filter((name) => planChecks(paths)[name]);
test('docs, UI, collaboration, native and tooling changes select their dependencies', () => {
  assert.deepEqual(selected(['docs/testing.md', 'README.md']), ['formatting']);
  assert.deepEqual(selected(['apps/desktop/src/App.tsx', 'packages/ui/src/styles.css']), [
    'formatting',
    'javascript',
    'integration',
  ]);
  assert.deepEqual(selected(['packages/collaboration/src/automatic.ts']), [
    'formatting',
    'javascript',
    'integration',
    'networking',
  ]);
  assert.deepEqual(selected(['packages/protocol/fixtures/signaling-v2.json']), [
    'formatting',
    'javascript',
    'integration',
    'networking',
  ]);
  assert.deepEqual(selected(['apps/desktop/src-tauri/src/overlay.rs']), [
    'formatting',
    'javascript',
    'rust',
    'desktop',
    'integration',
  ]);
  assert.ok(planChecks(['apps/desktop/src-tauri/src/network.rs']).networking);
  assert.ok(planChecks(['apps/desktop/src-tauri/src/updates.rs']).release);
  for (const path of [
    'pnpm-lock.yaml',
    'Cargo.lock',
    '.github/workflows/ci.yml',
    'scripts/ci-plan.mjs',
    'apps/desktop/package.json',
    'unknown/file',
  ]) {
    assert.deepEqual(selected([path]), checkNames, path);
  }
  assert.deepEqual(selected(['docs/a.md', 'packages/protocol/src/peer.ts']), [
    'formatting',
    'javascript',
    'integration',
    'networking',
  ]);
  assert.equal(planChecks(['packages/protocol/src/peer.ts']).extended, false);
  assert.equal(planChecks([], true).extended, true);
  assert.ok(checkNames.every((name) => planChecks([], true)[name]));
});

test('metadata reuse requires the identical merge commit and repository CI workflow', () => {
  const check = {
    name: 'CI gate',
    conclusion: 'success',
    head_sha: 'abc',
    app: { slug: 'github-actions' },
  };
  const run = {
    id: 1,
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
    repository: { full_name: 'owner/repo' },
  };
  assert.equal(reusableGate(check, run, 'abc', 'owner/repo', 2), true);
  for (const field of ['name', 'conclusion', 'head_sha', 'app'])
    assert.equal(
      reusableGate({ ...check, [field]: undefined }, run, 'abc', 'owner/repo', 2),
      false,
    );
  for (const field of ['path', 'event', 'repository'])
    assert.equal(
      reusableGate(check, { ...run, [field]: undefined }, 'abc', 'owner/repo', 2),
      false,
    );
  assert.equal(reusableGate(check, run, 'new-sha', 'owner/repo', 2), false);
  assert.equal(reusableGate(check, run, 'abc', 'other/repo', 2), false);
  assert.equal(reusableGate(check, run, 'abc', 'owner/repo', 1), false);
});

test('metadata reuse verifies the tested merge SHA from the successful gate log', () => {
  const sha = 'a'.repeat(40);
  assert.equal(validatedSource('2026-10-10T12:00:00Z CI_SOURCE_SHA=' + sha + '\n', sha), true);
  assert.equal(validatedSource('CI_SOURCE_SHA=' + 'b'.repeat(40) + '\n', sha), false);
  assert.equal(validatedSource('old gate without source evidence', sha), false);
  assert.equal(validatedSource('CI_SOURCE_SHA=' + sha + 'extra\n', sha), false);
});
