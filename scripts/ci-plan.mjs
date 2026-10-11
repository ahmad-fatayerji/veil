import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const checkNames = [
  'formatting',
  'javascript',
  'release',
  'rust',
  'desktop',
  'integration',
  'networking',
];

export function planChecks(paths, full = false) {
  const plan = Object.fromEntries(checkNames.map((name) => [name, full]));
  plan.formatting = true;
  plan.extended = full;
  for (const path of paths) {
    if (/^(docs\/|.*\.md$|LICENSE$)/.test(path)) continue;
    // Configuration, dependencies and unknown paths affect every layer. Fail closed.
    if (
      /^(\.github\/|\.release\/|scripts\/)/.test(path) ||
      !/^(apps\/|packages\/|tests\/)/.test(path)
    ) {
      for (const name of checkNames) plan[name] = true;
      continue;
    }
    plan.javascript = true;
    if (/^(apps\/desktop\/src-tauri\/|packages\/(host|release-verifier)\/)/.test(path)) {
      plan.rust = true;
      plan.desktop = true;
      plan.integration = true;
      if (/packages\/release-verifier\/|updates|tauri\.conf/.test(path)) plan.release = true;
      if (/network|signaling|credential|src\/lib\.rs$/.test(path)) plan.networking = true;
    } else if (/^(apps\/|packages\/(ui|editor)\/|tests\/e2e\/)/.test(path)) {
      plan.integration = true;
    } else if (/^packages\/(collaboration|protocol)\//.test(path)) {
      plan.integration = true;
      plan.networking = true;
    } else {
      for (const name of checkNames) plan[name] = true;
    }
    if (/\/(package\.json|Cargo\.toml)$/.test(path)) {
      for (const name of checkNames) plan[name] = true;
    }
  }
  return plan;
}

export function checkGate(results, full = false) {
  if (results.plan?.result !== 'success' || results.policy?.result !== 'success') return false;
  const outputs = results.plan.outputs;
  if (!['true', 'false'].includes(outputs?.extended)) return false;
  if (full && (outputs.extended !== 'true' || checkNames.some((name) => outputs[name] !== 'true')))
    return false;
  return checkNames.every((name) => {
    const selected = outputs?.[name];
    return (
      (selected === 'true' && results[name]?.result === 'success') ||
      (selected === 'false' && results[name]?.result === 'skipped')
    );
  });
}

// Reuse only a successful gate on this exact merge commit from this CI workflow.
// Metadata edits still run branch/title policy. A missing prior run means normal checks.
export function reusableGate(check, run, sha, repository, currentRun) {
  return (
    check.name === 'CI gate' &&
    check.conclusion === 'success' &&
    check.head_sha === sha &&
    check.app?.slug === 'github-actions' &&
    run.path === '.github/workflows/ci.yml' &&
    run.event === 'pull_request' &&
    run.repository?.full_name === repository &&
    String(run.id) !== String(currentRun)
  );
}

export function validatedSource(log, sha) {
  return Array.from(log.matchAll(/CI_SOURCE_SHA=([a-f0-9]{40})(?:\r?\n|$)/g)).some(
    (match) => match[1] === sha,
  );
}

async function validatedMetadataEdit(event) {
  if (event.action !== 'edited' || event.changes?.base || !event.pull_request) return false;
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const api = async (route, logs = false) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) throw new Error('Prior validation lookup unavailable.');
    return logs ? response.text() : response.json();
  };
  try {
    // GitHub attaches PR checks to the head SHA, while checkout tests the merge SHA.
    const head = event.pull_request.head.sha;
    const checks = await api(`commits/${head}/check-runs?per_page=100`);
    for (const check of checks.check_runs) {
      if (check.name !== 'CI gate' || check.conclusion !== 'success') continue;
      const id = check.details_url?.match(/\/actions\/runs\/(\d+)/)?.[1];
      const job = check.details_url?.match(/\/job\/(\d+)/)?.[1];
      if (
        id &&
        job &&
        reusableGate(
          check,
          await api(`actions/runs/${id}`),
          head,
          repository,
          process.env.GITHUB_RUN_ID,
        ) &&
        validatedSource(await api(`actions/jobs/${job}/logs`, true), sha)
      )
        return true;
    }
  } catch {
    console.log('Could not confirm prior exact-commit validation; running selected checks.');
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'gate') {
    if (!checkGate(JSON.parse(process.env.RESULTS), process.env.FULL_VALIDATION === 'true')) {
      console.error('CI gate rejected missing, failed, cancelled or unexpectedly skipped checks.');
      process.exitCode = 1;
    } else
      console.log(
        `CI_SOURCE_SHA=${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}`,
      );
  } else {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const full =
      process.env.FULL_VALIDATION === 'true' ||
      !event.pull_request ||
      event.pull_request.base.ref === 'main';
    const paths = full
      ? []
      : execFileSync(
          'git',
          ['diff', '--name-only', '-z', '--no-renames', event.pull_request.base.sha, 'HEAD'],
          { encoding: 'utf8' },
        )
          .split('\0')
          .filter(Boolean);
    const plan = planChecks(paths, full);
    const reused = !full && (await validatedMetadataEdit(event));
    if (reused) for (const name of checkNames) plan[name] = false;
    for (const [name, value] of Object.entries(plan)) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
    const summary =
      `### CI selection\n\n${reused ? 'Metadata edit: reusing successful CI on the identical merge commit; policy runs again.' : full ? 'Full validation' : 'Changes compared with the PR base'}\n\n` +
      Object.entries(plan)
        .map(([name, selected]) => `- ${name}: ${selected ? 'required' : 'not needed'}`)
        .join('\n') +
      '\n';
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    console.log(summary);
  }
}
