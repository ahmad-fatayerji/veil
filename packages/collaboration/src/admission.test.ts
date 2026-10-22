import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  async function guest(id: string, clientId = 123) {
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
    if (host.joinMode === 'approval')
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
it('withholds the signed handshake until approval and preserves pending decisions when switching modes', async () => {
  const f = await fixture();
  f.host.setJoinMode('approval');
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
  f.host.setJoinMode('auto');
  guest.admitted();
  const previousSends = f.sent.length;
  await guest.hello();
  await vi.waitFor(() => expect(f.sent.length).toBeGreaterThan(previousSends));
  expect(f.decisions).toEqual([]);
  await f.host.approveGuest(id);
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
it('shows the latest name when a waiting guest resends the join request', async () => {
  const f = await fixture();
  f.host.setJoinMode('approval');
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
it('rejects pending guests with signed status and cancels the queue on reset and stop', async () => {
  const f = await fixture();
  f.host.setJoinMode('approval');
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
  f.host.setJoinMode('approval');
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
