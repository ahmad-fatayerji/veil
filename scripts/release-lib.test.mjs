import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertBranchPolicy,
  assertGate,
  assertPublication,
  feedOnlyDrift,
  nextBeta,
  proposeVersion,
  releaseNotes,
  requestedVersion,
  shouldAdvanceFeed,
} from './release-lib.mjs';

test('version proposals handle features, breaking bodies and pre-1.0 policy', () => {
  assert.equal(proposeVersion('0.1.2', ['fix: reconnect']), '0.1.3');
  assert.equal(proposeVersion('0.1.2', ['feat: invite']), '0.2.0');
  assert.equal(proposeVersion('0.1.2', ['feat!: replace invitations']), '0.2.0');
  assert.equal(
    proposeVersion('1.1.2', ['fix: change protocol\n\nBREAKING CHANGE: old peers cannot connect']),
    '2.0.0',
  );
  assert.equal(proposeVersion('1.1.2', ['ci: improve merge checks']), '1.1.3');
  assert.throws(() => proposeVersion('0.1.2', []));
  assert.throws(() => proposeVersion('0.1.2', ['feat: invite'], true));
});
test('notes group changes without leaking commit bodies', () => {
  const notes = releaseNotes('0.2.0', ['feat: invite\n\nprivate discussion', 'fix: reconnect']);
  assert.match(notes, /## Features/);
  assert.match(notes, /## Fixes/);
  assert.doesNotMatch(notes, /private discussion/);
});
test('beta allocation and feeds never move backwards', () => {
  assert.equal(nextBeta('0.2.0-beta.1', false), '0.2.0-beta.1');
  assert.equal(nextBeta('0.2.0-beta.1', true), '0.2.0-beta.2');
  assert.equal(shouldAdvanceFeed('0.2.0-beta.2', '0.2.0'), true);
  assert.equal(shouldAdvanceFeed('0.3.0-beta.1', '0.2.0'), false);
  assert.equal(shouldAdvanceFeed('0.2.0', '0.2.0'), false);
  assert.throws(() => nextBeta('0.2.0', false));
});
test('Gitflow routes, merge methods and finalization are enforced', () => {
  const feature = {
    head: 'feature/invite',
    base: 'develop',
    title: 'feat: invite',
    mergeMethod: 'squash',
    version: '0.1.2',
  };
  assert.equal(assertBranchPolicy(feature), true);
  assert.throws(() => assertBranchPolicy({ ...feature, base: 'main' }));
  assert.throws(() => assertBranchPolicy({ ...feature, title: 'Add invite' }));
  assert.throws(() => assertBranchPolicy({ ...feature, mergeMethod: 'merge' }));
  assert.equal(assertBranchPolicy({ head: 'main', base: 'develop', mergeMethod: 'merge' }), true);
  assert.equal(
    assertBranchPolicy({ head: 'backmerge/0.2.0', base: 'develop', mergeMethod: 'merge' }),
    true,
  );
  assert.throws(() =>
    assertBranchPolicy({ head: 'backmerge/0.2.0', base: 'main', mergeMethod: 'merge' }),
  );
  assert.throws(() =>
    assertBranchPolicy({ head: 'release/0.2.0', base: 'main', version: '0.2.0-beta.1' }),
  );
  assert.equal(
    assertBranchPolicy({
      head: 'hotfix/reconnect',
      base: 'main',
      version: '0.1.3',
      mergeMethod: 'merge',
    }),
    true,
  );
});
test('aggregate gate rejects failed, cancelled, skipped and empty checks', () => {
  assertGate(['success', 'success']);
  for (const result of ['failure', 'cancelled', 'skipped'])
    assert.throws(() => assertGate(['success', result]));
  assert.throws(() => assertGate([]));
});
test('publication rejects arbitrary branches and mismatched provenance', () => {
  const input = {
    version: '0.2.0',
    sha: 'a'.repeat(40),
    branch: 'main',
    candidate: { targetVersion: '0.2.0' },
    baseline: { version: '0.2.0', sourceRef: 'refs/tags/v0.2.0' },
  };
  assertPublication(input);
  assert.throws(() => assertPublication({ ...input, branch: 'feature/test' }));
  assert.throws(() => assertPublication({ ...input, sha: 'bad' }));
  assert.throws(() => assertPublication({ ...input, candidate: null }));
  assertPublication({
    ...input,
    version: '0.2.0-beta.1',
    branch: 'release/0.2.0',
    candidate: { ...input.candidate, branch: 'release/0.2.0' },
  });
});

test('an explicit release version must be stable, newer and fit the release type', () => {
  assert.equal(requestedVersion('1.0.0', '0.7.2'), '1.0.0');
  assert.equal(requestedVersion('0.7.3', '0.7.2', true), '0.7.3');
  assert.throws(() => requestedVersion('1.0.0-beta.1', '0.7.2'), /stable version/);
  assert.throws(() => requestedVersion('v1.0.0', '0.7.2'), /stable version/);
  assert.throws(() => requestedVersion('0.7.2', '0.7.2'), /newer/);
  assert.throws(() => requestedVersion('0.8.0', '0.7.2', true), /next patch/);
});

test('only update-feed commits on main may skip the pre-release back-merge', () => {
  assert.equal(feedOnlyDrift(['updates/beta.json']), true);
  assert.equal(feedOnlyDrift(['updates/beta.json', 'updates/stable.json', '']), true);
  assert.equal(feedOnlyDrift(['updates/beta.json', '.release/baseline.json']), false);
  assert.equal(feedOnlyDrift(['']), false);
});
