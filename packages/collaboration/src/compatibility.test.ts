import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { joinShareLink, type SignalingTransport } from './automatic';
import {
  createExchange,
  createShareIdentity,
  encodeShareLink,
  invitationKeys,
  linkInvitation,
  signCompatibility,
  signHandshake,
  SignalCipher,
  type ShareInvitation,
  type ShareHandshake,
  type SignalEnvelope,
} from '@veil/protocol';
const client = { appVersion: '0.5.0', serverProtocols: [2], peerProtocols: [1] };
beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', class {});
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {});
});
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const signing = await createShareIdentity();
  const group: ShareInvitation = {
    version: 4,
    server: 'https://example.test',
    sessionId: 'a'.repeat(32),
    groupId: 'b'.repeat(32),
    secret: 'c'.repeat(64),
    hostClientId: 1,
    hostPublic: signing.publicKey,
  };
  const requests: string[] = [],
    sends: SignalEnvelope[] = [];
  let body: Record<string, unknown> = {};
  let receive: (message: unknown) => void = () => {};
  let signedHost = client;
  const confirm = vi.fn(async (message: string) => {
    expect(message).not.toBe('');
    return true;
  });
  const transport: SignalingTransport = {
    compatibility: { client: async () => client, confirm, warning: vi.fn() },
    request: async (_server, path, _method, payload) => {
      requests.push(path);
      if (path === '/v2/capabilities') return { compatibility: 1, serverProtocols: [2] };
      if (path === '/v3/compatibility')
        return { hostClientId: 1, hostCompatibility: client, serverProtocol: 2, peerProtocol: 1 };
      if (path === '/v3/join') {
        body = payload as Record<string, unknown>;
        return { ticket: 'd'.repeat(64), hostClientId: 1, hostCompatibility: client, stunUrls: [] };
      }
      return {};
    },
    connect: vi.fn(
      async (
        _server: string,
        _session: string,
        _ticket: string,
        callback: (message: unknown) => void,
      ) => {
        receive = callback;
        callback({ kind: 'ready' });
      },
    ),
    send: async (envelope) => {
      sends.push(envelope);
      if (!envelope.bootstrap) return;
      const exchange = await createExchange();
      const handshake: ShareHandshake = {
        version: 1,
        sessionId: group.sessionId,
        groupId: group.groupId,
        inviteId: body.inviteId as string,
        hostClientId: 1,
        guestClientId: body.clientId as number,
        guestPublic: body.guestPublic as string,
        hostExchange: exchange.publicKey,
      };
      const invite = linkInvitation(group, handshake.inviteId);
      const cipher = new SignalCipher(invite, await invitationKeys(invite));
      const payload = {
        handshake,
        signature: await signHandshake(signing.privateKey, handshake),
        hostCompatibility: signedHost,
        compatibilitySignature: await signCompatibility(signing.privateKey, handshake, signedHost),
      };
      receive({
        kind: 'signal',
        envelope: { ...(await cipher.seal('host', 0, payload)), bootstrap: true },
      });
    },
    disconnect: vi.fn(async () => {}),
  };
  return {
    transport,
    requests,
    sends,
    confirm,
    code: encodeShareLink(group),
    changeHost: () => {
      signedHost = { ...client, appVersion: '0.4.0' };
    },
  };
}
it('cancels unknown compatibility before admission without sending extension fields to old servers', async () => {
  const f = await fixture();
  f.transport.request = async (_server, path) => {
    f.requests.push(path);
    return {};
  };
  f.confirm.mockResolvedValue(false);
  await expect(joinShareLink(f.code, 'Guest', f.transport, () => {})).rejects.toThrow('cancelled');
  expect(f.requests).toEqual(['/v2/capabilities']);
  expect(f.transport.connect).not.toHaveBeenCalled();
});
it('blocks unsupported server generations before preflight or admission', async () => {
  const f = await fixture();
  f.transport.request = async (_server, path) => {
    f.requests.push(path);
    return { compatibility: 1, serverProtocols: [3] };
  };
  await expect(joinShareLink(f.code, 'Guest', f.transport, () => {})).rejects.toThrow(
    'incompatible',
  );
  expect(f.requests).toEqual(['/v2/capabilities']);
  expect(f.transport.connect).not.toHaveBeenCalled();
});
it('renews confirmation for changed signed host metadata before sending final signaling', async () => {
  const f = await fixture();
  f.changeHost();
  let decide: (value: boolean) => void = () => {};
  f.confirm.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        decide = resolve;
      }),
  );
  const joining = joinShareLink(f.code, 'Guest', f.transport, () => {});
  // Attach rejection handling immediately while confirmation is pending.
  const result = expect(joining).rejects.toThrow('cancelled');
  await vi.waitFor(() =>
    expect(f.confirm).toHaveBeenCalledWith(expect.stringContaining('changed')),
  );
  expect(f.sends.every((envelope) => envelope.bootstrap)).toBe(true);
  decide(false);
  await result;
  expect(f.requests).toContain('/v2/leave');
  expect(f.transport.disconnect).toHaveBeenCalled();
});
it('joins matching authenticated versions without a warning prompt', async () => {
  const f = await fixture();
  const joined = await joinShareLink(f.code, 'Guest', f.transport, () => {});
  try {
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.sends.some((envelope) => !envelope.bootstrap)).toBe(true);
  } finally {
    await joined.close();
  }
});

it('allows confirmed legacy servers while retaining their original request shapes', async () => {
  const f = await fixture();
  const request = f.transport.request;
  f.transport.request = async (server, path, method, body, ticket) => {
    if (path === '/v2/capabilities') return {};
    expect(path).not.toBe('/v3/compatibility');
    if (path === '/v3/join') expect(body).not.toHaveProperty('compatibility');
    return request(server, path, method, body, ticket);
  };
  const joined = await joinShareLink(f.code, 'Guest', f.transport, () => {});
  try {
    expect(f.confirm).toHaveBeenCalledTimes(1);
    expect(f.confirm).toHaveBeenCalledWith(expect.stringContaining('could not be verified'));
    expect(f.transport.compatibility?.warning).toHaveBeenLastCalledWith(
      'Server compatibility could not be verified.',
    );
  } finally {
    await joined.close();
  }
});
it('asks about supported version differences before issuing an admission request', async () => {
  const f = await fixture();
  const request = f.transport.request;
  f.transport.request = async (server, path, method, body, ticket) => {
    const response = await request(server, path, method, body, ticket);
    return path === '/v3/compatibility'
      ? { ...(response as object), hostCompatibility: { ...client, appVersion: '0.4.0' } }
      : response;
  };
  f.confirm.mockResolvedValue(false);
  await expect(joinShareLink(f.code, 'Guest', f.transport, () => {})).rejects.toThrow('cancelled');
  expect(f.confirm).toHaveBeenCalledWith(
    expect.stringContaining('Some features may not work properly'),
  );
  expect(f.requests).not.toContain('/v3/join');
  expect(f.transport.connect).not.toHaveBeenCalled();
});
