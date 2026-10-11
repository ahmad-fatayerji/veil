import { execFileSync } from 'node:child_process';
import { distributionRepository, isFeedBranch } from './update-feed.mjs';
import { matchingFeedRun } from './feed-merge-context.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const branch = process.env.FEED_BRANCH;
const sha = process.env.FEED_SHA;
if (
  repository !== distributionRepository ||
  !isFeedBranch(branch ?? '') ||
  !/^[a-f0-9]{40}$/.test(sha ?? '') ||
  (process.env.FEED_RUN && !/^\d+$/.test(process.env.FEED_RUN))
)
  throw new Error('Invalid feed merge context.');
const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const api = (route, ...args) => JSON.parse(gh('api', `repos/${repository}/${route}`, ...args));
let run;
const deadline = Date.now() + 15 * 60_000;
// Explicit dispatch happens after CI gate, before the complete CI run has closed.
// Wait for its exact-head successful result and GitHub's protected merge state.
while (Date.now() < deadline) {
  const pulls = api(`pulls?state=all&base=main&head=${repository.split('/')[0]}:${branch}`);
  const pull = pulls.find((item) => item.head.sha === sha);
  if (!pull || pull.head.repo.full_name !== repository)
    throw new Error('Feed PR moved after dispatch.');
  if (pull.state === 'closed') {
    if (!pull.merged_at) throw new Error('Feed PR was closed without merging.');
    console.log('Exact feed proposal was already merged.');
    process.exit(0);
  }
  if (pull.draft) throw new Error('Feed PR is not ready.');
  const runs = process.env.FEED_RUN
    ? [api(`actions/runs/${process.env.FEED_RUN}`)]
    : api(`actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&per_page=100`)
        .workflow_runs;
  run = runs.find((item) => matchingFeedRun(item, repository, branch, sha));
  if (process.env.FEED_RUN && !run)
    throw new Error('Feed merge requires exact-head successful CI.');
  const ready = api(`pulls/${pull.number}`);
  if (run && ready.mergeable_state === 'clean') break;
  await new Promise((done) => setTimeout(done, 15_000));
  run = null;
}
if (!run)
  throw new Error('Timed out waiting for exact-head CI and protected feed merge readiness.');
const jobs = api(`actions/runs/${run.id}/jobs?per_page=100`, '--paginate', '--slurp').flatMap(
  (page) => page.jobs,
);
if (!jobs.some((job) => job.name === 'CI gate' && job.conclusion === 'success'))
  throw new Error('Missing successful CI gate.');
const pulls = api(`pulls?state=open&base=main&head=${repository.split('/')[0]}:${branch}`);
if (
  pulls.length !== 1 ||
  pulls[0].draft ||
  pulls[0].head.sha !== sha ||
  pulls[0].head.repo.full_name !== repository
)
  throw new Error('Feed PR moved after validation or is not ready.');
execFileSync(process.execPath, ['scripts/gitflow.mjs', 'merge-pr', String(pulls[0].number)], {
  stdio: 'inherit',
  windowsHide: true,
});
