import { execFileSync } from 'node:child_process';
import { format } from 'prettier';
import semver from 'semver';
import {
  isFeedBranch,
  isReleaseBranch,
  verifyFeedPull,
  distributionRepository,
} from './update-feed.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  assertBranchPolicy,
  feedOnlyDrift,
  nextBeta,
  proposeVersion,
  releaseNotes,
  requestedVersion,
  stableVersion,
} from './release-lib.mjs';
import { readJson, setVersion, verifyVersions, writeJson } from './release-files.mjs';

const repo = process.env.GITHUB_REPOSITORY ?? 'ahmad-fatayerji/veil';
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
  const distributionBase = existsSync('.release/migration.json')
    ? readJson('.release/migration.json').publicBase
    : null;
  return git(
    'log',
    '--no-merges',
    '--format=%B%x00',
    `${ref}..HEAD`,
    ...(distributionBase ? ['--not', distributionBase] : []),
  )
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
      if (pull.head.repo.full_name !== repo && !pull.head.ref.startsWith('feature/'))
        throw new Error('Management PRs require a branch in this repository.');
      const version = verifyVersions();
      assertBranchPolicy({ base: pull.base.ref, head: pull.head.ref, title: pull.title, version });
      if (isFeedBranch(pull.head.ref)) {
        verifyFeedPull(pull, repo);
        return;
      }
      if (pull.head.ref === 'migration/source-import') {
        if (repo !== distributionRepository)
          throw new Error('Migration is public-repository only.');
        git('fetch', 'origin', pull.base.sha, pull.head.sha, '--tags');
        let alreadyImported = false;
        try {
          git('cat-file', '-e', `${pull.base.sha}:apps/desktop/src-tauri/tauri.conf.json`);
          alreadyImported = true;
        } catch {
          /* initial distribution tree */
        }
        if (alreadyImported) throw new Error('Source import is a one-time route.');
        const migration = JSON.parse(git('show', `${pull.head.sha}:.release/migration.json`));
        if (
          migration.sourceMain !== '7d74ec6259c68c86ad78039c5dae55d200444461' ||
          migration.publicBase !== pull.base.sha
        )
          throw new Error('Migration must match the audited source and current distribution base.');
        git('merge-base', '--is-ancestor', migration.sourceMain, pull.head.sha);
        const files = api(
          `repos/${repo}/pulls/${pull.number}/files?per_page=100`,
          '--paginate',
          '--slurp',
        ).flat();
        // The import may add all approved source files, but its source delta is tooling/documentation only.
        for (const path of git('diff', '--name-only', migration.sourceMain, pull.head.sha)
          .split('\n')
          .filter(Boolean))
          if (
            !/^(scripts\/|\.github\/|docs\/|\.release\/|updates\/beta\.json$|LICENSE$|README\.md$|AGENTS\.md$|PROJECT_SPEC\.md$)/.test(
              path,
            )
          )
            throw new Error('Migration changed approved application source.');
        if (!files.length) throw new Error('Empty migration.');
        if (
          git('show', `${pull.base.sha}:updates/beta.json`) !==
          git('show', `${pull.head.sha}:updates/beta.json`)
        )
          throw new Error('Migration changed the live beta feed.');
        const baseline = JSON.parse(git('show', `${pull.head.sha}:.release/baseline.json`));
        if (baseline.version !== '0.3.0' || baseline.sourceRef !== 'refs/tags/legacy-source/v0.3.0')
          throw new Error('Migration baseline must reference approved legacy source.');
        return;
      }
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
    if (isFeedBranch(pull.head.ref)) verifyFeedPull(pull, repo);
    if (pull.head.ref === 'migration/source-import') {
      const eventFile = join(tmpdir(), `veil-migration-policy-${pull.number}.json`);
      writeFileSync(eventFile, JSON.stringify({ pull_request: pull }));
      run('git', ['fetch', 'origin', pull.base.ref]);
      execFileSync(process.execPath, ['scripts/gitflow.mjs', 'policy'], {
        stdio: 'inherit',
        env: { ...process.env, GITHUB_EVENT_PATH: eventFile },
      });
    }
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
    if (pull.base.ref === 'main' && isReleaseBranch(pull.head.ref))
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
    // Update-feed commits alone never change the baseline; finalize merges them in.
    try {
      git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
    } catch {
      if (!feedOnlyDrift(git('diff', '--name-only', 'HEAD...origin/main').split('\n')))
        throw new Error('Back-merge main into the source first: main contains a newer release.');
    }
    const baseline = readJson('.release/baseline.json');
    const proposed = proposeVersion(
      baseline.version,
      messagesSince(baseline.sourceRef),
      source.startsWith('hotfix/'),
    );
    const requested = process.env.TARGET_VERSION?.trim();
    const version = requested
      ? requestedVersion(requested, baseline.version, source.startsWith('hotfix/'))
      : proposed;
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
    const stale = openPulls.filter((item) => item.head.ref.startsWith('release/'));
    if (source === 'develop' && stale.length) {
      if (process.env.RETIRE_EXISTING !== 'true')
        throw new Error(
          `Finish or retire the open release candidate (#${stale[0].number}) first; rerun with retire enabled to replace it.`,
        );
      // Published betas, tags and the branch stay; only the review PR is closed.
      for (const pull of stale)
        gh(
          'pr',
          'close',
          String(pull.number),
          '--repo',
          repo,
          '--comment',
          `Retired by Prepare release: superseded by the ${version} candidate. Published betas and tags are kept.`,
        );
    }
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
    const feeds = api(`repos/${repo}/pulls?state=open&base=main&per_page=100`).filter((item) =>
      isFeedBranch(item.head.ref),
    );
    if (feeds.length)
      throw new Error(
        `Update-feed PR #${feeds[0].number} is still open. Let it merge (approve its held CI run if needed), then finalize; otherwise the release PR falls behind main.`,
      );
    // Checked feed PRs advance main during beta testing. Preserve that history
    // in the candidate before final review; conflicts stop without a push.
    try {
      git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
    } catch {
      git('config', 'user.name', 'github-actions[bot]');
      git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
      git('merge', '--no-ff', '--no-edit', 'origin/main');
    }
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
