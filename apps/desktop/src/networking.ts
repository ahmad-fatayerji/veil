import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { randomSecret, SERVER_PROTOCOLS, PEER_PROTOCOLS } from '@veil/protocol';
import { getVersion } from '@tauri-apps/api/app';
import type { CompatibilityCallbacks, SignalingTransport } from '@veil/collaboration';

export function nativeSignaling(
  callbacks?: Pick<CompatibilityCallbacks, 'confirm' | 'warning'>,
): SignalingTransport {
  let unlisten: UnlistenFn | undefined;
  let current = '';
  return {
    ...(callbacks
      ? {
          compatibility: {
            ...callbacks,
            client: async () => {
              let appVersion: string;
              try {
                appVersion = await getVersion();
              } catch (cause) {
                throw new Error(
                  "Veil couldn't read its installed version. Sharing or joining cannot continue because of an app configuration error.",
                  { cause },
                );
              }
              return {
                appVersion,
                serverProtocols: [...SERVER_PROTOCOLS],
                peerProtocols: [...PEER_PROTOCOLS],
              };
            },
          },
        }
      : {}),
    request: (server, path, method, body, ticket) =>
      invoke('network_request', { server, path, method, body, ticket }),
    connect: async (server, sessionId, ticket, receive) => {
      const previous = current;
      unlisten?.();
      unlisten = undefined;
      current = randomSecret(16);
      const id = current;
      if (previous) await invoke('network_disconnect', { connectionId: previous });
      const stop = await listen<{ connectionId: string; message: unknown }>(
        'veil:network',
        ({ payload }) => {
          if (payload.connectionId === id && current === id) receive(payload.message);
        },
      );
      if (current !== id) {
        stop();
        throw new Error('Connection cancelled.');
      }
      unlisten = stop;
      try {
        await invoke('network_connect', { server, sessionId, ticket, connectionId: id });
        if (current !== id) {
          await invoke('network_disconnect', { connectionId: id });
          throw new Error('Connection cancelled.');
        }
      } catch (error) {
        stop();
        if (current === id) {
          current = '';
          unlisten = undefined;
        }
        throw error;
      }
    },
    send: (message) => invoke('network_send', { message, connectionId: current }),
    disconnect: async () => {
      const connectionId = current;
      current = '';
      unlisten?.();
      unlisten = undefined;
      if (connectionId) await invoke('network_disconnect', { connectionId });
    },
  };
}
