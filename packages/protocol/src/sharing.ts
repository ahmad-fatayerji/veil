import { clientCompatibility, type ClientCompatibility } from './compatibility';
import {
  base64,
  normalizeServer,
  randomSecret,
  invitationKeys,
  type ServerInvitation,
} from './signaling';

export interface ShareInvitation {
  version: 4;
  server: string;
  sessionId: string;
  groupId: string;
  secret: string;
  hostClientId: number;
  hostPublic: string;
}
export interface ShareHandshake {
  version: 1;
  sessionId: string;
  groupId: string;
  inviteId: string;
  hostClientId: number;
  guestClientId: number;
  guestPublic: string;
  hostExchange: string;
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const bytes = (value: string) => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid sharing key.');
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
};
export function decodeShareLink(value: string, development = false): ShareInvitation {
  if (value.length > 4096) throw new Error('Invalid Veil link.');
  const url = new URL(value.trim());
  if (
    url.protocol !== 'veil:' ||
    url.hostname !== 'join' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9_-]+$/.test(url.pathname)
  )
    throw new Error('Invalid Veil link.');
  const encoded = url.pathname.slice(1).replaceAll('-', '+').replaceAll('_', '/');
  const data = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes(encoded)),
  ) as ShareInvitation;
  if (
    data.version !== 4 ||
    !/^[a-f0-9]{32}$/.test(data.sessionId) ||
    !/^[a-f0-9]{32}$/.test(data.groupId) ||
    !/^[a-f0-9]{64}$/.test(data.secret) ||
    !Number.isSafeInteger(data.hostClientId) ||
    data.hostClientId < 0 ||
    data.hostClientId > 0xffffffff ||
    typeof data.hostPublic !== 'string' ||
    bytes(data.hostPublic).length !== 65 ||
    bytes(data.hostPublic)[0] !== 4
  )
    throw new Error('Invalid Veil link.');
  data.server = normalizeServer(data.server, development);
  return data;
}
export function encodeShareLink(invitation: ShareInvitation) {
  return (
    'veil://join/' +
    base64(encode(invitation)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  );
}
export async function createShareIdentity() {
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  return {
    privateKey: key.privateKey,
    publicKey: base64(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey))),
  };
}
export async function createExchange() {
  const key = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  return {
    privateKey: key.privateKey,
    publicKey: base64(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey))),
  };
}
export function linkInvitation(group: ShareInvitation, inviteId: string): ServerInvitation {
  return {
    version: 2,
    server: group.server,
    sessionId: group.sessionId,
    inviteId,
    secret: group.secret,
    hostClientId: group.hostClientId,
    expiresAt: Date.now() + 600_000,
  };
}
export async function shareAdmission(group: ShareInvitation) {
  return (await invitationKeys(linkInvitation(group, group.groupId))).admission;
}
// Canonical transcript binds both identities, both exchange keys, and the unique
// admission. The pinned signing key prevents an operator or another invite holder
// from substituting the host. ECDH keeps established link keys private to its peers.
export async function signHandshake(privateKey: CryptoKey, handshake: ShareHandshake) {
  return base64(
    new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encode(handshake)),
    ),
  );
}
export async function verifyHandshake(
  group: ShareInvitation,
  expected: ShareHandshake,
  signature: string,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    bytes(group.hostPublic),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  if (
    !(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      bytes(signature),
      encode(expected),
    ))
  )
    throw new Error('Host authentication failed. Ask the host for a new link.');
}
export async function establishLink(
  group: ShareInvitation,
  handshake: ShareHandshake,
  privateKey: CryptoKey,
  remotePublic: string,
) {
  const remote = await crypto.subtle.importKey(
    'raw',
    bytes(remotePublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: remote }, privateKey, 256);
  const root = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: bytes(base64(encode(handshake))),
        info: encode(['veil.sharing.v1', group.secret]),
      },
      root,
      256,
    ),
  );
  const invite = {
    ...linkInvitation(group, handshake.inviteId),
    secret: Array.from(secret, (b) => b.toString(16).padStart(2, '0')).join(''),
  };
  return { invite, keys: await invitationKeys(invite) };
}
export const newShareId = () => randomSecret(16);

// Separate domain/signature leaves the v1 exchange transcript and derived keys intact.
function compatibilityTranscript(handshake: ShareHandshake, metadata: ClientCompatibility) {
  return encode(['veil.compatibility.v1', handshake, clientCompatibility(metadata)]);
}
export async function signCompatibility(
  privateKey: CryptoKey,
  handshake: ShareHandshake,
  metadata: ClientCompatibility,
) {
  return base64(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        compatibilityTranscript(handshake, metadata),
      ),
    ),
  );
}
export async function verifyCompatibility(
  group: ShareInvitation,
  handshake: ShareHandshake,
  metadata: ClientCompatibility,
  signature: string,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    bytes(group.hostPublic),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  if (
    !(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      bytes(signature),
      compatibilityTranscript(handshake, metadata),
    ))
  )
    throw new Error('Host compatibility authentication failed. Ask the host for a new link.');
}
