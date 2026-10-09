import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyVersions } from './release-files.mjs';

const executable = 'veil-desktop.exe';
const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function assertNativeBuild(metadata, expected, bytes) {
  for (const field of ['sourceSha', 'version', 'workflowRun']) {
    if (!expected[field] || metadata[field] !== expected[field])
      throw new Error(`Native build ${field} mismatch.`);
  }
  // Re-running failed publication jobs reuses the successful build from this run.
  const attempt = Number(metadata.workflowAttempt);
  const currentAttempt = Number(expected.workflowAttempt);
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !Number.isSafeInteger(currentAttempt) ||
    attempt > currentAttempt
  )
    throw new Error('Native build workflowAttempt mismatch.');
  if (metadata.executable !== executable || metadata.platform !== 'windows-x86_64')
    throw new Error('Unexpected native build executable or platform.');
  if (!bytes?.length || metadata.sha256 !== checksum(bytes))
    throw new Error('Native build checksum mismatch or empty executable.');
}

export function nativeBuildArtifact(command, directory, root = '.', environment = process.env) {
  const expected = {
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    version: verifyVersions(root),
    workflowRun: environment.GITHUB_RUN_ID,
    workflowAttempt: environment.GITHUB_RUN_ATTEMPT,
  };
  const artifactDirectory = resolve(root, directory);
  const binary = resolve(root, 'target/release', executable);
  if (command === 'create') {
    const bytes = readFileSync(binary);
    const metadata = {
      ...expected,
      executable,
      platform: 'windows-x86_64',
      sha256: checksum(bytes),
    };
    assertNativeBuild(metadata, expected, bytes);
    mkdirSync(artifactDirectory, { recursive: true });
    copyFileSync(binary, resolve(artifactDirectory, executable));
    writeFileSync(
      resolve(artifactDirectory, 'native-build.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
  } else if (command === 'restore') {
    const source = resolve(artifactDirectory, executable);
    if (!statSync(source).isFile()) throw new Error('Missing native build executable.');
    const metadata = JSON.parse(
      readFileSync(resolve(artifactDirectory, 'native-build.json'), 'utf8'),
    );
    assertNativeBuild(metadata, expected, readFileSync(source));
    mkdirSync(resolve(root, 'target/release'), { recursive: true });
    copyFileSync(source, binary);
  } else {
    throw new Error('Usage: native-build-artifact.mjs create|restore <artifact-directory>');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  nativeBuildArtifact(process.argv[2], process.argv[3]);
  console.log('Native build provenance verified.');
}
