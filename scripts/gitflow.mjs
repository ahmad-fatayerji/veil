import { execFileSync } from 'node:child_process';
import { format } from 'prettier';
import semver from 'semver';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  assertBranchPolicy,
  nextBeta,
  proposeVersion,
  releaseNotes,
  stableVersion,
} from './release-lib.mjs';
import { readJson, setVersion, verifyVersions, writeJson } from './release-files.mjs';

const repo = process.env.GITHUB_REPOSITORY ?? 'ahmad-fatayerji/Veil-source';
const publicRepo = 'ahmad-fatayerji/veil';
const run = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);
const api = (path, ...args) => JSON.parse(gh('api', path, ...args));
function branchName(name) {
  if (
    !/^(develop|(?:release|hotfix)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*)$/.test(name) ||
    name.includes('..')
  )
    throw new Error('Unsupported source branch.');
  git('check-ref-format', '--branch', name);
  return name;
}
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(`${name}: ${value}`);
}
function commit(message) {
  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git(
    'add',
    '.release',
    'package.json',
    'apps/desktop/package.json',
    'apps/desktop/src-tauri/tauri.conf.json',
    'apps/desktop/src-tauri/Cargo.toml',
    'Cargo.lock',
    'docs/releases',
  );
  git('commit', '-m', message);
}
function messagesSince(ref) {
  git('merge-base', '--is-ancestor', ref, 'HEAD');
  return git('log', '--no-merges', '--format=%B%x00', `${ref}..HEAD`)
    .split('\0')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((message) => !/^chore\(release\):/.test(message));
}
function pullFor(branch) {
  return api(`repos/${repo}/pulls?state=open&base=main&head=${repo.split('/')[0]}:${branch}`).find(
    (pull) => pull.head.ref === branch,
  );
}
async function refreshNotes(candidate, version) {
  const messages = messagesSince(candidate.baseRef);
  mkdirSync('docs/releases', { recursive: true });
  writeFileSync(
    `docs/releases/${version}.md`,
    await format(releaseNotes(version, messages), { parser: 'markdown' }),
  );
  writeJson('.release/candidate.json', candidate);
}
function releaseExists(version) {
  // A source tag reserves a version even if its public upload failed before
  // publication. A fresh beta request must then allocate another number.
  try {
    git('rev-parse', '--verify', `refs/tags/v${version}`);
    return true;
  } catch {
    /* not reserved in source */
  }
  // Read public metadata without granting the source GITHUB_TOKEN access to distribution.
  const releases = api(`repos/${publicRepo}/releases?per_page=100`, '--paginate', '--slurp').flat();
  return releases.some((release) => release.tag_name === `v${version}`);
}

