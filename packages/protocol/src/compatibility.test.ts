import { describe, it, expect } from 'vitest';
import {
  clientCompatibility,
  compatibilityWarning,
  requireServerCompatibility,
} from './compatibility';
const client = { appVersion: '0.5.0', serverProtocols: [2], peerProtocols: [1] };
describe('release compatibility', () => {
  it('distinguishes version differences from wire incompatibility', () => {
    expect(compatibilityWarning(client, client)).toBe('');
    expect(compatibilityWarning(client, { ...client, appVersion: '0.4.0' })).toContain(
      'Some features',
    );
    expect(compatibilityWarning(client, null)).toContain('could not be verified');
    expect(() => compatibilityWarning(client, { ...client, peerProtocols: [2] })).toThrow(
      'unsupported',
    );
    expect(() => requireServerCompatibility(client, [3])).toThrow('incompatible');
  });
  it('rejects malformed, unbounded, and duplicate generation declarations', () => {
    for (const value of [
      null,
      {},
      { ...client, appVersion: '<script>' },
      { ...client, peerProtocols: [] },
      { ...client, serverProtocols: [2, 2] },
      { ...client, peerProtocols: [0] },
      { ...client, peerProtocols: [1.5] },
      { ...client, peerProtocols: Array.from({ length: 9 }, (_, i) => i + 1) },
    ])
      expect(() => clientCompatibility(value)).toThrow('Invalid');
  });
});
