import { describe, expect, it } from 'vitest';
import { parseInvitation, validateBootstrap, websocketBaseUrl } from './index';

describe('bootstrap contract', () => {
  const valid = { protocolVersion: 1, token: 'a'.repeat(64), participantLimit: null };
  it('represents unlimited participants as null', () => {
    expect(validateBootstrap(valid).participantLimit).toBeNull();
  });
  it('rejects incompatible versions and invalid credentials', () => {
    expect(() => validateBootstrap({ ...valid, protocolVersion: 2 })).toThrow('Incompatible');
    expect(() => validateBootstrap({ ...valid, token: 'weak' })).toThrow('credential');
  });
  it('accepts positive optional limits and rejects magic/invalid limits', () => {
    expect(validateBootstrap({ ...valid, participantLimit: 10 }).participantLimit).toBe(10);
    for (const participantLimit of [0, -1, 1.5, '100', undefined]) {
      expect(() => validateBootstrap({ ...valid, participantLimit })).toThrow('limit');
    }
  });
});

describe('session invitation and transport', () => {
  const fragment = `#session=${'b'.repeat(32)}&invite=${'a'.repeat(64)}`;
  it('separates the URL fragment credential from the request address', () => {
    expect(parseInvitation(`http://192.168.1.20:4445/${fragment}`)).toEqual({
      hostUrl: 'http://192.168.1.20:4445',
      sessionId: 'b'.repeat(32),
      token: 'a'.repeat(64),
    });
  });
  it('rejects public, wildcard, malformed and credential-bearing request URLs', () => {
    for (const address of [
      'http://8.8.8.8/',
      'http://0.0.0.0/',
      'http://localhost/',
      'http://user:pass@192.168.1.20/',
      'http://192.168.1.20/path',
      'http://192.168.1.20/?token=secret',
    ]) {
      expect(() => parseInvitation(`${address}${fragment}`)).toThrow();
    }
    expect(() => parseInvitation('http://192.168.1.20/#invite=weak')).toThrow();
  });
  it('allows HTTPS internet invitations and uses encrypted WebSockets', () => {
    const target = parseInvitation(`https://session.example.com/${fragment}`);
    expect(target.hostUrl).toBe('https://session.example.com');
    expect(websocketBaseUrl(target.hostUrl)).toBe('wss://session.example.com/ws');
    expect(websocketBaseUrl('http://127.0.0.1:4445')).toBe('ws://127.0.0.1:4445/ws');
    expect(() => parseInvitation(`http://session.example.com/${fragment}`)).toThrow();
    expect(() => parseInvitation(`wss://session.example.com/${fragment}`)).toThrow();
    expect(() => websocketBaseUrl('file:///session')).toThrow();
  });
});