async function main() {
  const [command, requested = 'develop'] = process.argv.slice(2);
  if (command === 'verify') {
    console.log(`App version: ${verifyVersions()}`);
    return;
  }
  if (command === 'policy') {
    if (!process.env.GITHUB_EVENT_PATH) throw new Error('Missing event payload.');
    const event = readJson(process.env.GITHUB_EVENT_PATH);
    // Explicitly dispatched runs must validate the open PR too; they cannot bypass
    // destination/version checks simply because their payload has no pull_request.
    if (!event.pull_request && process.env.VALIDATE_REF && process.env.GH_TOKEN) {
      event.pull_request = api(`repos/${repo}/commits/${process.env.VALIDATE_REF}/pulls`).find(
        (pull) => pull.state === 'open' && pull.head.sha === process.env.VALIDATE_REF,
      );
    }
    if (event.pull_request) {
      const pull = event.pull_request;
      if (pull.head.repo.full_name !== repo)
        throw new Error('Use a branch in the source repository.');
      const version = verifyVersions();
      assertBranchPolicy({ base: pull.base.ref, head: pull.head.ref, title: pull.title, version });
      if (pull.base.ref === 'main') {
        const candidate = readJson('.release/candidate.json');
        const baseline = readJson('.release/baseline.json');
        if (
          candidate.targetVersion !== version ||
          baseline.version !== version ||
          baseline.sourceRef !== `refs/tags/v${version}`
        )
          throw new Error('Finalize release metadata before merging.');
        if (!existsSync(`docs/releases/${version}.md`))
          throw new Error('Missing reviewed release notes.');
      }
    }
    return;
  }
  if (command === 'merge-pr') {
    if (!/^\d+$/.test(requested)) throw new Error('Expected a PR number.');
    const pull = api(`repos/${repo}/pulls/${requested}`);
    if (pull.state !== 'open' || pull.draft || pull.head.repo.full_name !== repo)
      throw new Error('Use an open, ready PR in the source repository.');
    git('fetch', 'origin', pull.head.ref);
    const version = JSON.parse(
      git('show', `${pull.head.sha}:apps/desktop/src-tauri/tauri.conf.json`),
    ).version;
    const method = pull.head.ref.startsWith('feature/') ? 'squash' : 'merge';
    assertBranchPolicy({
      base: pull.base.ref,
      head: pull.head.ref,
      title: pull.title,
      version,
      mergeMethod: method,
    });
    gh(
      'pr',
      'merge',
      requested,
      '--repo',
      repo,
      `--${method}`,
      '--match-head-commit',
      pull.head.sha,
      ...(method === 'squash' ? ['--subject', pull.title] : []),
    );
    const merged = api(`repos/${repo}/pulls/${requested}`);
    if (!merged.merged) throw new Error('PR was not merged.');
    if (pull.base.ref === 'main')
      gh(
        'workflow',
        'run',
        'release.yml',
        '--repo',
        repo,
        '--ref',
        'main',
        '-f',
        `ref=${merged.merge_commit_sha}`,
      );
    else
      gh(
        'workflow',
        'run',
        'ci.yml',
        '--repo',
        repo,
        '--ref',
        pull.base.ref,
        '-f',
        `ref=${merged.merge_commit_sha}`,
      );
    return;
  }
  if (command === 'backmerge') {
    git('fetch', 'origin', 'main', 'develop');
    if (git('rev-list', '--count', 'origin/develop..origin/main') === '0') return;
    const version = JSON.parse(
      git('show', 'origin/main:apps/desktop/src-tauri/tauri.conf.json'),
    ).version;
    const branch = `backmerge/${version}`;
    const existing = api(
      `repos/${repo}/pulls?state=open&base=develop&head=${repo.split('/')[0]}:${branch}`,
    );
    if (!existing.length) {
      // A develop-based branch satisfies strict checks without bringing
      // unreleased develop features into main.
      git('switch', '-C', branch, 'origin/develop');
      git('config', 'user.name', 'github-actions[bot]');
      git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
      git('merge', '--no-ff', '--no-edit', 'origin/main');
      git('push', 'origin', `HEAD:refs/heads/${branch}`);
      gh(
        'pr',
        'create',
        '--repo',
        repo,
        '--head',
        branch,
        '--base',
        'develop',
        '--title',
        'chore: merge released main into develop',
        '--body',
        'Merge with a merge commit to bring release fixes and version metadata back into develop.',
      );
    }
    gh(
      'workflow',
      'run',
      'ci.yml',
      '--repo',
      repo,
      '--ref',
      branch,
      '-f',
      `ref=${existing[0]?.head.sha ?? git('rev-parse', 'HEAD')}`,
    );
    return;
  }
  const source = branchName(requested);
  git(
    'fetch',
    '--tags',
    'origin',
    `+refs/heads/${source}:refs/remotes/origin/${source}`,
    '+refs/heads/main:refs/remotes/origin/main',
  );
  git('switch', '-C', source, `origin/${source}`);
  if (command === 'prepare') {
    if (source !== 'develop' && !source.startsWith('hotfix/'))
      throw new Error('Prepare from develop or an existing hotfix branch.');
    // Back-merge the last release/hotfix first, so proposals never use a stale baseline.
    git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
    const baseline = readJson('.release/baseline.json');
    const version = proposeVersion(
      baseline.version,
      messagesSince(baseline.sourceRef),
      source.startsWith('hotfix/'),
    );
    const branch = source === 'develop' ? `release/${version}` : source;
    const existingPull = pullFor(branch);
    if (existingPull) {
      if (!existingPull.draft)
        throw new Error('This candidate is already ready for release review.');
      output('branch', branch);
      output('sha', existingPull.head.sha);
      return;
    }
    const openPulls = api(
      `repos/${repo}/pulls?state=open&base=main&per_page=100`,
      '--paginate',
      '--slurp',
    ).flat();
    if (source === 'develop' && openPulls.some((item) => item.head.ref.startsWith('release/')))
      throw new Error('Finish or explicitly retire the existing release branch first.');
    if (releaseExists(version)) throw new Error('The proposed version already exists publicly.');
    const remoteBranches = api(
      `repos/${repo}/branches?per_page=100`,
      '--paginate',
      '--slurp',
    ).flat();
    const resume = source === 'develop' && remoteBranches.some((item) => item.name === branch);
    if (resume) {
      git('fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
      git('switch', '-C', branch, `origin/${branch}`);
      const saved = readJson('.release/candidate.json');
      if (
        saved.targetVersion !== version ||
        saved.baseRef !== baseline.sourceRef ||
        saved.branch !== branch
      )
        throw new Error('Existing branch belongs to another candidate; retire it explicitly.');
    } else if (source === 'develop') git('switch', '-c', branch);
    const candidate = {
      targetVersion: version,
      baseRef: baseline.sourceRef,
      baseVersion: baseline.version,
      branch,
    };
    if (
      !resume &&
      !(
        source.startsWith('hotfix/') &&
        existsSync('.release/candidate.json') &&
        readJson('.release/candidate.json').branch === branch
      )
    ) {
      setVersion(`${version}-beta.1`);
      await refreshNotes(candidate, `${version}-beta.1`);
      commit(`chore(release): prepare ${version}`);
      git('push', 'origin', `HEAD:refs/heads/${branch}`);
    }
    gh(
      'pr',
      'create',
      '--repo',
      repo,
      '--head',
      branch,
      '--base',
      'main',
      '--draft',
      '--title',
      `chore(release): ${version}`,
      '--body',
      'Review the proposed version and public release notes. Use Publish beta for testers, then Finalize release. Merge with a merge commit to approve stable publication.',
    );
    output('branch', branch);
    output('sha', git('rev-parse', 'HEAD'));
    return;
  }
  if (!/^(release|hotfix)\//.test(source)) throw new Error('Use a release or hotfix branch.');
  const candidate = readJson('.release/candidate.json');
  if (candidate.branch !== source) throw new Error('Candidate branch mismatch.');
  const pull = pullFor(source);
  if (!pull) throw new Error('Beta/finalization requires an open release PR.');
  const current = verifyVersions();
  if (stableVersion(current) !== candidate.targetVersion)
    throw new Error('Version and proposal differ. Update both before publishing.');
  if (!pull.draft) {
    const baseline = readJson('.release/baseline.json');
    if (
      command !== 'finalize' ||
      current !== candidate.targetVersion ||
      baseline.sourceRef !== `refs/tags/v${current}`
    )
      throw new Error('Beta publication requires a draft PR; this candidate is already finalized.');
    output('branch', source);
    output('sha', git('rev-parse', 'HEAD'));
    return;
  }
  if (command === 'beta') {
    const version = nextBeta(current, releaseExists(current));
    setVersion(version);
    await refreshNotes(candidate, version);
    if (git('status', '--porcelain')) commit(`chore(release): ${version}`);
    git('push', 'origin', `HEAD:refs/heads/${source}`);
    output('version', version);
  } else if (command === 'finalize') {
    git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
    const mainBaseline = JSON.parse(git('show', 'origin/main:.release/baseline.json'));
    if (!semver.gt(candidate.targetVersion, mainBaseline.version))
      throw new Error(
        'Candidate must be newer than main. Prepare a new candidate after back-merging.',
      );
    candidate.baseRef = mainBaseline.sourceRef;
    candidate.baseVersion = mainBaseline.version;
    if (releaseExists(candidate.targetVersion))
      throw new Error('This stable version already exists.');
    setVersion(candidate.targetVersion);
    await refreshNotes(candidate, candidate.targetVersion);
    writeJson('.release/baseline.json', {
      version: candidate.targetVersion,
      sourceRef: `refs/tags/v${candidate.targetVersion}`,
    });
    if (git('status', '--porcelain')) commit(`chore(release): finalize ${candidate.targetVersion}`);
    git('push', 'origin', `HEAD:refs/heads/${source}`);
    gh('pr', 'ready', String(pull.number), '--repo', repo);
  } else throw new Error('Unknown coordinator action.');
  output('branch', source);
  output('sha', git('rev-parse', 'HEAD'));
}
await main();
