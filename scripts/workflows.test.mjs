import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { checkNames, planChecks } from './ci-plan.mjs';
import { parse } from 'yaml';

const workflow = (name) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
test('the aggregate gate rejects unexpected skips and accepts only explicit omissions', () => {
  const ci = workflow('ci');
  assert.deepEqual(ci.jobs.gate.needs.slice().sort(), ['plan', 'policy', ...checkNames].sort());
  assert.equal(ci.jobs.gate.if, 'always()');
  assert.equal(ci.jobs.gate.steps.at(-1).run, 'node scripts/ci-plan.mjs gate');
  const run = (results, full = false) =>
    spawnSync(process.execPath, ['scripts/ci-plan.mjs', 'gate'], {
      env: { ...process.env, RESULTS: JSON.stringify(results), FULL_VALIDATION: String(full) },
    }).status;
  const results = (paths, full) => {
    const plan = planChecks(paths, full);
    return {
      plan: {
        result: 'success',
        outputs: Object.fromEntries(
          Object.entries(plan).map(([name, value]) => [name, String(value)]),
        ),
      },
      policy: { result: 'success' },
      ...Object.fromEntries(
        checkNames.map((name) => [name, { result: plan[name] ? 'success' : 'skipped' }]),
      ),
    };
  };
  const success = results([], true);
  assert.equal(run(success), 0);
  for (const name of ci.jobs.gate.needs) {
    for (const result of ['failure', 'cancelled', 'skipped'])
      assert.equal(run({ ...success, [name]: { result } }), 1);
    const missing = { ...success };
    delete missing[name];
    assert.equal(run(missing), 1);
  }
  const docs = results(['docs/testing.md'], false);
  assert.equal(run(docs), 0);
  assert.equal(run(docs, true), 1);
  assert.equal(run(success, true), 0);
  const incomplete = structuredClone(success);
  delete incomplete.plan.outputs.extended;
  assert.equal(run(incomplete), 1);
  assert.equal(run({ ...docs, rust: { result: 'failure' } }), 1);
  assert.equal(run({ ...docs, formatting: { result: 'skipped' } }), 1);
  assert.equal(run({}), 1);
  for (const name of checkNames) {
    assert.equal(ci.jobs[name].needs, 'plan');
    assert.equal(ci.jobs[name].if, `needs.plan.outputs.${name} == 'true'`);
    assert.equal(ci.jobs.plan.outputs[name], '${{ steps.select.outputs.' + name + ' }}');
  }
  assert.equal(JSON.stringify(ci).includes('secrets.'), false);
  assert.match(ci.jobs.gate.name, /Candidate validation/);
  assert.ok(ci.on.schedule.length);
  assert.match(ci.jobs.networking.env.VEIL_NETWORK_MODE, /extended/);
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
    ci.jobs.desktop,
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
    ci.jobs.desktop.steps.some((step) => step.run === 'pnpm build'),
    false,
  );
  assert.equal(
    workflow('publish').jobs.publish.steps.find((step) => step.uses === 'Swatinem/rust-cache@v2')
      .with.workspaces,
    '. -> target/verifier',
  );
});

test('unified publication is opt-in, feed merges use trusted main and PR CI has no signing secrets', () => {
  for (const [name, job] of [
    ['release', 'source'],
    ['beta', 'candidate'],
    ['prepare-release', 'prepare'],
    ['finalize-release', 'finalize'],
    ['publish', 'publish'],
  ]) {
    const condition = workflow(name).jobs[job].if;
    assert.match(condition, /github.repository == 'ahmad-fatayerji\/veil'/);
    assert.match(condition, /RELEASE_PUBLICATION_ENABLED == 'true'/);
  }
  const publish = workflow('publish');
  assert.equal(publish.on.workflow_call.secrets.RELEASES_TOKEN, undefined);
  assert.equal(publish.permissions['pull-requests'], 'write');
  assert.equal(publish.permissions.actions, 'write');
  assert.doesNotMatch(JSON.stringify(publish), /secrets.RELEASES_TOKEN/);
  assert.doesNotMatch(JSON.stringify(workflow('ci')), /secrets\./);
  const feed = workflow('merge-update-feed');
  assert.ok(feed.on.workflow_dispatch.inputs.sha.required);
  assert.match(feed.jobs.merge.if, /github.ref == 'refs\/heads\/main'/);
  const dispatcher = workflow('ci').jobs['dispatch-feed-merge'];
  assert.equal(dispatcher.permissions.actions, 'write');
  assert.equal(
    dispatcher.steps.some((step) => step.uses),
    false,
  );
  assert.match(dispatcher.if, /head.repo.full_name == github.repository/);
  assert.match(dispatcher.steps[0].run, /merge-update-feed.yml --ref main/);
  assert.equal(feed.jobs.merge.steps[0].with.ref, 'main');
  assert.match(feed.jobs.merge.if, /head_repository.full_name == github.repository/);
  assert.match(feed.jobs.merge.if, /conclusion == 'success'/);
  const coordinator = readFileSync('scripts/gitflow.mjs', 'utf8');
  assert.match(coordinator, /pull.base.ref === 'main' && isReleaseBranch\(pull.head.ref\)/);
  assert.doesNotMatch(JSON.stringify(feed), /release\.yml|secrets\./);
});

test('stable publication skips validation only when identical full validation is proven', () => {
  const stable = workflow('release');
  assert.equal(stable.jobs.validate.if, "needs.source.outputs.reuse != 'true'");
  assert.equal(stable.jobs.source.outputs.reuse, '${{ steps.reuse.outputs.reuse }}');
  const reuse = stable.jobs.source.steps.find((step) => step.id === 'reuse');
  assert.equal(reuse.run, 'node scripts/ci-plan.mjs reuse');
  const condition = stable.jobs.publish.if.replace(/\s+/g, ' ');
  assert.match(condition, /needs.build.result == 'success'/);
  assert.match(condition, /needs.validate.result == 'success'/);
  assert.match(
    condition,
    /needs.validate.result == 'skipped' && needs.source.outputs.reuse == 'true'/,
  );
  // Betas always validate their exact candidate; only stable may reuse the release PR.
  assert.equal(workflow('beta').jobs.validate.if, undefined);
});

test('relay transports run as parallel network regression jobs', () => {
  const job = workflow('ci').jobs.networking;
  assert.deepEqual(job.strategy.matrix.transport, ['udp', 'tcp']);
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job.env.VEIL_TURN_TRANSPORT, '${{ matrix.transport }}');
  assert.equal(job.steps.filter((step) => step.run === 'pnpm test:network').length, 1);
});

test('prepare accepts an explicit version and explicit candidate retirement', () => {
  const prepare = workflow('prepare-release');
  assert.equal(prepare.on.workflow_dispatch.inputs.version.required, false);
  assert.equal(prepare.on.workflow_dispatch.inputs.retire.type, 'boolean');
  const step = prepare.jobs.prepare.steps.find((item) => item.id === 'candidate');
  assert.equal(step.env.TARGET_VERSION, '${{ inputs.version }}');
  assert.equal(step.env.RETIRE_EXISTING, '${{ inputs.retire }}');
});
