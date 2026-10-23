// Build once, then run independent Windows clients for manual collaboration testing.
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const help = 'Usage: pnpm dev:multi [count] (default: 2, Windows only)';

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(help);
    return;
  }
  const count = Number(args[0] ?? 2);
  if (args.length > 1 || !Number.isSafeInteger(count) || count < 1) {
    throw new Error(help);
  }
  if (process.platform !== 'win32') throw new Error(help);

  const cli = resolve(root, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js');
  await access(cli).catch(() => {
    throw new Error('Install dependencies first: pnpm install --frozen-lockfile');
  });
  // A dedicated target avoids replacing the executable used by normal tauri dev.
  const directory = resolve(root, 'target/multi-instance');
  const target = resolve(directory, 'build');
  await mkdir(directory, { recursive: true });
  const profiles = await mkdtemp(resolve(directory, 'run-'));
  const children = new Set();
  let stopping = false;

  function stop() {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      // Stop only processes owned by this launcher, including build/WebView children.
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => child.kill());
      }
    }
  }

  function launch(command, commandArgs, options) {
    const child = spawn(command, commandArgs, {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      ...options,
    });
    children.add(child);
    return new Promise((done, reject) => {
      child.once('error', (error) => {
        children.delete(child);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        children.delete(child);
        if (stopping || code === 0) done();
        else reject(new Error(`Process exited with ${signal ?? `code ${code}`}.`));
      });
    });
  }

  const interrupt = () => {
    process.exitCode = 130;
    stop();
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    console.log(
      'Building a debug app with the frontend included (first build can take a while)...',
    );
    await launch(process.execPath, [cli, 'build', '--debug', '--no-bundle'], {
      cwd: resolve(root, 'apps/desktop'),
      env: { ...process.env, CARGO_TARGET_DIR: target },
    });
    if (stopping) return;

    console.log(`Opening ${count} test instances. Profiles: ${profiles}`);
    console.log('Share in one window; paste the link into Join session in another.');
    console.log('No dev server is needed. Rerun this command after changing source.');
    console.log('Ctrl+C stops all these instances immediately; save any notes first.');
    const clients = [];
    for (let index = 1; index <= count; index++) {
      const profile = resolve(profiles, `client-${index}`);
      await mkdir(profile, { recursive: true });
      if (stopping) break;
      const env = {
        ...process.env,
        VEIL_TEST_SETTINGS_DIR: profile,
        WEBVIEW2_USER_DATA_FOLDER: resolve(profile, 'webview'),
      };
      delete env.VEIL_TEST_SINGLE_INSTANCE;
      // Attach a rejection handler immediately while the remaining clients start.
      clients.push(
        launch(resolve(target, 'debug/veil-desktop.exe'), [], { env }).catch((error) => {
          console.error(`Client ${index}: ${error.message}`);
          process.exitCode = 1;
          stop();
        }),
      );
    }
    await Promise.all(clients);
  } finally {
    stop();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
