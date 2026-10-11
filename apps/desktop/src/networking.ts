import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { randomSecret } from '@veil/protocol';
import type { SignalingTransport } from '@veil/collaboration';

export function nativeSignaling(): SignalingTransport {
  let unlisten: UnlistenFn | undefined;
  let current = '';
  return {
    request: (server, path, method, body, ticket) =>
      invoke('network_request', { server, path, method, body, ticket }),
    connect: async (server, sessionId, ticket, receive) => {
      unlisten?.();
      current = randomSecret(16);
      const id = current;
      unlisten = await listen<{ connectionId: string; message: unknown }>(
        'veil:network',
        ({ payload }) => {
          if (payload.connectionId === id && current === id) receive(payload.message);
        },
      );
      try {
        await invoke('network_connect', { server, sessionId, ticket, connectionId: id });
      } catch (error) {
        unlisten?.();
        unlisten = undefined;
        throw error;
      }
    },
    send: (message) => invoke('network_send', { message }),
    disconnect: async () => {
      current = '';
      unlisten?.();
      unlisten = undefined;
      await invoke('network_disconnect');
    },
  };
}
