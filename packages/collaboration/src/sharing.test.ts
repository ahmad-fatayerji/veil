import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPeerSession } from './peer';
import { shareDocument, type SignalingTransport } from './automatic';

beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', class {});
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {});
});
afterEach(() => vi.unstubAllGlobals());

it('retains the same local document and awareness after unsupported servers and failed activation, then retries', async () => {
  const local = createPeerSession('host', 'Alex');
  local.provider.connect();
  const content = local.doc.getText('fixture');
  content.insert(0, 'Offline edits');
  const id = local.doc.clientID;
  const awareness = local.provider.awareness;
  let supported = false,
    fail = true;
  const paths: string[] = [];
  const transport: SignalingTransport = {
    request: async (_server, path) => {
      paths.push(path);
      if (path === '/v2/capabilities')
        return {
          groupSharing: supported ? 1 : undefined,
          shortInvitations: supported ? 1 : undefined,
        };
      if (path === '/v2/sessions')
        return { ticket: 'a'.repeat(64), sessionId: 'b'.repeat(32), stunUrls: [] };
      if (path.endsWith('/sharing') && fail) throw new Error('Service unavailable');
      return {};
    },
    connect: async () => {},
    send: async () => {},
    disconnect: async () => {},
  };
  try {
    await expect(
      shareDocument(local, 'https://example.test', 'Alex', transport, () => {}),
    ).rejects.toThrow('server needs an update');
    expect(paths).toEqual(['/v2/capabilities']);
    supported = true;
    await expect(
      shareDocument(local, 'https://example.test', 'Alex', transport, () => {}),
    ).rejects.toThrow('Service unavailable');
    expect(local.doc.isDestroyed).toBe(false);
    content.insert(content.length, ' retained after failure');
    fail = false;
    const shared = await shareDocument(local, 'https://example.test', 'Alex', transport, () => {});
    expect(shared.session).toBe(local);
    expect(local.doc.clientID).toBe(id);
    expect(local.provider.awareness).toBe(awareness);
    expect(content.toString()).toBe('Offline edits retained after failure');
    expect(await shared.enableSharing()).toBe(shared.sharedLink);
    await shared.close();
  } finally {
    local.destroy();
  }
});
