import { CommitParser } from 'conventional-commits-parser';
import semver from 'semver';
export const isFeedBranch = (branch) =>
  /^automation\/update-feed-[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[0-9]+)?$/.test(branch);
export const isReleaseBranch = (branch) => /^(release|hotfix)\//.test(branch);

export const parser = new CommitParser();
export function proposeVersion(current, messages, hotfix = false) {
  if (!semver.valid(current) || semver.prerelease(current))
    throw new Error('Invalid release baseline.');
  if (!messages.length) throw new Error('No new changes to release.');
  const commits = messages.map((message) => parser.parse(message));
  const breaking = commits.some(
    (commit) => commit.notes.length > 0 || /^\w+(?:\([^)]*\))?!:/.test(commit.header),
  );
  const feature = commits.some((commit) => commit.type === 'feat');
  if (hotfix && (breaking || feature))
    throw new Error('Hotfixes must contain compatible fixes, not features or breaking changes.');
  const bump = breaking
    ? semver.major(current) === 0
      ? 'minor'
      : 'major'
    : feature
      ? 'minor'
      : 'patch';
  return semver.inc(current, bump);
}

export function releaseNotes(version, messages) {
  const groups = new Map();
  for (const message of messages) {
    const commit = parser.parse(message);
    const breaking = commit.notes.length > 0 || /^\w+(?:\([^)]*\))?!:/.test(commit.header);
    const group = breaking
      ? 'Breaking changes'
      : commit.type === 'feat'
        ? 'Features'
        : commit.type === 'fix'
          ? 'Fixes'
          : 'Other changes';
    const items = groups.get(group) ?? [];
    // Release notes are public: include commit subjects, never bodies or private repository links.
    items.push(`- ${commit.header.replace(/\r?\n/g, ' ')}`);
    groups.set(group, items);
  }
  return `# Veil ${version}\n\n${[...groups].map(([group, items]) => `## ${group}\n\n${items.join('\n')}`).join('\n\n')}\n`;
}

export function nextBeta(version, published) {
  const pre = semver.prerelease(version);
  if (!pre || pre[0] !== 'beta' || !Number.isInteger(pre[1]) || pre.length !== 2)
    throw new Error('Expected a numbered beta version.');
  return published ? `${stableVersion(version)}-beta.${pre[1] + 1}` : version;
}
export function stableVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed) throw new Error('Invalid version.');
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function assertBranchPolicy({ base, head, title, mergeMethod, version }) {
  const ordinary = head.startsWith('feature/');
  const candidate = /^(release|hotfix)\//.test(head);
  const backmerge = (head === 'main' || head.startsWith('backmerge/')) && base === 'develop';
  const allowed =
    (ordinary && (base === 'develop' || /^(release|hotfix)\//.test(base))) ||
    (candidate && base === 'main') ||
    backmerge ||
    (base === 'main' && (isFeedBranch(head) || head === 'migration/source-import'));
  if (!allowed) throw new Error(`Unsupported Gitflow route: ${head} -> ${base}.`);
  if (
    ordinary &&
    !/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^\r\n)]+\))?!?: .+/.test(
      title,
    )
  )
    throw new Error('Use a Conventional Commit PR title.');
  if (mergeMethod && mergeMethod !== (ordinary ? 'squash' : 'merge'))
    throw new Error('Features must squash; releases and back-merges must preserve merge history.');
  if (candidate && semver.prerelease(version))
    throw new Error('Finalize the candidate before merging into main.');
  return true;
}

export function assertGate(results) {
  if (!results.length || results.some((result) => result !== 'success'))
    throw new Error('Every required CI job must succeed.');
}
export function shouldAdvanceFeed(current, next) {
  if (!semver.valid(next)) throw new Error('Invalid feed version.');
  if (current && !semver.valid(current)) throw new Error('Invalid current feed version.');
  return !current || semver.gt(next, current);
}
export function assertPublication({ version, sha, branch, candidate, baseline }) {
  if (!semver.valid(version) || !/^[a-f0-9]{40}$/.test(sha))
    throw new Error('Invalid version or source SHA.');
  if (!candidate || candidate.targetVersion !== stableVersion(version))
    throw new Error('Missing or mismatched candidate metadata.');
  if (semver.prerelease(version)) {
    if (!/^(release|hotfix)\//.test(branch) || candidate.branch !== branch)
      throw new Error('Betas must come from a release or hotfix branch.');
  } else if (
    branch !== 'main' ||
    baseline.version !== version ||
    baseline.sourceRef !== `refs/tags/v${version}`
  ) {
    throw new Error('Stable publication requires a finalized main release.');
  }
}
