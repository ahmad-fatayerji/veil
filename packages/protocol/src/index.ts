export const PROTOCOL_VERSION = 1;
export const DOCUMENT_FRAGMENT = 'document';
export const HOST_URL = 'http://127.0.0.1:4444';
export const ROOM_NAME = 'm0-demo';
export {
  encodePeerCode,
  decodePeerCode,
  validateIceServerUrl,
  PEER_INVITE_LIFETIME,
  PEER_CODE_LIMIT,
  type PeerCode,
} from './peer';

export interface Bootstrap {
  protocolVersion: number;
  token: string;
  participantLimit: number | null;
}

export interface SessionTarget {
  hostUrl: string;
  sessionId: string;
  token: string;
}

export function parseInvitation(value: string): SessionTarget {
  const url = new URL(value);
  const parts = url.hostname.split('.').map(Number);
  const privateHost =
    parts.length === 4 &&
    parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255) &&
    (parts[0] === 127 ||
      parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  const fragment = new URLSearchParams(url.hash.slice(1));
  const sessionId = fragment.get('session');
  const token = fragment.get('invite');
  if (
    !(url.protocol === 'https:' || (url.protocol === 'http:' && privateHost)) ||
    url.hostname === '0.0.0.0' ||
    url.hostname === '[::]' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    !sessionId ||
    !/^[a-f0-9]{32}$/.test(sessionId) ||
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    throw new Error(
      'Use a valid HTTPS Veil invitation, or HTTP on this computer or a trusted LAN.',
    );
  }
  return { hostUrl: url.origin, sessionId, token };
}

export function websocketBaseUrl(hostUrl: string): string {
  const url = new URL(hostUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported session transport.');
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export interface OverlayCapabilities {
  transparency: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  captureExclusion: 'supported' | 'unsupported' | 'unknown';
}

export function validateBootstrap(value: unknown): Bootstrap {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid host response.');
  const data = value as Record<string, unknown>;
  if (data.protocolVersion !== PROTOCOL_VERSION) throw new Error('Incompatible host protocol.');
  if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) {
    throw new Error('Invalid host credential.');
  }
  if (
    data.participantLimit !== null &&
    (typeof data.participantLimit !== 'number' ||
      !Number.isSafeInteger(data.participantLimit) ||
      data.participantLimit <= 0)
  )
    throw new Error('Invalid participant limit.');
  return data as unknown as Bootstrap;
}
export * from './signaling';

export * from './sharing';

export * from './compatibility';
