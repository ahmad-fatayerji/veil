import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/signaling-v2.json';
import {
  SignalCipher,
  invitationKeys,
  decodeServerInvitation,
  encodeServerInvitation,
  type ServerInvitation,
} from './signaling';
const invitation = (): ServerInvitation => ({
  version: 2,
  server: 'https://signal.example.com',
  sessionId: 'a'.repeat(32),
  inviteId: 'b'.repeat(32),
  secret: 'c'.repeat(64),
  hostClientId: 1,
  expiresAt: Date.now() + 600_000,
});
describe('private signaling', () => {
  it('matches the public protocol HKDF fixture', async () => {
    expect((await invitationKeys({ ...invitation(), ...fixture })).admission).toEqual(
      fixture.admission,
    );
  });
  it('round trips one invitation and rejects expired/legacy/unsafe endpoints', () => {
    const i = invitation();
    expect(decodeServerInvitation(encodeServerInvitation(i))).toEqual(i);
    for (const bad of [
      { ...i, expiresAt: Date.now() - 1 },
      { ...i, server: 'http://example.com' },
      { ...i, server: 'https://user:pass@example.com' },
    ])
      expect(() => decodeServerInvitation(encodeServerInvitation(bad))).toThrow();
    expect(() => decodeServerInvitation('veil-p2p:v1:old')).toThrow('older');
  });
  it('authenticates connection metadata, rejects replay and domain separates keys', async () => {
    const i = invitation(),
      keys = await invitationKeys(i);
    expect(keys.admission).not.toEqual(i.secret);
    const sender = new SignalCipher(i, keys),
      receiver = new SignalCipher(i, keys);
    const packet = await sender.seal('host', 1, { sdp: 'fingerprint-bound' });
    await expect(receiver.open({ ...packet, generation: 2 }, 'host')).rejects.toThrow();
    await expect(receiver.open(packet, 'guest')).rejects.toThrow();
    expect(await receiver.open(packet, 'host')).toEqual({ sdp: 'fingerprint-bound' });
    await expect(receiver.open(packet, 'host')).rejects.toThrow();
    const other = { ...i, sessionId: 'd'.repeat(32) };
    await expect(
      new SignalCipher(other, await invitationKeys(other)).open(packet, 'host'),
    ).rejects.toThrow();
    await expect(
      new SignalCipher(i, keys).open(
        { ...packet, ciphertext: packet.ciphertext.slice(0, -4) + 'AAAA' },
        'host',
      ),
    ).rejects.toThrow();
  });
});
