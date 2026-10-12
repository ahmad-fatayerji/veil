import { readFileSync, readdirSync } from 'node:fs';
import { getVersion } from '@tauri-apps/api/app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeSignaling } from './networking';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

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
