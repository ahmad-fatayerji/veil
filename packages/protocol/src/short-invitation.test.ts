import { describe, expect, it } from 'vitest';
import {
  createShareIdentity,
  encodeShareLink,
  signAdmissionStatus,
  verifyAdmissionStatus,
  type AdmissionStatus,
  type ShareInvitation,
} from './sharing';
import {
  decodeShortLink,
  decryptShortInvitation,
  encryptShortInvitation,
  encodeShortLink,
  newShortCode,
  parseShareLink,
  shortLinkKeys,
} from './short-invitation';

async function fixture() {
  const identity = await createShareIdentity();
  const invite: ShareInvitation = {
    version: 4,
    server: 'https://share.example.com',
    sessionId: 'a'.repeat(32),
    groupId: 'b'.repeat(32),
    secret: 'c'.repeat(64),
    hostClientId: 1,
    hostPublic: identity.publicKey,
  };
  return { identity, invite };
}
describe('short invitation boundary', () => {
  it('uses canonical 128-bit codes and short readable links, while accepting legacy links', async () => {
    const { invite } = await fixture();
    const code = newShortCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(atob(code.replaceAll('-', '+').replaceAll('_', '/'))).toHaveLength(16);
    const { link, record } = await encryptShortInvitation(invite, code);
    expect(link).toBe(`veil://join/share.example.com/${code}`);
    expect(link).toHaveLength(52);
    const parsed = decodeShortLink(link);
    expect(await decryptShortInvitation(parsed, record)).toEqual(invite);
    expect(parseShareLink(encodeShareLink(invite))).toEqual(invite);
    const keys = await shortLinkKeys(parsed);
    expect(keys.lookup).not.toBe(keys.reference);
    expect(JSON.stringify(record)).not.toContain(code);
    expect(JSON.stringify(record)).not.toContain(invite.secret);
  });
  it('rejects malformed codes, origins and URL components; gates loopback plaintext', () => {
    const code = 'AAAAAAAAAAAAAAAAAAAAAA';
    for (const link of [
      `veil://join/example.com/${code}?x=1`,
      `veil://join/example.com/${code}#key`,
      `veil://join/example.com/${code}/extra`,
      `veil://join/user%40example.com/${code}`,
      `veil://join/example.com/${code.slice(1)}`,
      `veil://join/example.com/AAAAAAAAAAAAAAAAAAAAAB`,
      `veil://join/example.com%2Fpath/${code}`,
      `veil://join/https%3A%2F%2Fexample.com/${code}`,
      `veil://join:80/example.com/${code}`,
      `veil://join/example.com/%`,
    ])
      expect(() => parseShareLink(link)).toThrow();
    const local = encodeShortLink({ server: 'http://127.0.0.1:8080', code });
    expect(() => decodeShortLink(local)).toThrow();
    expect(decodeShortLink(local, true).server).toBe('http://127.0.0.1:8080');
    const remote = encodeShortLink({ server: 'http://example.com', code });
    expect(() => decodeShortLink(remote, true)).toThrow();
    for (const server of ['https://example.com:8443', 'https://[::1]:8443'])
      expect(decodeShortLink(encodeShortLink({ server, code })).server).toBe(server);
  });
  it('authenticates the encrypted record, code and origin and bounds responses', async () => {
    const { invite } = await fixture();
    const encrypted = await encryptShortInvitation(invite);
    const link = decodeShortLink(encrypted.link);
    await expect(
      decryptShortInvitation({ ...link, code: newShortCode() }, encrypted.record),
    ).rejects.toThrow();
    await expect(
      decryptShortInvitation({ ...link, server: 'https://other.example.com' }, encrypted.record),
    ).rejects.toThrow();
    const changed =
      (encrypted.record.ciphertext[0] === 'A' ? 'B' : 'A') + encrypted.record.ciphertext.slice(1);
    await expect(
      decryptShortInvitation(link, { ...encrypted.record, ciphertext: changed }),
    ).rejects.toThrow();
    await expect(
      decryptShortInvitation(link, { ...encrypted.record, nonce: 'A'.repeat(15) }),
    ).rejects.toThrow();
    await expect(
      decryptShortInvitation(link, { ...encrypted.record, ciphertext: 'A'.repeat(8193) }),
    ).rejects.toThrow();
  });
  it('binds signed approval statuses to the guest, exchange key, admission and outcome', async () => {
    const { identity, invite } = await fixture();
    const status: AdmissionStatus = {
      version: 1,
      sessionId: invite.sessionId,
      groupId: invite.groupId,
      inviteId: 'd'.repeat(32),
      hostClientId: 1,
      guestClientId: 2,
      guestPublic: identity.publicKey,
      state: 'waiting',
      deadline: Date.now() + 120000,
    };
    const signature = await signAdmissionStatus(identity.privateKey, status);
    await verifyAdmissionStatus(invite, status, signature);
    for (const change of [
      { guestClientId: 3 },
      { guestPublic: 'other' },
      { inviteId: 'e'.repeat(32) },
      { state: 'rejected' as const },
      { deadline: status.deadline + 1 },
    ])
      await expect(
        verifyAdmissionStatus(invite, { ...status, ...change }, signature),
      ).rejects.toThrow();
  });
});
