import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as protocol from '@veil/protocol';
import { createPeerSession } from './peer';
import {
  joinShareLink,
  shareDocument,
  type AutomaticSession,
  type SignalingTransport,
} from './automatic';
import {
  createExchange,
  decodeShortLink,
  decryptShortInvitation,
  encryptShortInvitation,
  encodeServerInvitation,
  encodeShareLink,
  invitationKeys,
  linkInvitation,
  SignalCipher,
  verifyAdmissionStatus,
  verifyHandshake,
  type AdmissionStatus,
  type ShareHandshake,
  type SignalEnvelope,
} from '@veil/protocol';

const sessions: AutomaticSession[] = [];
beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', class {});
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {});
});
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture() {
  let receive: (value: unknown) => void = () => {};
  const sent: SignalEnvelope[] = [];
  const registrations: Record<string, unknown>[] = [];
  const decisions: Record<string, unknown>[] = [];
  let failReset = false;
  const transport: SignalingTransport = {
    request: async (_server, path, method, body) => {
      if (path === '/v2/capabilities') return { groupSharing: 1, shortInvitations: 1 };
      if (path === '/v2/sessions')
        return { ticket: 'a'.repeat(64), sessionId: 'b'.repeat(32), stunUrls: [] };
      if (path.endsWith('/sharing') && method === 'POST') {
        if (failReset) throw new Error('Registration failed');
        registrations.push(body as Record<string, unknown>);
      }
      if (path === '/v3/admission/decision') {
        decisions.push(body as Record<string, unknown>);
        const rejection = (body as { rejection?: SignalEnvelope }).rejection;
        if (rejection) sent.push(rejection);
      }
      return {};
    },
    connect: async (_server, _id, _ticket, callback) => {
      receive = callback;
    },
    send: async (value) => {
      sent.push(value);
    },
    disconnect: async () => {},
  };
  const host = await shareDocument(
    createPeerSession('host', 'Host'),
    'https://share.example.com',
    'Host',
    transport,
    () => {},
  );
  sessions.push(host);
  const originalLink = host.sharedLink;
  const group = await decryptShortInvitation(
    decodeShortLink(originalLink),
    registrations[0].shortInvitation,
  );
  async function guest(id: string, clientId = 123, waitForApproval = true) {
    const exchange = await createExchange();
    const cipher = new SignalCipher(
      linkInvitation(group, id),
      await invitationKeys(linkInvitation(group, id)),
    );
    receive({
      kind: 'admitted',
      inviteId: id,
      groupId: group.groupId,
      clientId,
      guestPublic: exchange.publicKey,
    });
    if (host.joinMode === 'approval' && waitForApproval)
      await vi.waitFor(() => {
        expect(host.pendingGuests.some((p) => p.id === id)).toBe(true);
        expect(sent.some((e) => e.inviteId === id)).toBe(true);
      });
    return {
      cipher,
      admitted: () =>
        receive({
          kind: 'admitted',
          inviteId: id,
          groupId: group.groupId,
          clientId,
          guestPublic: exchange.publicKey,
        }),
      hello: async (name = 'Alex') =>
        receive({
          kind: 'signal',
          envelope: {
            ...(await cipher.seal('guest', 0, { kind: 'handshake', clientId, name })),
            bootstrap: true,
          },
        }),
    };
  }
  return {
    host,
    group,
    sent,
    decisions,
    transport,
    originalLink,
    guest,
    receive,
    fail: () => {
      failReset = true;
    },
  };
}
it('withholds the signed handshake until approval and admits waiting guests when switching to auto', async () => {
  const f = await fixture();
  await f.host.setJoinMode('approval');
  const id = 'c'.repeat(32);
  const guest = await f.guest(id);
  await guest.hello();
  await vi.waitFor(() => expect(f.host.pendingGuests[0].name).toBe('Alex'));
  expect(f.decisions).toEqual([]);
  const waiting = (await guest.cipher.open(f.sent[0], 'host')) as {
    status: AdmissionStatus;
    signature: string;
  };
  await verifyAdmissionStatus(f.group, waiting.status, waiting.signature);
  expect(waiting.status.state).toBe('waiting');
  await f.host.setJoinMode('auto');
  guest.admitted();
  const previousSends = f.sent.length;
  await guest.hello();
  await vi.waitFor(() => expect(f.sent.length).toBeGreaterThan(previousSends));
  expect(f.decisions).toEqual([{ sessionId: f.group.sessionId, inviteId: id, approve: true }]);
  let handshake: { handshake: ShareHandshake; signature: string } | undefined;
  for (const envelope of f.sent.slice(1)) {
    const payload = (await guest.cipher.open(envelope, 'host')) as {
      handshake?: ShareHandshake;
      signature: string;
    };
    if (payload.handshake)
      handshake = { handshake: payload.handshake, signature: payload.signature };
  }
  expect(handshake).toBeDefined();
  await verifyHandshake(f.group, handshake!.handshake, handshake!.signature);
  expect(f.host.pendingGuests).toEqual([]);
  expect(f.host.sharedLink).toBe(f.originalLink);
});
it('waits for a validated guest handshake before automatically admitting an existing registration', async () => {
  const f = await fixture();
  await f.host.setJoinMode('approval');
  const guest = await f.guest('6'.repeat(32));
  await f.host.setJoinMode('auto');
  expect(f.decisions).toEqual([]);
  expect(f.host.pendingGuests).toEqual([]);
  await guest.hello();
  await vi.waitFor(() => expect(f.decisions[0]?.approve).toBe(true));
});

