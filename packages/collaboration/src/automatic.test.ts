import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decodeServerInvitation, invitationKeys, SignalCipher } from '@veil/protocol';
import { AutomaticSession, type SignalingTransport } from './automatic';
import type { AutomaticCallbacks } from './peer';

let host: AutomaticSession;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('RTCPeerConnection', class {});
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {});
});
afterEach(async () => {
  await host?.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function fixture() {
  let receive!: (message: unknown) => void;
  const notice = vi.fn();
  const request = vi.fn(async (_server: string, path: string): Promise<object> => {
    if (path === '/v2/sessions')
      return { ticket: 'a'.repeat(64), sessionId: 'b'.repeat(32), stunUrls: [] };
    return {};
  });
  const send = vi.fn(async () => {});
  const transport: SignalingTransport = {
    request,
    send,
    connect: async (_server, _sessionId, _ticket, callback) => {
      receive = callback;
    },
    disconnect: async () => {},
  };
  host = new AutomaticSession('host', 'https://example.test', 'Host', transport, notice);
  await host.startHost();
  const invite = decodeServerInvitation(await host.createInvitation());
  const cipher = new SignalCipher(invite, await invitationKeys(invite));
  const callbacks: AutomaticCallbacks[] = [];
  const offer = vi
    .spyOn(host.session.provider, 'automaticOffer')
    .mockImplementation(async (_code, _remote, _servers, callback) => {
      callbacks.push(callback);
      return 'offer';
    });
  const close = vi.spyOn(host.session.provider, 'automaticClose');
  // Flush real WebCrypto and the serialized signaling queue without advancing deadlines.
  const flush = async () => {
    await vi.waitFor(() => expect(send).toHaveBeenCalled(), { interval: 0 });
  };
  const start = async () => {
    receive({ kind: 'admitted', inviteId: invite.inviteId, clientId: 7 });
    receive({
      kind: 'signal',
      envelope: await cipher.seal('guest', 0, { kind: 'request', clientId: 7 }),
    });
    await flush();
  };
  const leave = async () => {
    receive({ kind: 'left', inviteId: invite.inviteId });
    await vi.waitFor(() => expect(close).toHaveBeenCalled(), { interval: 0 });
  };
  return { request, send, notice, callbacks, offer, start, leave, transport, receive };
}

it('resumes a stalled host peer when signaling returns after its retry fired offline', async () => {
  const f = await fixture();
  await f.start();
  await vi.advanceTimersByTimeAsync(6_000);
  await vi.waitFor(() => expect(f.notice).toHaveBeenCalledWith('Invalid relay configuration.'));
  f.transport.connect = async () => {
    throw new Error('Offline');
  };
  f.receive({ kind: 'disconnected' });
  await vi.waitFor(() =>
    expect(f.notice).toHaveBeenCalledWith(
      'Signaling disconnected. Healthy peer connections continue; reconnecting automatically.',
    ),
  );
  await vi.advanceTimersByTimeAsync(3_000);
  expect(f.offer).toHaveBeenCalledTimes(1);
  f.transport.connect = async (_server, _sessionId, _ticket, receive) => {
    receive({ kind: 'ready' });
  };
  await vi.advanceTimersByTimeAsync(4_000);
  await vi.waitFor(() => expect(f.offer).toHaveBeenCalledTimes(2));
});

it('keeps a healthy peer transport when host signaling reconnects', async () => {
  const f = await fixture();
  await f.start();
  f.callbacks[0].synced();
  f.receive({ kind: 'ready' });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.offer).toHaveBeenCalledTimes(1);
});

it('does not negotiate or request relay for an unused invitation', async () => {
  const f = await fixture();
  await host.reconnect();
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(600_000);
  expect(f.offer).not.toHaveBeenCalled();
  expect(f.request.mock.calls.some(([, path]) => path === '/v2/relay')).toBe(false);
});

it.each(['resolve', 'reject'])(
  'ignores a relay grant that finishes after the guest leaves (%s)',
  async (outcome) => {
    const f = await fixture();
    await f.start();
    let resolve!: (value: object) => void;
    let reject!: (error: Error) => void;
    const grant = new Promise<object>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    f.request.mockImplementation(async (_server, path) => (path === '/v2/relay' ? grant : {}));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(f.request.mock.calls.some(([, path]) => path === '/v2/relay')).toBe(true);
    await f.leave();
    expect(f.notice).toHaveBeenLastCalledWith('No guests connected. Waiting for someone to join.');
    const notices = f.notice.mock.calls.length;
    const signals = f.send.mock.calls.length;
    if (outcome === 'resolve')
      resolve({
        urls: ['turn:example.test'],
        username: 'u',
        credential: 'c',
        expiresAt: Date.now() + 600_000,
      });
    else reject(new Error('No relay capacity'));
    // Deliver callbacks already queued by the old transport, too.
    f.callbacks[0].failed();
    f.callbacks[0].authenticated();
    f.callbacks[0].synced();
    await host.reconnect();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.offer).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(signals);
    expect(f.notice).toHaveBeenCalledTimes(notices);
    expect(f.request.mock.calls.filter(([, path]) => path === '/v2/relay')).toHaveLength(1);
  },
);

it('continues staged relay fallback for a guest still joining', async () => {
  const f = await fixture();
  await f.start();
  f.request.mockImplementation(async () => ({
    urls: ['turn:example.test'],
    username: 'u',
    credential: 'c',
    expiresAt: Date.now() + 600_000,
  }));
  await vi.advanceTimersByTimeAsync(6_000);
  await vi.waitFor(() => expect(f.offer).toHaveBeenCalledTimes(2), { interval: 0 });
  expect(f.request.mock.calls.filter(([, path]) => path === '/v2/relay')).toHaveLength(1);
});

it('discards an offer that finishes after the guest leaves during recovery', async () => {
  const f = await fixture();
  await f.start();
  f.callbacks[0].synced();
  let finish!: (sdp: string) => void;
  f.offer.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  f.callbacks[0].failed();
  await vi.waitFor(() => expect(f.offer).toHaveBeenCalledTimes(2), { interval: 0 });
  await f.leave();
  const signals = f.send.mock.calls.length;
  const notices = f.notice.mock.calls.length;
  finish('obsolete offer');
  await vi.advanceTimersByTimeAsync(600_000);
  expect(f.send).toHaveBeenCalledTimes(signals);
  expect(f.notice).toHaveBeenCalledTimes(notices);
  expect(f.offer).toHaveBeenCalledTimes(2);
  expect(f.request.mock.calls.some(([, path]) => path === '/v2/relay')).toBe(false);
});

it('cancels a queued peer retry when the guest leaves', async () => {
  const f = await fixture();
  await f.start();
  f.request.mockImplementation(async () => {
    throw new Error('No relay capacity');
  });
  await vi.advanceTimersByTimeAsync(6_000);
  await vi.waitFor(() => expect(f.notice).toHaveBeenCalledWith('No relay capacity'), {
    interval: 0,
  });
  await f.leave();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(f.offer).toHaveBeenCalledTimes(1);
  expect(f.request.mock.calls.filter(([, path]) => path === '/v2/relay')).toHaveLength(1);
});
