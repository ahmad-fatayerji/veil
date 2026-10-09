import { describe, expect, it } from 'vitest';
import { validateBootstrap } from './index';

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
