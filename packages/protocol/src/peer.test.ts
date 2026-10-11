import { describe, expect, it } from 'vitest';
import { decodePeerCode, encodePeerCode, validateIceServerUrl, type PeerCode } from './peer';

const now = 1_000_000;
const offer: PeerCode = {
  version: 1,
  kind: 'offer',
  sessionId: 'a'.repeat(32),
  connectionId: 'b'.repeat(32),
  invite: 'c'.repeat(64),
  clientId: 42,
  expiresAt: now + 600_000,
  sdp: `v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ${Array(32).fill('AB').join(':')}\r\na=sctp-port:5000\r\n`,
};

describe('peer invitation boundary', () => {
  it('roundtrips the encrypted connection identity and requires the expected kind', () => {
    const code = encodePeerCode(offer);
    expect(decodePeerCode(` ${code}\n`, 'offer', now)).toEqual(offer);
    expect(() => decodePeerCode(code, 'answer', now)).toThrow('guest response');
    expect(decodePeerCode(encodePeerCode({ ...offer, kind: 'answer' }), 'answer', now)).toEqual({
      ...offer,
      kind: 'answer',
    });
  });
  it('rejects expired, malformed, incompatible, and unpinned connections', () => {
    for (const change of [
      { expiresAt: now },
      { expiresAt: now + 700_000 },
      { version: 2 },
      { invite: 'secret' },
      { clientId: -1 },
      { clientId: 2 ** 32 },
      { sdp: offer.sdp.replace('fingerprint', 'missing') },
    ])
      expect(() =>
        decodePeerCode(encodePeerCode({ ...offer, ...change } as PeerCode), 'offer', now),
      ).toThrow();
    expect(() => decodePeerCode('veil-p2p:v1:garbage', 'offer', now)).toThrow();
    expect(() => encodePeerCode({ ...offer, sdp: 'x'.repeat(100_000) })).toThrow('too large');
  });
  it('accepts configurable STUN and authenticated TURN endpoints without URL credentials', () => {
    expect(validateIceServerUrl('stun:192.0.2.1:3478', 'stun')).toBe('stun:192.0.2.1:3478');
    expect(validateIceServerUrl('turns:[2001:db8::1]:5349?transport=tcp', 'turn')).toContain(
      '5349',
    );
    for (const value of [
      'https://example.com',
      'turn:user:password@example.com',
      'turn:example.com:0',
      'turn:example.com:99999',
    ])
      expect(() => validateIceServerUrl(value, 'turn')).toThrow();
    expect(() => validateIceServerUrl('stun:example.com', 'turn')).toThrow();
  });
});
