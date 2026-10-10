import { describe, expect, it } from 'vitest';
import {
  createShareIdentity,
  createExchange,
  decodeShareLink,
  encodeShareLink,
  establishLink,
  signHandshake,
  verifyHandshake,
  type ShareInvitation,
  type ShareHandshake,
} from './sharing';
import { SignalCipher, randomSecret, invitationKeys } from './signaling';

async function fixture() {
  const signing = await createShareIdentity();
  const host = await createExchange(),
    guest = await createExchange();
  const group: ShareInvitation = {
    version: 4,
    server: 'https://signal.example.com',
    sessionId: randomSecret(16),
    groupId: randomSecret(16),
    secret: randomSecret(),
    hostClientId: 1,
    hostPublic: signing.publicKey,
  };
  const handshake: ShareHandshake = {
    version: 1,
    sessionId: group.sessionId,
    groupId: group.groupId,
    inviteId: randomSecret(16),
    hostClientId: 1,
    guestClientId: 2,
    guestPublic: guest.publicKey,
    hostExchange: host.publicKey,
  };
  return { signing, host, guest, group, handshake };
}
describe('reusable sharing authentication', () => {
  it('round trips app links and rejects arbitrary URLs, malformed keys and remote plaintext', async () => {
    const { group } = await fixture();
    expect(decodeShareLink(encodeShareLink(group))).toEqual(group);
    for (const link of [
      'https://example.com',
      'veil://other/abc',
      encodeShareLink(group) + '?redirect=x',
      encodeShareLink({ ...group, server: 'http://example.com' }),
      encodeShareLink({ ...group, hostPublic: 'invalid' }),
    ])
      expect(() => decodeShareLink(link)).toThrow();
  });
  it('pins the host and authenticates both identities and exchange keys', async () => {
    const { signing, group, handshake } = await fixture();
    const signature = await signHandshake(signing.privateKey, handshake);
    await verifyHandshake(group, handshake, signature);
    await expect(
      verifyHandshake(group, { ...handshake, guestClientId: 3 }, signature),
    ).rejects.toThrow();
    await expect(
      verifyHandshake(group, { ...handshake, inviteId: randomSecret(16) }, signature),
    ).rejects.toThrow();
    const attacker = await createShareIdentity();
    await expect(
      verifyHandshake(group, handshake, await signHandshake(attacker.privateKey, handshake)),
    ).rejects.toThrow('Host authentication failed');
  });
  it('derives matching per-link keys, rejects another guest, shared-root keys and replay', async () => {
    const { group, handshake, host, guest } = await fixture();
    const h = await establishLink(group, handshake, host.privateKey, guest.publicKey);
    const g = await establishLink(group, handshake, guest.privateKey, host.publicKey);
    expect(h.invite.secret).toBe(g.invite.secret);
    const sender = new SignalCipher(h.invite, h.keys),
      receiver = new SignalCipher(g.invite, g.keys);
    const envelope = await sender.seal('host', 1, { kind: 'offer', sdp: 'authenticated' });
    expect(await receiver.open(envelope, 'host')).toEqual({ kind: 'offer', sdp: 'authenticated' });
    await expect(receiver.open(envelope, 'host')).rejects.toThrow('replayed');
    const other = await createExchange();
    const wrong = await establishLink(group, handshake, other.privateKey, host.publicKey);
    await expect(
      new SignalCipher(wrong.invite, wrong.keys).open(envelope, 'host'),
    ).rejects.toThrow();
    const bootstrap = { ...h.invite, secret: group.secret };
    await expect(
      new SignalCipher(bootstrap, await invitationKeys(bootstrap)).open(envelope, 'host'),
    ).rejects.toThrow();
    const another = await establishLink(
      group,
      { ...handshake, inviteId: randomSecret(16) },
      host.privateKey,
      guest.publicKey,
    );
    expect(another.invite.secret).not.toBe(h.invite.secret);
  });
});
