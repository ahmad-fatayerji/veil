import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import semver from 'semver';
import { proposeFeedUpdate, distributionRepository } from './update-feed.mjs';
import { assertPublication } from './release-lib.mjs';
import { readJson, verifyVersions } from './release-files.mjs';
import { findReleaseByTag } from './github-release.mjs';
import {
  assertPublishedIdentity,
  assertReleaseManifest,
  assertUploadedAssets,
} from './release-assets.mjs';

const repo = distributionRepository;
if (process.env.GITHUB_REPOSITORY !== repo || process.env.RELEASE_PUBLICATION_ENABLED !== 'true')
  throw new Error('Publication is disabled outside the enabled unified repository.');
const run = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);
const api = (path, ...args) => JSON.parse(gh('api', path, ...args));
function optionalApi(path) {
  try {
    return api(path);
  } catch (error) {
    if (String(error.stderr).includes('(HTTP 404)')) return null;
    throw error;
  }
}
const version = verifyVersions();
const sha = git('rev-parse', 'HEAD');
const tag = `v${version}`;
const branch = process.env.RELEASE_BRANCH;
const candidate = readJson('.release/candidate.json');
const baseline = readJson('.release/baseline.json');
assertPublication({ version, sha, branch, candidate, baseline });
git('fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`, '--tags');
git('merge-base', '--is-ancestor', sha, `origin/${branch}`);
let reservedSha;
try {
  reservedSha = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
} catch {
  /* not reserved */
}
if (reservedSha && reservedSha !== sha)
  throw new Error('This version is reserved for another source commit.');
if (!semver.prerelease(version)) {
  if (git('rev-list', '--parents', '-n', '1', sha).split(' ').length !== 3)
    throw new Error('Stable source must be a release merge commit.');
  const firstParentBaseline = JSON.parse(git('show', `${sha}^1:.release/baseline.json`));
  if (!semver.gt(version, firstParentBaseline.version))
    throw new Error('Stable merge did not introduce a new release.');
}
if (!existsSync(`docs/releases/${version}.md`)) throw new Error('Missing reviewed release notes.');
const findRelease = () =>
  findReleaseByTag(
    tag,
    () => optionalApi(`repos/${repo}/releases/tags/${tag}`),
    () => api(`repos/${repo}/releases?per_page=100`, '--paginate', '--slurp'),
  );
const existing = findRelease();
if (existing && !existing.draft) {
  const directory = mkdtempSync(join(tmpdir(), 'veil-published-'));
  gh(
    'release',
    'download',
    tag,
    '--repo',
    repo,
    '--pattern',
    'release-metadata.json',
    '--dir',
    directory,
  );
  const metadata = readJson(join(directory, 'release-metadata.json'));
  assertPublishedIdentity(metadata, version, sha);
}
if (process.argv[2] === 'preflight') {
  console.log(`Validated ${tag} from ${sha}.`);
} else if (process.argv[2] === 'publish') {
  const directory = 'target/release/share';
  const manifest = readJson(`${directory}/latest.json`);
  const metadata = readJson(`${directory}/release-metadata.json`);
  if (manifest.version !== version || metadata.sourceSha !== sha || metadata.version !== version)
    throw new Error('Asset provenance mismatch.');
  const expected = ['latest.json', 'release-metadata.json', 'SHA256SUMS.txt', 'TESTING.md'];
  const installers = readdirSync(directory).filter((name) => name.endsWith('-setup.exe'));
  if (installers.length !== 1) throw new Error('Expected one installer.');
  expected.push(installers[0], `${installers[0]}.sig`);
  for (const name of expected)
    if (!existsSync(`${directory}/${name}`)) throw new Error(`Missing ${name}.`);
  assertReleaseManifest(
    manifest,
    metadata,
    version,
    sha,
    installers[0],
    readFileSync(`${directory}/${installers[0]}`),
    readFileSync(`${directory}/${installers[0]}.sig`, 'utf8'),
  );
  const sourceTag = `refs/tags/${tag}`;
  let tagged;
  try {
    tagged = git('rev-parse', '--verify', `${sourceTag}^{commit}`);
  } catch {
    /* first publication */
  }
  if (tagged && tagged !== sha) throw new Error('Source tag already refers to another commit.');
  if (!tagged) {
    git('config', 'user.name', 'github-actions[bot]');
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    git('tag', '-a', tag, sha, '-m', `Veil ${version}`);
    git('push', 'origin', sourceTag);
  }
  if (!existing || existing.draft) {
    const notes = `docs/releases/${version}.md`;
    if (!existing)
      gh(
        'release',
        'create',
        tag,
        '--repo',
        repo,
        '--target',
        'main',
        '--draft',
        '--title',
        `Veil ${version}`,
        '--notes-file',
        notes,
        ...(semver.prerelease(version) ? ['--prerelease'] : []),
      );
    else
      gh(
        'release',
        'edit',
        tag,
        '--repo',
        repo,
        '--title',
        `Veil ${version}`,
        '--notes-file',
        notes,
      );
    const draft = findRelease();
    if (!draft?.draft) throw new Error('Asset upload requires an unpublished release draft.');
    // Replacing assets is allowed only while this version remains an unpublished draft.
    gh(
      'release',
      'upload',
      tag,
      '--repo',
      repo,
      '--clobber',
      ...expected.map((name) => `${directory}/${name}`),
    );
    const uploaded = api(`repos/${repo}/releases/${draft.id}`);
    if (!uploaded.draft)
      throw new Error('Release was published before draft verification finished.');
    assertUploadedAssets(expected, uploaded.assets, (name) => readFileSync(`${directory}/${name}`));
    // Download the uploaded assets and verify exact bytes before making the release discoverable.
    const downloaded = mkdtempSync(join(tmpdir(), 'veil-upload-'));
    gh('release', 'download', tag, '--repo', repo, '--dir', downloaded);
    assertUploadedAssets(
      expected,
      uploaded.assets,
      (name) => readFileSync(`${directory}/${name}`),
      (name) => readFileSync(join(downloaded, name)),
    );
    const latest = optionalApi(`repos/${repo}/releases/latest`);
    const makeLatest =
      !semver.prerelease(version) &&
      (!latest || semver.gt(version, latest.tag_name.replace(/^v/, '')));
    gh(
      'release',
      'edit',
      tag,
      '--repo',
      repo,
      '--draft=false',
      `--prerelease=${Boolean(semver.prerelease(version))}`,
      `--latest=${makeLatest}`,
    );
  }
  // Use the published manifest on retries, never a rebuilt package's fresh signature.
  const publishedDir = mkdtempSync(join(tmpdir(), 'veil-feed-'));
  gh('release', 'download', tag, '--repo', repo, '--pattern', 'latest.json', '--dir', publishedDir);
  const publishedManifest = readJson(join(publishedDir, 'latest.json'));
  proposeFeedUpdate(publishedManifest);
  console.log(`Published ${tag}; existing published packages were preserved.`);
} else throw new Error('Use preflight or publish.');
