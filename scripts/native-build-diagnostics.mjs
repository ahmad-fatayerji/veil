import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('target/build-diagnostics');
mkdirSync(output, { recursive: true });
const report = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runner: process.env.RUNNER_NAME ?? 'local',
  runnerOS: process.env.RUNNER_OS ?? process.platform,
  runnerArch: process.env.RUNNER_ARCH ?? process.arch,
  runnerImage: process.env.ImageVersion ?? null,
  workflowRun: process.env.GITHUB_RUN_ID ?? null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  cacheHit: process.env.NATIVE_CACHE_HIT ?? null,
  cacheNamespace: process.env.NATIVE_CACHE_NAMESPACE ?? null,
  rustc: execFileSync('rustc', ['--version', '--verbose'], { encoding: 'utf8' }).trim(),
  cargo: execFileSync('cargo', ['--version'], { encoding: 'utf8' }).trim(),
  devDebug: process.env.CARGO_PROFILE_DEV_DEBUG ?? 'default',
  testDebug: process.env.CARGO_PROFILE_TEST_DEBUG ?? 'default',
};
writeFileSync(resolve(output, 'environment.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log('Native build diagnostics recorded.');
