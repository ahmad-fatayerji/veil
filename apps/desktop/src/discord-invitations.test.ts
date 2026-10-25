import { describe, expect, it } from 'vitest';
import {
  DiscordInvitationPolicy,
  discordJoinPayload,
  type DiscordInvitationDocument,
} from './discord-invitations';

const code = 'AAAAAAAAAAAAAAAAAAAAAA';
const document = (id: string, server = 'veil.ahmadfatayerji.com'): DiscordInvitationDocument => ({
  id,
  host: true,
  link: `veil://join/${server}/${code}`,
});

describe('Discord invitation payload boundary', () => {
  it('passes the existing official-server link through without a resolver or format change', () => {
    const link = document('notes').link;
    expect(link.length).toBe(58);
    expect(discordJoinPayload(link)).toEqual({ ok: true, value: link });
  });

  it('accepts 128 ASCII characters and rejects longer valid self-hosted links without truncation', () => {
    // DNS label lengths remain valid at both boundaries.
    const fits = document('notes', `${'a'.repeat(60)}.${'b'.repeat(28)}.com`).link;
    const longer = document('notes', `${'a'.repeat(60)}.${'b'.repeat(29)}.com`).link;
    expect(fits.length).toBe(128);
    expect(discordJoinPayload(fits)).toEqual({ ok: true, value: fits });
    expect(discordJoinPayload(longer)).toMatchObject({ ok: false, reason: 'too-long' });
    expect(longer.endsWith(code)).toBe(true);
  });

  it.each([
    'https://example.com/notes',
    `veil://join/http%3A%2F%2F127.0.0.1%3A3210/${code}`,
    `veil://join/person%3Apassword%40example.com/${code}`,
    `veil://join/example.com/${code}?redirect=other`,
    ` ${document('notes').link} `,
    'veil://join/example.com/invalid',
  ])('rejects an invalid, noncanonical or development payload: %s', (link) => {
    expect(discordJoinPayload(link)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('session-only Discord invitation consent', () => {
  it('starts off and never enables a document through reconciliation', () => {
    const policy = new DiscordInvitationPolicy();
    policy.reconcile(document('first'));
    policy.reconcile(document('second'));
    expect(policy.current).toBeNull();
  });

  it('keeps one explicit document selected across other tab updates', () => {
    const policy = new DiscordInvitationPolicy();
    policy.enable(document('first'));
    const first = policy.current!;
    policy.reconcile(document('second'));
    expect(policy.isCurrent(first)).toBe(true);
    policy.enable(document('second'));
    expect(policy.current?.documentId).toBe('second');
    expect(policy.isCurrent(first)).toBe(false);
    policy.disable('first');
    expect(policy.current?.documentId).toBe('second');
  });

  it('invalidates queued sends when a host resets or stops the existing link', () => {
    const policy = new DiscordInvitationPolicy();
    const first = document('first');
    policy.enable(first);
    const queued = policy.current!;
    policy.reconcile({ ...first, link: `veil://join/example.com/BBBBBBBBBBBBBBBBBBBBBA` });
    expect(policy.current).toBeNull();
    expect(policy.isCurrent(queued)).toBe(false);
    policy.enable(first);
    policy.reconcile({ ...first, link: '' });
    expect(policy.current).toBeNull();
  });

  it('clears consent on disconnect/close without restoring previously queued work', () => {
    const policy = new DiscordInvitationPolicy();
    policy.enable(document('first'));
    const queued = policy.current!;
    policy.disable();
    policy.enable(document('first'));
    expect(policy.isCurrent(queued)).toBe(false);
    expect(new DiscordInvitationPolicy().current).toBeNull();
  });

  it('reuses the current selection and changes join privacy without a new generation', () => {
    const policy = new DiscordInvitationPolicy();
    expect(policy.use(document('first'))).toBe(true);
    const first = policy.current!;
    expect(first.publicJoin).toBe(true);
    expect(policy.use(document('first'))).toBe(false);
    expect(policy.setPublicJoin('first', false)).toBe(true);
    expect(policy.current).toMatchObject({ generation: first.generation, publicJoin: false });
    expect(policy.isCurrent(first)).toBe(true);
    expect(policy.setPublicJoin('second', false)).toBe(false);
    expect(policy.use(document('second'))).toBe(true);
    expect(policy.current).toMatchObject({ documentId: 'second', publicJoin: true });
    expect(policy.isCurrent(first)).toBe(false);
  });

  it('rejects guest re-sharing and does not replace working consent on invalid input', () => {
    const policy = new DiscordInvitationPolicy();
    policy.enable(document('first'));
    const selected = policy.current!;
    expect(() => policy.enable({ ...document('guest'), host: false })).toThrow('Only the host');
    expect(() => policy.enable({ ...document('invalid'), link: '' })).toThrow();
    expect(policy.isCurrent(selected)).toBe(true);
    policy.reconcile({ ...document('first'), host: false });
    expect(policy.current).toBeNull();
  });
});
