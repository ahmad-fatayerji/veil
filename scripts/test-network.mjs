// Real Chromium WebRTC against the public server and coturn. Loopback test only.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import WebSocket from 'ws';

const root = resolve(import.meta.dirname, '..');
const serverRoot = resolve(process.env.VEIL_SERVER_SOURCE || resolve(root, '../Veil-server'));
await mkdir(resolve(root, 'target/network-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/network-acceptance/run-'));
const server = 'http://127.0.0.1:18087';
const binary = resolve(
  serverRoot,
  `target/debug/veil-server${process.platform === 'win32' ? '.exe' : ''}`,
);
const secret = randomBytes(32).toString('hex');
const metricsSecret = randomBytes(32).toString('hex');
await writeFile(resolve(directory, 'turn-secret'), secret);
await writeFile(resolve(directory, 'metrics-secret'), metricsSecret);
await writeFile(
  resolve(directory, 'turn.conf'),
  `listening-port=3479\nrealm=veil-test\nfingerprint\nuse-auth-secret\nstatic-auth-secret=${secret}\nmin-port=40000\nmax-port=40040\nexternal-ip=127.0.0.1\nallow-loopback-peers\nno-multicast-peers\nno-tls\ncli=0\nrelay-threads=1\nprometheus\nprometheus-address=0.0.0.0\nprometheus-port=9641\nuser-quota=4\ntotal-quota=32\nmax-bps=262144\nbps-capacity=8388608\nmax-allocate-lifetime=600\nlog-file=stdout\n`,
);
const env = {
  ...process.env,
  HOST_DB: resolve(directory, 'hosts.sqlite'),
  TURN_SECRET_FILE: resolve(directory, 'turn-secret'),
  METRICS_SECRET_FILE: resolve(directory, 'metrics-secret'),
  LISTEN: '127.0.0.1:18087',
  MAX_RELAY_GRANTS: '4',
  STUN_URLS: 'stun:127.0.0.1:3479',
  TURN_URLS: `turn:127.0.0.1:3479?transport=${process.env.VEIL_TURN_TRANSPORT || 'udp'}`,
};
const credential = execFileSync(binary, ['issue', 'integration'], { env, encoding: 'utf8' }).trim();
const children = [];
const sockets = new Set();
const notices = [];
let browser;
const turnName = `veil-test-${randomBytes(6).toString('hex')}`;
async function waitFor(check, label, timeout = 40_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timed out: ${label}; notices: ${notices.slice(-12).join('; ')}`);
}
const launch = (cmd, args, options) => {
  const child = spawn(cmd, args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    ...options,
  });
  child.stderr.on('data', (data) => process.stderr.write(data));
  children.push(child);
  return child;
};
const metrics = async () =>
  (
    await fetch(`${server}/v2/metrics`, { headers: { Authorization: `Bearer ${metricsSecret}` } })
  ).json();
const turnMetrics = async () => (await fetch('http://127.0.0.1:19641/metrics')).text();
const allocations = (text) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('turn_total_allocations{'))
    .reduce((sum, line) => sum + Number(line.split(' ').at(-1)), 0);
try {
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '--name',
      turnName,
      '-p',
      '127.0.0.1:3479:3479/udp',
      '-p',
      '127.0.0.1:3479:3479/tcp',
      '-p',
      '127.0.0.1:19641:9641',
      '-p',
      '127.0.0.1:40000-40040:40000-40040/udp',
      '-v',
      `${resolve(directory, 'turn.conf')}:/etc/coturn/test.conf:ro`,
      'coturn/coturn:4.18.0-r0',
      '-c',
      '/etc/coturn/test.conf',
    ],
    { stdio: 'pipe' },
  );
  launch(binary, [], { env });
  launch(
    process.execPath,
    [
      resolve(root, 'node_modules/vite/bin/vite.js'),
      resolve(root, 'apps/web'),
      '--host',
      '127.0.0.1',
      '--port',
      '15173',
      '--strictPort',
    ],
    { cwd: root },
  );
  await waitFor(
    async () => (await fetch(`${server}/health`).catch(() => null))?.ok,
    'server startup',
  );
  await waitFor(
    async () => (await fetch('http://127.0.0.1:15173').catch(() => null))?.ok,
    'Vite startup',
  );
  browser = await chromium.launch();
  const pages = [];
  let relayRequests = 0;
  async function participant(index) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let socket;
    await page.exposeBinding('networkRequest', async (_, path, method, body, ticket) => {
      if (path === '/v2/relay') relayRequests++;
      const response = await fetch(`${server}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ticket || credential}`,
        },
        ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error(`Server rejected ${path}: ${response.status}`);
      return response.json();
    });
    await page.exposeBinding('networkConnect', async (_, sessionId, ticket) => {
      socket?.close();
      socket = new WebSocket(`${server.replace('http:', 'ws:')}/v2/socket/${sessionId}`, {
        headers: { Authorization: `Bearer ${ticket}` },
      });
      sockets.add(socket);
      socket.on('message', (bytes) => {
        void page
          .evaluate((message) => window.networkReceive(message), JSON.parse(bytes.toString()))
          .catch(() => {});
      });
      socket.on('close', () => {
        void page.evaluate(() => window.networkReceive({ kind: 'disconnected' })).catch(() => {});
      });
      await new Promise((done, reject) => {
        socket.once('open', done);
        socket.once('error', (error) =>
          reject(
            /401|403/.test(error.message) ? new Error('Session authorization rejected.') : error,
          ),
        );
      });
    });
    await page.exposeBinding('networkSend', (_, message) => {
      assert.equal(socket?.readyState, WebSocket.OPEN);
      socket.send(JSON.stringify(message));
    });
    await page.exposeBinding('networkDisconnect', () => socket?.close());
    await page.exposeBinding('notice', (_, message) => {
      notices.push(`${index}: ${message}`);
      if (notices.length > 100) notices.shift();
    });
    await page.goto('http://127.0.0.1:15173');
    await page.evaluate(
      async ({ module, forceRelay }) => {
        const NativePeer = window.RTCPeerConnection;
        window.forceRelay = forceRelay;
        window.RTCPeerConnection = class extends NativePeer {
          constructor(config) {
            super({ ...config, ...(window.forceRelay ? { iceTransportPolicy: 'relay' } : {}) });
          }
        };
        window.automatic = await import(module);
        window.transport = {
          request: (_server, path, method, body, ticket) =>
            window.networkRequest(path, method, body, ticket),
          connect: (_server, sessionId, ticket, receive) => {
            window.networkReceive = receive;
            return window.networkConnect(sessionId, ticket);
          },
          send: (message) => window.networkSend(message),
          disconnect: () => window.networkDisconnect(),
        };
      },
      {
        module: `/@fs/${resolve(root, 'packages/collaboration/src/automatic.ts').replaceAll('\\', '/')}`,
        forceRelay: index >= 4,
      },
    );
    pages.push(page);
    return page;
  }
  const host = await participant(0);
  await host.evaluate(async (server) => {
    window.active = await window.automatic.hostAutomatic(
      server,
      'Host',
      window.transport,
      window.notice,
      true,
    );
  }, server);
  for (let index = 1; index <= 5; index++) {
    const page = await participant(index);
    const invitation = await host.evaluate(() => window.active.createInvitation());
    const started = Date.now();
    await page.evaluate(
      async ({ invitation, index }) => {
        window.active = await window.automatic.joinAutomatic(
          invitation,
          `Friend ${index}`,
          window.transport,
          window.notice,
          true,
        );
      },
      { invitation, index },
    );
    await waitFor(
      () => page.evaluate(() => window.active.session.provider.synced),
      `friend ${index} synchronized`,
    );
    if (index <= 3) {
      assert.equal(relayRequests, 0, 'direct peers never obtain TURN credentials');
      assert.equal(allocations(await turnMetrics()), 0, 'direct peers create no TURN allocations');
    } else
      assert.ok(
        Date.now() - started >= 5_800,
        'fallback waits six seconds without definite failure',
      );
  }
  await waitFor(
    () =>
      host.evaluate(() => {
        const paths = window.active.session.provider.summaries().map((peer) => peer.path);
        return (
          paths.filter((path) => path === 'direct').length === 3 &&
          paths.filter((path) => path === 'relay').length === 2
        );
      }),
    'three direct and two measured relay paths',
  );
  assert.equal(
    relayRequests,
    4,
    'only the two fallback links request TURN, one grant per endpoint',
  );
  assert.ok(
    allocations(await turnMetrics()) >= 2,
    'affected links create actual relay allocations',
  );
  await Promise.all(
    pages.map((page, index) =>
      page.evaluate(
        (index) => window.active.session.doc.getText('acceptance').insert(0, `[${index}]`),
        index,
      ),
    ),
  );
  await waitFor(async () => {
    const values = await Promise.all(
      pages.map((page) =>
        page.evaluate(() => window.active.session.doc.getText('acceptance').toString()),
      ),
    );
    return new Set(values).size === 1 && values[0].length === 18;
  }, 'six-way concurrent document convergence');
  await waitFor(
    async () =>
      (
        await Promise.all(
          pages.map((page) =>
            page.evaluate(() => window.active.session.provider.awareness.getStates().size),
          ),
        )
      ).every((size) => size === 6),
    'six-way presence',
  );
  const healthy = await host.evaluate(() =>
    window.active.session.provider
      .summaries()
      .filter((peer) => peer.path === 'direct')
      .map((peer) => peer.id),
  );
  const healthyRelay = await pages[5].evaluate(
    () => window.active.session.provider.summaries().find((peer) => peer.path === 'relay').id,
  );
  await pages[4].evaluate(() => {
    window.forceRelay = false;
  });
  await host.evaluate(() => window.active.reconnect());
  await waitFor(
    () =>
      pages[4].evaluate(() =>
        window.active.session.provider
          .summaries()
          .some((peer) => peer.path === 'direct' && peer.state === 'connected'),
      ),
    'relay-to-direct handover',
  );
  assert.deepEqual(
    await host.evaluate(
      (healthy) =>
        window.active.session.provider
          .summaries()
          .filter((peer) => peer.path === 'direct' && peer.id)
          .map((peer) => peer.id)
          .filter((id) => healthy.includes(id)),
      healthy,
    ),
    healthy,
  );
  // Drop this transport and force its replacement through the staged fallback.
  await pages[4].evaluate(() => {
    window.forceRelay = true;
    for (const peer of window.active.session.provider.peers.values()) peer.channel.close();
    window.active.session.doc.getText('recovery').insert(0, 'retained local edits');
  });
  await waitFor(
    () =>
      pages[4].evaluate(() =>
        window.active.session.provider
          .summaries()
          .some((peer) => peer.path === 'relay' && peer.state === 'connected'),
      ),
    'direct-to-relay recovery',
  );
  await waitFor(
    () =>
      host.evaluate(
        () => window.active.session.doc.getText('recovery').toString() === 'retained local edits',
      ),
    'pending edits resynchronize across replacement',
  );
  assert.ok(
    await pages[5].evaluate(
      (id) =>
        window.active.session.provider
          .summaries()
          .some((peer) => peer.id === id && peer.state === 'connected'),
      healthyRelay,
    ),
    'failed direct migration preserves the healthy relay',
  );
  const beforeCooldown = await host.evaluate(() =>
    window.active.session.provider.summaries().map((peer) => peer.id),
  );
  await host.evaluate(() => window.active.reconnect());
  assert.deepEqual(
    await host.evaluate(() => window.active.session.provider.summaries().map((peer) => peer.id)),
    beforeCooldown,
    'migration cooldown suppresses repeated replacements',
  );
  const startedLoad = Date.now();
  await pages[5].evaluate(() =>
    window.active.session.doc.getText('large').insert(0, 'x'.repeat(256 * 1024)),
  );
  await waitFor(
    async () =>
      (
        await Promise.all(
          pages
            .slice(0, 6)
            .map((page) => page.evaluate(() => window.active.session.doc.getText('large').length)),
        )
      ).every((length) => length === 256 * 1024),
    'large incremental change under bandwidth ceilings',
  );
  const loadMilliseconds = Date.now() - startedLoad;
  const snapshot = await turnMetrics();
  const resources = JSON.parse(
    execFileSync('docker', ['stats', '--no-stream', '--format', '{{json .}}', turnName], {
      encoding: 'utf8',
    }),
  );
  await writeFile(
    resolve(directory, 'measurements.json'),
    JSON.stringify(
      {
        transport: process.env.VEIL_TURN_TRANSPORT || 'udp',
        loadBytes: 256 * 1024,
        loadMilliseconds,
        allocations: allocations(snapshot),
        resources,
        metrics: snapshot,
      },
      null,
      2,
    ),
  );
  const blocked = await participant(6);
  const blockedInvitation = await host.evaluate(() => window.active.createInvitation());
  await blocked.evaluate(async (invitation) => {
    window.active = await window.automatic.joinAutomatic(
      invitation,
      'Capacity test',
      window.transport,
      window.notice,
      true,
    );
    window.active.session.doc.getText('capacity').insert(0, 'local only');
  }, blockedInvitation);
  await waitFor(
    () => notices.some((notice) => notice.includes('/v2/relay: 429')),
    'explicit relay exhaustion',
  );
  assert.equal(
    await blocked.evaluate(() => window.active.session.doc.getText('capacity').toString()),
    'local only',
  );
  await host.evaluate(() =>
    window.active.session.doc.getText('healthy').insert(0, 'still running'),
  );
  await waitFor(
    () =>
      pages[1].evaluate(
        () => window.active.session.doc.getText('healthy').toString() === 'still running',
      ),
    'healthy direct links survive exhaustion',
  );
  await blocked.evaluate(() => window.active.close());
  const counters = await metrics();
  assert.equal(counters.relayCredentialsIssued, 4);
  console.log(
    'PASS: six peers, lazy TURN, mixed paths, convergence, awareness and authenticated handover.',
  );
  // Drop signaling while leaving the document transports open.
  children[0].kill();
  for (const socket of sockets) socket.close();
  await pages[5].evaluate(() =>
    window.active.session.doc.getText('acceptance').insert(0, 'offline-signaling'),
  );
  await waitFor(
    () =>
      host.evaluate(() =>
        window.active.session.doc.getText('acceptance').toString().includes('offline-signaling'),
      ),
    'healthy document links survive signaling outage',
  );
  assert.ok(
    await pages[5].evaluate(() =>
      window.active.session.doc.getText('acceptance').toString().includes('offline-signaling'),
    ),
  );
  launch(binary, [], { env });
  await waitFor(
    async () => (await fetch(`${server}/health`).catch(() => null))?.ok,
    'signaling restart',
  );
  await waitFor(
    () => notices.some((notice) => notice.includes('Session authorization is no longer valid')),
    'restart ends admission visibly',
  );
  assert.ok(
    await host.evaluate(() =>
      window.active.session.doc.getText('acceptance').toString().includes('offline-signaling'),
    ),
  );
  await Promise.all(pages.slice(1).map((page) => page.evaluate(() => window.active.close())));
  await host.evaluate(() => window.active.close());
  assert.equal((await metrics()).sessions, 0);
  await waitFor(
    async () => allocations(await turnMetrics()) === 0,
    'leave/restart closes real TURN allocations',
    15_000,
  );
  await writeFile(resolve(directory, 'cleanup-metrics.txt'), await turnMetrics());
  console.log(
    'PASS: signaling process outage preserves peer traffic and local content; restart has no stored sessions.',
  );
} finally {
  for (const socket of sockets) socket.terminate();
  await browser?.close();
  for (const child of children) child.kill();
  execFileSync('docker', ['rm', '-f', turnName], { stdio: 'pipe' });
}
