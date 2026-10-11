import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertFeedUpdate, isFeedBranch, isReleaseBranch } from './update-feed.mjs';
import { assertBranchPolicy } from './release-lib.mjs';
import { proposeFeedUpdate } from './update-feed.mjs';
import { readFileSync } from 'node:fs';

const fixture = () => {
  const installer = Buffer.from('verified installer');
  const sourceSha = 'a'.repeat(40);
  const name = 'Veil_0.4.0-beta.1_x64-setup.exe';
  const next = {
    version: '0.4.0-beta.1',
    platforms: {
      'windows-x86_64': {
        signature: 'signature',
        url: `https://github.com/ahmad-fatayerji/veil/releases/download/v0.4.0-beta.1/${name}`,
      },
    },
  };
  return {
    files: [{ filename: 'updates/beta.json', status: 'modified' }],
    current: { version: '0.3.0' },
    next,
    published: structuredClone(next),
    release: { draft: false, tag_name: 'v0.4.0-beta.1' },
    metadata: {
      version: next.version,
      sourceSha,
      installer: name,
      sha256: createHash('sha256').update(installer).digest('hex'),
    },
    sourceSha,
    installer,
    signature: 'signature',
  };
};
test('feed validation binds the sole change to immutable published assets and source', () => {
  assertFeedUpdate(fixture());
  for (const change of [
    { files: [{ filename: '.github/workflows/ci.yml', status: 'modified' }] },
    { files: [{ filename: 'updates/beta.json', status: 'added' }] },
    { files: [...fixture().files, { filename: 'README.md', status: 'modified' }] },
    { current: { version: '0.4.0' } },
    { current: { version: '0.4.0-beta.1' } },
    { release: { draft: true, tag_name: 'v0.4.0-beta.1' } },
    { release: { draft: false, tag_name: 'v0.3.0' } },
    { installer: Buffer.from('tampered installer') },
    { sourceSha: 'b'.repeat(40) },
    { signature: 'different signature' },
    { published: { ...fixture().published, notes: 'different' } },
  ])
    assert.throws(() => assertFeedUpdate({ ...fixture(), ...change }));
  const bad = fixture();
  bad.next.platforms['windows-x86_64'].url = 'https://example.com/setup.exe';
  bad.published = structuredClone(bad.next);
  assert.throws(() => assertFeedUpdate(bad));
});
test('feed and migration routes preserve history without becoming app release routes', () => {
  for (const head of [
    'automation/update-feed-0.4.0-beta.1',
    'automation/update-feed-0.4.0',
    'migration/source-import',
  ]) {
    assertBranchPolicy({ head, base: 'main', mergeMethod: 'merge' });
    assert.equal(isReleaseBranch(head), false);
    assert.throws(() => assertBranchPolicy({ head, base: 'develop' }));
    assert.throws(() => assertBranchPolicy({ head, base: 'main', mergeMethod: 'squash' }));
  }
  for (const branch of [
    'automation/update-feed-anything',
    'automation/update-feed-0.4.0/extra',
    'migration/other',
  ]) {
    assert.equal(isFeedBranch(branch), false);
    assert.throws(() => assertBranchPolicy({ head: branch, base: 'main' }));
  }
});

test('publication recovery resumes an identical proposal and refuses conflicting content', () => {
  const previousRepository = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = 'ahmad-fatayerji/veil';
  try {
    const manifest = fixture().next;
    const branches = new Map();
    const calls = [];
    let pull = false;
    let failCreate = true;
    const encoded = (value) => ({
      sha: 'file-sha',
      content: Buffer.from(JSON.stringify(value)).toString('base64'),
    });
    const client = {
      api(route) {
        if (route.includes('/contents/')) {
          const branch = route.split('?ref=')[1];
          return encoded(branch === 'main' ? { version: '0.3.0' } : branches.get(branch));
        }
        if (route.includes('/pulls?')) return pull ? [{ number: 1 }] : [];
        if (route.endsWith('/git/ref/heads/main')) return { object: { sha: 'main-sha' } };
        if (route.includes('/git/ref/heads/')) {
          const branch = route.split('/git/ref/heads/')[1];
          if (!branches.has(branch))
            throw Object.assign(new Error('missing'), { stderr: '(HTTP 404)' });
          return { object: { sha: 'feed-sha' } };
        }
        throw new Error('Unexpected API route');
      },
      gh(...args) {
        calls.push(args);
        if (args[0] === 'api') {
          const body = JSON.parse(readFileSync(args.at(-1), 'utf8'));
          if (args[1].endsWith('/git/refs'))
            branches.set(body.ref.slice('refs/heads/'.length), { version: '0.3.0' });
          else
            branches.set(
              body.branch,
              JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')),
            );
        }
        if (args[0] === 'pr') {
          if (failCreate) {
            failCreate = false;
            throw new Error('PR creation interrupted');
          }
          pull = true;
        }
      },
    };
    assert.throws(() => proposeFeedUpdate(manifest, client), /interrupted/);
    const before = calls.filter((args) => args[0] === 'api').length;
    proposeFeedUpdate(manifest, client);
    assert.equal(
      calls.filter((args) => args[0] === 'api').length,
      before,
      'retry must not replace committed feed bytes',
    );
    proposeFeedUpdate(manifest, client);
    assert.equal(calls.filter((args) => args[0] === 'workflow').length, 2);
    pull = false;
    branches.set(`automation/update-feed-${manifest.version}`, {
      ...manifest,
      notes: 'unexpected change',
    });
    assert.throws(() => proposeFeedUpdate(manifest, client), /different content/);
    const count = calls.length;
    proposeFeedUpdate({ version: '0.2.0' }, client);
    assert.equal(calls.length, count, 'older publication retry must not mutate a newer feed');
    process.env.GITHUB_REPOSITORY = 'ahmad-fatayerji/Veil-source';
    assert.throws(() => proposeFeedUpdate(manifest, client), /unified repository/);
  } finally {
    if (previousRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previousRepository;
  }
});
