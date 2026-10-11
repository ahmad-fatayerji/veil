import { execFileSync } from 'node:child_process';
import { distributionRepository, isFeedBranch } from './update-feed.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const branch = process.env.FEED_BRANCH;
const sha = process.env.FEED_SHA;
if (
  repository !== distributionRepository ||
  !isFeedBranch(branch ?? '') ||
  !/^[a-f0-9]{40}$/.test(sha ?? '') ||
  !/^\d+$/.test(process.env.FEED_RUN ?? '')
)
  throw new Error('Invalid feed merge context.');
const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const api = (route, ...args) => JSON.parse(gh('api', `repos/${repository}/${route}`, ...args));
const run = api(`actions/runs/${process.env.FEED_RUN}`);
if (
  run.path !== '.github/workflows/ci.yml' ||
  run.head_sha !== sha ||
  run.head_branch !== branch ||
  run.conclusion !== 'success' ||
  run.head_repository.full_name !== repository
)
  throw new Error('Feed merge requires exact-head successful CI.');
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
