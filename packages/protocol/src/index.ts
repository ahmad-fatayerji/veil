export const PROTOCOL_VERSION = 1;
export const DOCUMENT_FRAGMENT = 'document';
export const HOST_URL = 'http://127.0.0.1:4444';
export const ROOM_NAME = 'm0-demo';

export interface Bootstrap {
  protocolVersion: number;
  token: string;
  participantLimit: number | null;
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
