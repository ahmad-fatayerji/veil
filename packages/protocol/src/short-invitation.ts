import { base64, normalizeServer, sha256 } from './signaling';
import { decodeShareLink, encodeShareLink, type ShareInvitation } from './sharing';

export interface ShortLink {
  server: string;
  code: string;
}
export interface EncryptedInvitation {
  reference: string;
  lookupHash: string;
  nonce: string;
  ciphertext: string;
}
const utf8 = (value: string) => new TextEncoder().encode(value);
const hex = (value: Uint8Array) =>
  Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('');
const url64 = (value: Uint8Array) =>
  base64(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function un64(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid Veil link.');
  const result = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  );
  if (url64(result) !== value) throw new Error('Invalid Veil link.');
  return result;
}
export function newShortCode() {
  return url64(crypto.getRandomValues(new Uint8Array(16)));
}
export function encodeShortLink(link: ShortLink) {
  // Full plaintext origins are encoded only for explicitly enabled loopback development.
  const authority = link.server.startsWith('http:') ? link.server : new URL(link.server).host;
  return `veil://join/${encodeURIComponent(authority)}/${link.code}`;
}
export function decodeShortLink(value: string, development = false): ShortLink {
  if (value.length > 4096) throw new Error('Invalid Veil link.');
  const trimmed = value.trim();
  const match = /^veil:\/\/join\/([^/?#]+)\/([A-Za-z0-9_-]{22})$/.exec(trimmed);
  if (!match) throw new Error('Invalid Veil link.');
  const authority = decodeURIComponent(match[1]);
  const server = normalizeServer(
    authority.startsWith('http://') ? authority : `https://${authority}`,
    development,
  );
  const code = match[2];
  if (un64(code).length !== 16 || encodeShortLink({ server, code }) !== trimmed)
    throw new Error('Invalid Veil link.');
  return { server, code };
}
export function parseShareLink(value: string, development = false): ShortLink | ShareInvitation {
  return value.trim().split('/').length === 5
    ? decodeShortLink(value, development)
    : decodeShareLink(value, development);
}
export async function shortLinkKeys(link: ShortLink) {
  const code = un64(link.code);
  if (code.length !== 16) throw new Error('Invalid Veil link.');
  const root = await crypto.subtle.importKey('raw', code, 'HKDF', false, ['deriveBits']);
  const derive = async (label: string) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: utf8(link.server),
          info: utf8(`veil.short-invitation.v1:${label}`),
        },
        root,
        256,
      ),
    );
  const reference = hex(await derive('reference'));
  const lookup = hex(await derive('lookup'));
  const key = await crypto.subtle.importKey('raw', await derive('encryption'), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  return {
    reference,
    lookup,
    key,
    aad: utf8(JSON.stringify(['veil.short-invitation.v1', link.server, reference])),
  };
}
export async function encryptShortInvitation(invite: ShareInvitation, code = newShortCode()) {
  const link = { server: invite.server, code };
  const keys = await shortLinkKeys(link);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: keys.aad },
      keys.key,
      utf8(encodeShareLink(invite)),
    ),
  );
  const record: EncryptedInvitation = {
    reference: keys.reference,
    lookupHash: await sha256(keys.lookup),
    nonce: url64(nonce),
    ciphertext: url64(ciphertext),
  };
  return { link: encodeShortLink(link), record };
}
export async function decryptShortInvitation(link: ShortLink, value: unknown, development = false) {
  if (!value || typeof value !== 'object') throw new Error('Invalid encrypted invitation.');
  const record = value as Record<string, unknown>;
  if (
    typeof record.nonce !== 'string' ||
    record.nonce.length !== 16 ||
    typeof record.ciphertext !== 'string' ||
    record.ciphertext.length > 8192
  )
    throw new Error('Invalid encrypted invitation.');
  const keys = await shortLinkKeys(link);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: un64(record.nonce), additionalData: keys.aad },
    keys.key,
    un64(record.ciphertext),
  );
  const invite = decodeShareLink(
    new TextDecoder('utf-8', { fatal: true }).decode(plain),
    development,
  );
  if (invite.server !== link.server) throw new Error('Invitation server does not match its link.');
  return invite;
}