it('uses the latest mode if it changes while admission keys are being prepared', async () => {
  const f = await fixture();
  await f.host.setJoinMode('approval');
  const exchange = await createExchange();
  const original = protocol.createExchange;
  let release!: (exchange: Awaited<ReturnType<typeof createExchange>>) => void;
  const preparing = vi.spyOn(protocol, 'createExchange');
  preparing.mockImplementationOnce(original).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const guest = await f.guest('5'.repeat(32), 123, false);
  await vi.waitFor(() => expect(preparing).toHaveBeenCalledTimes(2));
  await f.host.setJoinMode('auto');
  release(exchange);
  await guest.hello();
  await vi.waitFor(() => expect(f.decisions[0]?.approve).toBe(true));
  expect(f.host.pendingGuests).toEqual([]);
  expect(f.sent).toHaveLength(1);
  const payload = (await guest.cipher.open(f.sent[0], 'host')) as {
    handshake: ShareHandshake;
    signature: string;
    status?: AdmissionStatus;
  };
  expect(payload.status).toBeUndefined();
  await verifyHandshake(f.group, payload.handshake, payload.signature);
});

it('surfaces a failed server decision without blocking other auto admissions or guest retries', async () => {
  const f = await fixture();
  await f.host.setJoinMode('approval');
  const firstId = '4'.repeat(32);
  const first = await f.guest(firstId);
  const secondId = '3'.repeat(32);
  const second = await f.guest(secondId, 456);
  await first.hello('First');
  await second.hello('Second');
  await vi.waitFor(() =>
    expect(f.host.pendingGuests.map((p) => p.name)).toEqual(['First', 'Second']),
  );
  const request = f.transport.request;
  f.transport.request = async (server, path, method, body, ticket) => {
    if (path === '/v3/admission/decision' && (body as { inviteId: string }).inviteId === firstId)
      throw new Error('Server unavailable');
    return request(server, path, method, body, ticket);
  };
  await expect(f.host.setJoinMode('auto')).rejects.toThrow('Server unavailable');
  expect(f.host.joinMode).toBe('auto');
  expect(f.decisions).toEqual([
    { sessionId: f.group.sessionId, inviteId: secondId, approve: true },
  ]);
  f.transport.request = request;
  await first.hello('First');
  await vi.waitFor(() => expect(f.decisions).toHaveLength(2));
  expect(f.decisions[1]).toEqual({
    sessionId: f.group.sessionId,
    inviteId: firstId,
    approve: true,
  });
});
it('shows the latest name when a waiting guest resends the join request', async () => {
  const f = await fixture();
  await f.host.setJoinMode('approval');
  const id = '9'.repeat(32);
  const guest = await f.guest(id);
  await guest.hello();
  await vi.waitFor(() => expect(f.host.pendingGuests[0].name).toBe('Alex'));
  await guest.hello('Sam');
  await vi.waitFor(() => expect(f.host.pendingGuests[0].name).toBe('Sam'));
  expect(f.host.pendingGuests).toHaveLength(1);
  expect(f.decisions).toEqual([]);
});
it('automatically approves new requests in auto mode without creating a peer before the guest handshake', async () => {
  const f = await fixture();
  const guest = await f.guest('d'.repeat(32));
  expect(f.decisions).toEqual([]);
  expect(f.sent).toEqual([]);
  await guest.hello();
  await vi.waitFor(() => expect(f.decisions[0]?.approve).toBe(true));
  await vi.waitFor(() => expect(f.sent.length).toBe(1));
  const payload = (await guest.cipher.open(f.sent[0], 'host')) as {
    handshake: ShareHandshake;
    signature: string;
  };
  await verifyHandshake(f.group, payload.handshake, payload.signature);
});
it('resends authenticated handshakes without an approval prompt for duplicate auto-join requests', async () => {
  const f = await fixture();
  const guest = await f.guest('8'.repeat(32));
  await guest.hello();
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  guest.admitted();
  await guest.hello();
  await vi.waitFor(() => expect(f.sent).toHaveLength(2));
  for (const envelope of f.sent) {
    const payload = (await guest.cipher.open(envelope, 'host')) as {
      handshake: ShareHandshake;
      signature: string;
      status?: AdmissionStatus;
    };
    expect(payload.status).toBeUndefined();
    await verifyHandshake(f.group, payload.handshake, payload.signature);
  }
  expect(f.host.joinMode).toBe('auto');
  expect(f.host.pendingGuests).toEqual([]);
  expect(f.decisions).toHaveLength(1);
});
it('rejects pending guests with signed status and cancels the queue on reset and stop', async () => {
  const f = await fixture();
  await f.host.setJoinMode('approval');
  const id = 'e'.repeat(32);
  const guest = await f.guest(id);
  await f.host.rejectGuest(id);
  await guest.cipher.open(f.sent[0], 'host');
  const payload = (await guest.cipher.open(f.sent[1], 'host')) as {
    status: AdmissionStatus;
    signature: string;
  };
  await verifyAdmissionStatus(f.group, payload.status, payload.signature);
  expect(payload.status.state).toBe('rejected');
  expect(f.decisions.at(-1)?.approve).toBe(false);
  await f.guest('f'.repeat(32));
  expect(await f.host.enableSharing(true)).not.toBe(f.originalLink);
  expect(f.host.pendingGuests).toEqual([]);
  expect(f.host.joinMode).toBe('approval');
  await f.host.stopSharing();
  expect(f.host.sharedLink).toBe('');
});
it('preserves the previous link and pending requests after a failed reset and rejects expired requests', async () => {
  const f = await fixture();
  await f.host.setJoinMode('approval');
  const id = 'e'.repeat(32);
  await f.guest(id);
  f.fail();
  await expect(f.host.enableSharing(true)).rejects.toThrow('Registration failed');
  expect(f.host.sharedLink).toBe(f.originalLink);
  expect(f.host.pendingGuests).toHaveLength(1);
  const deadline = f.host.pendingGuests[0].deadline;
  vi.spyOn(Date, 'now').mockReturnValue(deadline + 1);
  await f.host.approveGuest(id);
  expect(f.decisions.at(-1)?.approve).toBe(false);
  expect(f.host.pendingGuests).toEqual([]);
});
it('does not resolve or admit a cancelled short-link join', async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  const request = vi.spyOn(f.transport, 'request');
  await expect(
    joinShareLink(f.originalLink, 'Guest', f.transport, () => {}, false, controller.signal),
  ).rejects.toThrow('cancelled');
  expect(request).not.toHaveBeenCalled();
});

