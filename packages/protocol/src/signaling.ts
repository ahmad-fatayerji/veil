export const INVITATION_PREFIX = 'veil-invite:v2:';
export const DIRECT_TIMEOUT_MS = 6_000;
export const RELAY_TIMEOUT_MS = 20_000;
export interface ServerInvitation {
  version: 2;
  server: string;
  sessionId: string;
  inviteId: string;
  secret: string;
  hostClientId: number;
  expiresAt: number;
}
export interface SignalEnvelope {
  inviteId: string;
  role: 'host' | 'guest';
  generation: number;
  sequence: number;
  nonce: string;
  ciphertext: string;
}
export const randomSecret = (bytes = 32) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
export function base64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (v) => String.fromCharCode(v)).join(''));
}
function unbase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid signaling encoding.');
  return Uint8Array.from(atob(value), (v) => v.charCodeAt(0));
}
export function normalizeServer(value: string, localDevelopment = false): string {
  const url = new URL(value.trim());
  if (
    (url.protocol !== 'https:' &&
      !(localDevelopment && url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Enter an HTTPS server address without a path or credentials.');
  return url.origin;
}
export function encodeServerInvitation(invite: ServerInvitation): string {
  return INVITATION_PREFIX + base64(new TextEncoder().encode(JSON.stringify(invite)));
}
export function decodeServerInvitation(code: string, localDevelopment = false): ServerInvitation {
  if (code.startsWith('veil-p2p:'))
    throw new Error('This older manual invitation is incompatible. Ask for a new Veil invitation.');
  if (!code.startsWith(INVITATION_PREFIX) || code.length > 4096)
    throw new Error('Paste a valid Veil invitation.');
  const data = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      unbase64(code.slice(INVITATION_PREFIX.length)),
    ),
  );
  if (
    data.version !== 2 ||
    typeof data.server !== 'string' ||
    !/^[a-f0-9]{32}$/.test(data.sessionId) ||
    !/^[a-f0-9]{32}$/.test(data.inviteId) ||
    !/^[a-f0-9]{64}$/.test(data.secret) ||
    !Number.isSafeInteger(data.hostClientId) ||
    data.hostClientId < 0 ||
    data.hostClientId > 0xffffffff ||
    !Number.isSafeInteger(data.expiresAt) ||
    data.expiresAt <= Date.now() ||
    data.expiresAt > Date.now() + 601_000
  )
    throw new Error('Invalid or expired Veil invitation.');
  data.server = normalizeServer(data.server, localDevelopment);
  return data as ServerInvitation;
}
export async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
}
export async function invitationKeys(invite: ServerInvitation) {
  const root = Uint8Array.from(invite.secret.match(/../g)!, (v) => parseInt(v, 16));
  const key = await crypto.subtle.importKey('raw', root, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const parameters = (domain: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(`${invite.sessionId}:${invite.inviteId}`),
    info: new TextEncoder().encode(`veil.signaling.v2:${domain}`),
  });
  const admission = Array.from(
    new Uint8Array(await crypto.subtle.deriveBits(parameters('admission'), key, 256)),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
  const host = await crypto.subtle.deriveKey(
    parameters('host'),
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const guest = await crypto.subtle.deriveKey(
    parameters('guest'),
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { admission, host, guest };
}
export class SignalCipher {
  private sequence = 0;
  private highest = new Map<string, number>();
  private prefix = crypto.getRandomValues(new Uint8Array(4));
  private remotePrefixes = new Map<string, string>();
  constructor(
    private invite: ServerInvitation,
    private keys: Awaited<ReturnType<typeof invitationKeys>>,
  ) {}
  private aad(e: Pick<SignalEnvelope, 'inviteId' | 'role' | 'generation' | 'sequence'>) {
    return new TextEncoder().encode(
      JSON.stringify([2, this.invite.sessionId, e.inviteId, e.role, e.generation, e.sequence]),
    );
  }
  async seal(
    role: SignalEnvelope['role'],
    generation: number,
    payload: unknown,
  ): Promise<SignalEnvelope> {
    if (!Number.isSafeInteger(this.sequence)) throw new Error('Signaling sequence exhausted.');
    const envelope = {
      inviteId: this.invite.inviteId,
      role,
      generation,
      sequence: this.sequence++,
    };
    const nonce = new Uint8Array(12);
    nonce.set(this.prefix);
    new DataView(nonce.buffer).setBigUint64(4, BigInt(envelope.sequence));
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.length > 64 * 1024) throw new Error('Signaling payload is too large.');
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: this.aad(envelope) },
      this.keys[role],
      bytes,
    );
    return { ...envelope, nonce: base64(nonce), ciphertext: base64(new Uint8Array(ciphertext)) };
  }
  async open(e: SignalEnvelope, expectedRole: SignalEnvelope['role']): Promise<unknown> {
    if (
      e.inviteId !== this.invite.inviteId ||
      e.role !== expectedRole ||
      !Number.isSafeInteger(e.generation) ||
      e.generation < 0 ||
      e.generation > 1_000_000 ||
      !Number.isSafeInteger(e.sequence) ||
      e.sequence < 0 ||
      e.sequence <= (this.highest.get(e.role) ?? -1) ||
      typeof e.nonce !== 'string' ||
      e.nonce.length !== 16 ||
      typeof e.ciphertext !== 'string' ||
      e.ciphertext.length > 96 * 1024
    )
      throw new Error('Invalid, cross-session or replayed signaling.');
    const nonce = Uint8Array.from(unbase64(e.nonce));
    if (nonce.length !== 12 || new DataView(nonce.buffer).getBigUint64(4) !== BigInt(e.sequence))
      throw new Error('Invalid signaling nonce sequence.');
    const prefix = base64(nonce.slice(0, 4));
    if (this.remotePrefixes.has(e.role) && this.remotePrefixes.get(e.role) !== prefix)
      throw new Error('Signaling nonce prefix changed.');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: this.aad(e) },
      this.keys[e.role],
      Uint8Array.from(unbase64(e.ciphertext)),
    );
    const payload: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(plaintext),
    );
    this.highest.set(e.role, e.sequence);
    this.remotePrefixes.set(e.role, prefix);
    return payload;
  }
}
