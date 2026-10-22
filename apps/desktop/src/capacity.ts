// Must match the native messages in src-tauri/src/networking.rs.
export const SERVER_FULL = 'This Veil server is at capacity right now.';
export const PUBLIC_LIMIT = "You've reached this server's free hosting limit.";
export const SELF_HOSTING_URL = 'https://github.com/ahmad-fatayerji/veil-server';

export type CapacityProblem = 'full' | 'limit';

/** Whether sharing failed because the server has no room, rather than a real error. */
export function capacityProblem(message: string): CapacityProblem | null {
  if (message === SERVER_FULL) return 'full';
  if (message === PUBLIC_LIMIT) return 'limit';
  return null;
}

export function sameServer(a: string, b: string) {
  return !!a && a.trim().replace(/\/+$/, '').toLowerCase() === b.toLowerCase();
}

/** A server address as people recognize it, e.g. "signal.example.com". */
export function serverHost(server: string) {
  try {
    return new URL(server).host || server;
  } catch {
    return server;
  }
}
