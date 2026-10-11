import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertReleaseManifest } from './release-assets.mjs';
import { shouldAdvanceFeed, isFeedBranch } from './release-lib.mjs';

export const distributionRepository = 'ahmad-fatayerji/veil';
export const feedPath = 'updates/beta.json';
export { isFeedBranch, isReleaseBranch } from './release-lib.mjs';

const run = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gh = (...args) => run('gh', args);
const api = (path, ...args) => JSON.parse(gh('api', path, ...args));

export function assertFeedUpdate({
  files,
  current,
  next,
  published,
  release,
  metadata,
  sourceSha,
  installer,
  signature,
}) {
  if (files.length !== 1 || files[0].filename !== feedPath || files[0].status !== 'modified')
    throw new Error('Feed PRs must modify only the existing beta feed.');
  if (!shouldAdvanceFeed(current.version, next.version))
    throw new Error('Feed must advance strictly.');
  if (
    release.draft ||
    release.tag_name !== `v${next.version}` ||
    !isDeepStrictEqual(next, published)
  )
    throw new Error('Feed must exactly match a published release manifest.');
  assertReleaseManifest(
    next,
    metadata,
    next.version,
    sourceSha,
    metadata.installer,
    installer,
    signature,
  );
}

export function verifyFeedPull(pull, repository) {
  if (
    repository !== distributionRepository ||
    pull.head.repo.full_name !== repository ||
    pull.base.ref !== 'main' ||
    !isFeedBranch(pull.head.ref)
  )
    throw new Error('Invalid feed PR repository or branch.');
  const files = api(
    `repos/${repository}/pulls/${pull.number}/files?per_page=100`,
    '--paginate',
    '--slurp',
  ).flat();
  run('git', ['fetch', 'origin', pull.base.sha, pull.head.sha, '--tags']);
  const readFeed = (ref) => JSON.parse(run('git', ['show', `${ref}:${feedPath}`]));
  const current = readFeed(pull.base.sha);
  const next = readFeed(pull.head.sha);
  if (pull.head.ref !== `automation/update-feed-${next.version}`)
    throw new Error('Feed branch/version mismatch.');
  const release = api(`repos/${repository}/releases/tags/v${next.version}`);
  if (release.draft) throw new Error('Cannot advertise draft assets.');
  const directory = mkdtempSync(join(tmpdir(), 'veil-feed-validation-'));
  gh('release', 'download', release.tag_name, '--repo', repository, '--dir', directory);
  const published = JSON.parse(readFileSync(join(directory, 'latest.json'), 'utf8'));
  const metadata = JSON.parse(readFileSync(join(directory, 'release-metadata.json'), 'utf8'));
  if (
    !/^Veil_[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[0-9]+)?_x64-setup\.exe$/.test(metadata.installer ?? '')
  )
    throw new Error('Invalid installer filename.');
  if (!/^[a-f0-9]{40}$/.test(metadata.sourceSha)) throw new Error('Invalid published source SHA.');
  const sourceSha = run('git', ['rev-parse', '--verify', `refs/tags/v${next.version}^{commit}`]);
  assertFeedUpdate({
    files,
    current,
    next,
    published,
    release,
    metadata,
    sourceSha,
    installer: readFileSync(join(directory, metadata.installer)),
    signature: readFileSync(join(directory, `${metadata.installer}.sig`), 'utf8'),
  });
}

export function proposeFeedUpdate(manifest, client = { api, gh }) {
  const { api, gh } = client;
  if (process.env.GITHUB_REPOSITORY !== distributionRepository)
    throw new Error('Feed proposals run only in the unified repository.');
  const repository = distributionRepository;
  const current = api(`repos/${repository}/contents/${feedPath}?ref=main`);
  const previous = JSON.parse(Buffer.from(current.content, 'base64').toString('utf8'));
  if (!shouldAdvanceFeed(previous.version, manifest.version)) return;
  const branch = `automation/update-feed-${manifest.version}`;
  if (!isFeedBranch(branch)) throw new Error('Unsupported feed version.');
  const existing = api(
    `repos/${repository}/pulls?state=open&base=main&head=${repository.split('/')[0]}:${branch}`,
  );
  const directory = mkdtempSync(join(tmpdir(), 'veil-feed-proposal-'));
  const request = join(directory, 'request.json');
  if (!existing.length) {
    const main = api(`repos/${repository}/git/ref/heads/main`).object.sha;
    // Never replace an existing ref: a retry may resume only the identical feed.
    let ref;
    try {
      ref = api(`repos/${repository}/git/ref/heads/${branch}`);
    } catch (error) {
      if (!String(error.stderr).includes('(HTTP 404)')) throw error;
    }
    if (!ref) {
      writeFileSync(request, JSON.stringify({ ref: `refs/heads/${branch}`, sha: main }));
      gh('api', `repos/${repository}/git/refs`, '--method', 'POST', '--input', request);
    }
    const saved = api(`repos/${repository}/contents/${feedPath}?ref=${branch}`);
    const savedManifest = JSON.parse(Buffer.from(saved.content, 'base64').toString('utf8'));
    if (!isDeepStrictEqual(savedManifest, manifest)) {
      if (!isDeepStrictEqual(savedManifest, previous))
        throw new Error('Existing feed branch has different content.');
      writeFileSync(
        request,
        JSON.stringify({
          message: `chore: advance beta feed to ${manifest.version}`,
          branch,
          sha: saved.sha,
          content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`).toString('base64'),
        }),
      );
      gh('api', `repos/${repository}/contents/${feedPath}`, '--method', 'PUT', '--input', request);
    }
    const body = join(directory, 'body.md');
    writeFileSync(
      body,
      `Advance the beta feed to verified published release v${manifest.version}. CI verifies the exact published manifest, installer checksum, signature file, and source tag. Merge with a merge commit; this does not publish an app release.\n`,
    );
    gh(
      'pr',
      'create',
      '--repo',
      repository,
      '--head',
      branch,
      '--base',
      'main',
      '--title',
      `chore: advance beta feed to ${manifest.version}`,
      '--body-file',
      body,
    );
  }
  const sha = api(`repos/${repository}/git/ref/heads/${branch}`).object.sha;
  gh('workflow', 'run', 'ci.yml', '--repo', repository, '--ref', branch, '-f', `ref=${sha}`);
  console.log(`Requested checked beta-feed PR for ${manifest.version}.`);
}
