export const PEER_CODE_PREFIX = 'veil-p2p:v1:';
export const PEER_CODE_LIMIT = 96 * 1024;
export const PEER_INVITE_LIFETIME = 10 * 60 * 1000;

export interface PeerCode {
  version: 1;
  kind: 'offer' | 'answer';
  sessionId: string;
  connectionId: string;
  invite: string;
  clientId: number;
  expiresAt: number;
  sdp: string;
}

export function encodePeerCode(value: PeerCode): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const code =
    PEER_CODE_PREFIX +
    btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
  if (code.length > PEER_CODE_LIMIT) throw new Error('Connection information is too large.');
  return code;
}

export function decodePeerCode(code: string, kind: PeerCode['kind'], now = Date.now()): PeerCode {
  code = code.trim();
  if (!code.startsWith(PEER_CODE_PREFIX) || code.length > PEER_CODE_LIMIT)
    throw new Error('Paste a valid Veil P2P code.');
  let value: unknown;
  try {
    const encoded = code.slice(PEER_CODE_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'));
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      ),
    );
  } catch {
    throw new Error('The P2P code is damaged or incomplete.');
  }
  if (!value || typeof value !== 'object') throw new Error('Invalid P2P code.');
  const data = value as Record<string, unknown>;
  if (data.version !== 1) throw new Error('Incompatible P2P protocol.');
  if (data.kind !== kind)
    throw new Error(
      `Paste a ${kind === 'offer' ? 'host invitation' : 'guest response'}, not the other code.`,
    );
  for (const key of ['sessionId', 'connectionId', 'invite']) {
    if (
      typeof data[key] !== 'string' ||
      !new RegExp(`^[a-f0-9]{${key === 'invite' ? 64 : 32}}$`).test(data[key] as string)
    )
      throw new Error('Invalid P2P identity or credential.');
  }
  if (
    !Number.isSafeInteger(data.clientId) ||
    (data.clientId as number) < 0 ||
    (data.clientId as number) > 0xffffffff
  )
    throw new Error('Invalid peer identity.');
  if (
    typeof data.expiresAt !== 'number' ||
    !Number.isSafeInteger(data.expiresAt) ||
    data.expiresAt <= now ||
    data.expiresAt > now + PEER_INVITE_LIFETIME + 60_000
  )
    throw new Error('This code has expired. Ask the host for a fresh invitation.');
  if (
    typeof data.sdp !== 'string' ||
    data.sdp.length > 64 * 1024 ||
    !data.sdp.startsWith('v=0\r\n') ||
    !/^a=fingerprint:sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}\r?$/im.test(data.sdp) ||
    !data.sdp.includes('m=application ') ||
    !data.sdp.includes('a=sctp-port:')
  )
    throw new Error('Invalid encrypted data-channel connection information.');
  return data as unknown as PeerCode;
}

export function validateIceServerUrl(value: string, kind: 'stun' | 'turn'): string {
  value = value.trim();
  const scheme = kind === 'stun' ? 'stuns?' : 'turns?';
  if (
    !new RegExp(
      `^${scheme}:(?:\\[[0-9a-fA-F:]+\\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?(?:\\?transport=(?:udp|tcp))?$`,
    ).test(value)
  )
    throw new Error(`Enter a valid ${kind.toUpperCase()} server address.`);
  const port = /:(\d+)(?:\?|$)/.exec(value)?.[1];
  if (port && (Number(port) < 1 || Number(port) > 65535))
    throw new Error('Invalid network server port.');
  return value;
}
