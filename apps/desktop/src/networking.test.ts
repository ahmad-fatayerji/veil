import { readFileSync, readdirSync } from 'node:fs';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeSignaling } from './networking';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

afterEach(() => vi.resetAllMocks());

describe('desktop collaboration compatibility', () => {
  it('allows the main window to read its installed version without granting overlay access', () => {
    const directory = new URL('../src-tauri/capabilities/', import.meta.url);
    const capabilities = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(new URL(name, directory), 'utf8')));
    const versionAccess = capabilities.filter((capability) =>
      capability.permissions.includes('core:app:allow-version'),
    );
    expect(versionAccess.length).toBeGreaterThan(0);
    for (const capability of versionAccess) {
      expect(capability.windows).toEqual(['main']);
      expect(capability.remote).toBeUndefined();
    }
  });

  it('advertises the installed version and implemented protocol generations', async () => {
    vi.mocked(getVersion).mockResolvedValue('0.7.1');
    const transport = nativeSignaling({ confirm: async () => true, warning: vi.fn() });
    await expect(transport.compatibility!.client()).resolves.toEqual({
      appVersion: '0.7.1',
      serverProtocols: [2],
      peerProtocols: [1],
    });
  });

  it.each([
    'Command plugin:app|version not allowed by ACL',
    new Error('Command plugin:app|version not allowed by ACL'),
  ])(
    'explains version lookup failures without bypassing compatibility checks (%s)',
    async (cause) => {
      vi.mocked(getVersion).mockRejectedValue(cause);
      const transport = nativeSignaling({ confirm: async () => true, warning: vi.fn() });
      await expect(transport.compatibility!.client()).rejects.toMatchObject({
        message:
          "Veil couldn't read its installed version. Sharing or joining cannot continue because of an app configuration error.",
        cause,
      });
    },
  );
});

describe('independent tab signaling', () => {
  it('scopes sends, incoming events, and disconnects to each connection', async () => {
    const callbacks: EventCallback<{ connectionId: string; message: unknown }>[] = [];
    vi.mocked(listen).mockImplementation(async (_event, callback) => {
      callbacks.push(callback as EventCallback<{ connectionId: string; message: unknown }>);
      return vi.fn(() => {});
    });
    const first = nativeSignaling();
    const second = nativeSignaling();
    const receiveFirst = vi.fn();
    const receiveSecond = vi.fn();
    await first.connect('https://example.com', 'a'.repeat(32), 'b'.repeat(64), receiveFirst);
    await second.connect('https://example.com', 'c'.repeat(32), 'd'.repeat(64), receiveSecond);
    const connections = vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === 'network_connect')
      .map(([, args]) => (args as { connectionId: string }).connectionId);
    expect(connections[0]).not.toBe(connections[1]);
    const event = {
      event: 'veil:network',
      id: 1,
      payload: { connectionId: connections[1], message: { kind: 'disconnected' } },
    };
    for (const callback of callbacks) callback(event);
    expect(receiveFirst).not.toHaveBeenCalled();
    expect(receiveSecond).toHaveBeenCalledWith(event.payload.message);
    await first.disconnect();
    expect(invoke).toHaveBeenCalledWith('network_disconnect', { connectionId: connections[0] });
    await second.send({} as Parameters<typeof second.send>[0]);
    expect(invoke).toHaveBeenCalledWith('network_send', {
      connectionId: connections[1],
      message: {},
    });
    await second.disconnect();
  });

  it('cleans up a socket that completes connecting after its tab disconnected', async () => {
    vi.mocked(listen).mockResolvedValue(vi.fn(() => {}));
    let finish: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation((command) =>
      command === 'network_connect'
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(),
    );
    const transport = nativeSignaling();
    const connecting = transport.connect(
      'https://example.com',
      'a'.repeat(32),
      'b'.repeat(64),
      vi.fn(),
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    await transport.disconnect();
    finish!();
    await expect(connecting).rejects.toThrow('cancelled');
    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === 'network_disconnect'),
    ).toHaveLength(2);
  });
});
