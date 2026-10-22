import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capacityProblem, PUBLIC_LIMIT, sameServer, SERVER_FULL } from './capacity';

describe('capacity', () => {
  it('recognises only the exact native capacity messages', () => {
    expect(capacityProblem(SERVER_FULL)).toBe('full');
    expect(capacityProblem(PUBLIC_LIMIT)).toBe('limit');
    expect(capacityProblem('Server or relay capacity unavailable.')).toBeNull();
    expect(capacityProblem(`${SERVER_FULL} Extra`)).toBeNull();
  });

  it('matches the messages emitted by native networking', () => {
    const native = readFileSync(new URL('../src-tauri/src/networking.rs', import.meta.url), 'utf8');
    expect(native).toContain(JSON.stringify(SERVER_FULL));
    expect(native).toContain(JSON.stringify(PUBLIC_LIMIT));
  });

  it('compares server origins loosely', () => {
    const official = 'https://veil.ahmadfatayerji.com';
    expect(sameServer('https://veil.ahmadfatayerji.com/', official)).toBe(true);
    expect(sameServer(' HTTPS://VEIL.AHMADFATAYERJI.COM ', official)).toBe(true);
    expect(sameServer('https://signal.example.com', official)).toBe(false);
    expect(sameServer('', '')).toBe(false);
  });
});
