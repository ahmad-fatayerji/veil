import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingFeedRun } from './feed-merge-context.mjs';

test('explicit feed dispatch accepts only successful own-repository CI for the exact head', () => {
  const repository = 'ahmad-fatayerji/veil';
  const branch = 'automation/update-feed-0.4.0';
  const sha = 'a'.repeat(40);
  const run = {
    path: '.github/workflows/ci.yml',
    head_sha: sha,
    head_branch: branch,
    conclusion: 'success',
    head_repository: { full_name: repository },
  };
  const accepts = (value) => matchingFeedRun(value, repository, branch, sha);
  assert.equal(accepts(run), true);
  for (const changed of [
    { path: '.github/workflows/other.yml' },
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature/untrusted' },
    { conclusion: null },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { head_repository: { full_name: 'fork/veil' } },
    { head_repository: null },
  ])
    assert.equal(accepts({ ...run, ...changed }), false);
});