it('checks the resolved short-link session before requesting admission or opening a guest socket', async () => {
  const f = await fixture();
  const encrypted = await encryptShortInvitation(f.group, decodeShortLink(f.originalLink).code);
  const paths: string[] = [];
  f.transport.request = async (_server, path) => {
    paths.push(path);
    if (path === '/v2/capabilities') return { shortInvitations: 1 };
    if (path === '/v3/invitations/resolve') return encrypted.record;
    throw new Error('Unexpected request');
  };
  const connect = vi.spyOn(f.transport, 'connect');
  const started = vi.fn();
  const beforeJoin = vi.fn((invite: { server: string; sessionId: string }) => {
    expect(invite.sessionId).toBe(f.group.sessionId);
    expect(invite.server).toBe(f.group.server);
    throw new Error('Session already open');
  });
  await expect(
    joinShareLink(
      f.originalLink,
      'Guest',
      f.transport,
      () => {},
      false,
      undefined,
      started,
      beforeJoin,
    ),
  ).rejects.toThrow('Session already open');
  expect(paths).toEqual(['/v2/capabilities', '/v3/invitations/resolve']);
  expect(beforeJoin).toHaveBeenCalledOnce();
  expect(started).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

it('checks retained long and legacy invitations before any server request', async () => {
  const f = await fixture();
  const request = vi.spyOn(f.transport, 'request');
  const connect = vi.spyOn(f.transport, 'connect');
  for (const code of [
    encodeShareLink(f.group),
    encodeServerInvitation(linkInvitation(f.group, '7'.repeat(32))),
  ]) {
    const beforeJoin = vi.fn(() => {
      throw new Error('Session already open');
    });
    await expect(
      joinShareLink(code, 'Guest', f.transport, () => {}, false, undefined, undefined, beforeJoin),
    ).rejects.toThrow('Session already open');
    expect(beforeJoin).toHaveBeenCalledOnce();
  }
  expect(request).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

it('cleans up a ticket returned after cancellation during admission without opening a socket', async () => {
  const f = await fixture();
  const encrypted = await encryptShortInvitation(f.group, decodeShortLink(f.originalLink).code);
  const controller = new AbortController();
  let admitted: ((value: unknown) => void) | undefined;
  const paths: string[] = [];
  f.transport.request = async (_server, path) => {
    paths.push(path);
    if (path === '/v2/capabilities') return { shortInvitations: 1 };
    if (path === '/v3/invitations/resolve') return encrypted.record;
    if (path === '/v3/join')
      return new Promise((resolve) => {
        admitted = resolve;
      });
    return {};
  };
  const connect = vi.spyOn(f.transport, 'connect');
  const joining = joinShareLink(
    f.originalLink,
    'Guest',
    f.transport,
    () => {},
    false,
    controller.signal,
  );
  const rejected = expect(joining).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(admitted).toBeDefined());
  controller.abort();
  admitted!({ ticket: 'd'.repeat(64), hostClientId: f.group.hostClientId, stunUrls: [] });
  await rejected;
  expect(paths).toContain('/v2/leave');
  expect(connect).not.toHaveBeenCalled();
});
