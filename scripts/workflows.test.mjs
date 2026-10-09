import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const workflow = (name) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
test('the actual aggregate workflow rejects failed, cancelled, skipped and missing jobs', () => {
  const ci = workflow('ci');
  assert.deepEqual(ci.jobs.gate.needs.sort(), ['integration', 'javascript', 'policy', 'rust']);
  assert.equal(ci.jobs.gate.if, 'always()');
  const code = ci.jobs.gate.steps[0].run.match(/-e '([\s\S]+)'/)[1];
  const run = (results) =>
    spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, RESULTS: JSON.stringify(results) },
    }).status;
  const success = Object.fromEntries(
    ci.jobs.gate.needs.map((name) => [name, { result: 'success' }]),
  );
  assert.equal(run(success), 0);
  for (const result of ['failure', 'cancelled', 'skipped'])
    assert.equal(run({ ...success, rust: { result } }), 1);
  assert.equal(run({}), 1);
  assert.equal(JSON.stringify(ci).includes('secrets.'), false);
  assert.match(ci.jobs.gate.name, /Candidate validation/);
});
test('signing waits for exact-source validation and stable release excludes feature merges', () => {
  for (const name of ['beta', 'release']) {
    const value = workflow(name);
    assert.ok(value.jobs.publish.needs.includes('validate'));
    assert.ok(value.jobs.publish.needs.includes('build'));
    const sourceJob = name === 'beta' ? 'candidate' : 'source';
    assert.equal(value.jobs.build.needs, sourceJob);
    assert.equal(value.jobs.build.uses, './.github/workflows/build-release.yml');
    assert.equal(value.jobs.build.with.ref, value.jobs.validate.with.ref);
    assert.equal(value.jobs.build.with.ref, value.jobs.publish.with.ref);
    assert.equal(value.jobs.build.secrets, undefined);
    assert.equal(value.jobs.publish.with.artifact, '${{ needs.build.outputs.artifact }}');
    assert.ok(value.jobs.publish.with.ref.includes('outputs.sha'));
  }
  const stable = workflow('release');
  assert.equal(stable.on.push, undefined);
  assert.match(stable.jobs.source.if, /release\//);
  assert.match(stable.jobs.source.if, /hotfix\//);
  assert.equal(workflow('publish').jobs.publish.steps[0].with.ref, '${{ inputs.ref }}');
});

test('unsigned compilation and gated packaging do not repeat frontend or desktop builds', () => {
  const build = workflow('build-release');
  const publish = workflow('publish');
  assert.equal(JSON.stringify(build).includes('secrets.'), false);
  assert.equal(build.permissions.contents, 'read');
  assert.equal(build.jobs.build.steps[0].with.ref, '${{ inputs.ref }}');
  const buildCommands = build.jobs.build.steps.map((step) => step.run ?? '').join('\n');
  assert.match(buildCommands, /tauri build --no-bundle -- --locked --timings/);
  assert.doesNotMatch(buildCommands, /pnpm build|tauri bundle/);
  const steps = publish.jobs.publish.steps;
  const index = (text) => steps.findIndex((step) => step.run?.includes(text));
  for (const command of [
    'native-build-artifact.mjs restore',
    'publish-release.mjs preflight',
    'tauri bundle',
    'veil-release-verifier',
    'publish-release.mjs publish',
  ])
    assert.ok(index(command) >= 0, `Missing release step: ${command}`);
  assert.ok(index('native-build-artifact.mjs restore') < index('publish-release.mjs preflight'));
  assert.ok(index('publish-release.mjs preflight') < index('tauri bundle'));
  assert.ok(index('veil-release-verifier') < index('publish-release.mjs publish'));
  assert.equal(
    steps.find((step) => step.uses?.startsWith('actions/download-artifact@')).with.name,
    '${{ inputs.artifact }}',
  );
  assert.doesNotMatch(
    steps.map((step) => step.run ?? '').join('\n'),
    /tauri build|pnpm build|cargo test -p veil-desktop/,
  );
  assert.equal(
    steps.filter((step) => JSON.stringify(step).includes('TAURI_SIGNING_PRIVATE_KEY')).length,
    1,
  );
});

test('Windows jobs use purpose-specific caches, reduced CI debug info and timing artifacts', () => {
  const ci = workflow('ci');
  const jobs = [
    ci.jobs.rust,
    ci.jobs.integration,
    workflow('build-release').jobs.build,
    workflow('publish').jobs.publish,
  ];
  const keys = [
    'windows-rust-checks-v1',
    'windows-desktop-debug-v1',
    'windows-desktop-release-v1',
    'windows-release-verifier-v1',
  ];
  for (const [i, job] of jobs.entries()) {
    assert.equal(job.env.CARGO_PROFILE_DEV_DEBUG, 1);
    assert.equal(job.env.CARGO_PROFILE_TEST_DEBUG, 1);
    const cache = job.steps.find((step) => step.uses === 'Swatinem/rust-cache@v2');
    assert.equal(cache.with['shared-key'], keys[i]);
    assert.equal(cache.with['cache-workspace-crates'], undefined);
    assert.equal(cache.with['add-rust-environment-hash-key'], undefined);
    assert.ok(job.steps.some((step) => step.run?.includes('--timings')));
    assert.ok(
      job.steps.some(
        (step) =>
          step.uses?.startsWith('actions/upload-artifact@') &&
          step.if === 'always()' &&
          step.with.path.includes('cargo-timings/'),
      ),
    );
    assert.ok(
      job.steps.some(
        (step) => step.env?.NATIVE_CACHE_HIT === '${{ steps.rust-cache.outputs.cache-hit }}',
      ),
    );
  }
  assert.doesNotMatch(ci.jobs.rust.steps.map((step) => step.run ?? '').join('\n'), /cargo check/);
  assert.ok(
    ci.jobs.rust.steps.some((step) => step.run?.includes('clippy --workspace --all-targets')),
  );
  assert.equal(
    ci.jobs.integration.steps.some((step) => step.run === 'pnpm build'),
    false,
  );
  assert.equal(
    workflow('publish').jobs.publish.steps.find((step) => step.uses === 'Swatinem/rust-cache@v2')
      .with.workspaces,
    '. -> target/verifier',
  );
});
