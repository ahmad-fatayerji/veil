/** Release-maintained generations: advertise only implemented wire behavior.
 * Short invitation lookup is capability-gated; legacy API 2 and peer 1 remain implemented.
 */
export const SERVER_PROTOCOLS = [2] as const;
export const PEER_PROTOCOLS = [1] as const;
export interface ClientCompatibility {
  appVersion: string;
  serverProtocols: number[];
  peerProtocols: number[];
}
export function protocolGenerations(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 8 ||
    value.some((v) => !Number.isInteger(v) || v < 1 || v > 1_000_000) ||
    new Set(value).size !== value.length
  )
    throw new Error('Invalid compatibility information.');
  return value as number[];
}
export function clientCompatibility(value: unknown): ClientCompatibility {
  if (!value || typeof value !== 'object') throw new Error('Invalid compatibility information.');
  const c = value as Record<string, unknown>;
  if (typeof c.appVersion !== 'string' || !/^[0-9][0-9A-Za-z.+-]{0,63}$/.test(c.appVersion))
    throw new Error('Invalid compatibility information.');
  return {
    appVersion: c.appVersion,
    serverProtocols: protocolGenerations(c.serverProtocols),
    peerProtocols: protocolGenerations(c.peerProtocols),
  };
}
export function requireServerCompatibility(client: ClientCompatibility, supported: number[]) {
  if (!client.serverProtocols.some((v) => supported.includes(v)))
    throw new Error(
      'This app and server use incompatible protocols. Update Veil or ask the operator to update the server.',
    );
}
export function compatibilityWarning(
  client: ClientCompatibility,
  host: ClientCompatibility | null,
): string {
  const peers = host?.peerProtocols ?? [...PEER_PROTOCOLS];
  if (!client.peerProtocols.some((v) => peers.includes(v)))
    throw new Error(
      'This session uses an unsupported collaboration protocol. Update Veil or ask the host to update their app.',
    );
  if (!host)
    return 'Compatibility could not be verified. The server or host does not provide version information. Some features may not work properly.';
  return client.appVersion === host.appVersion
    ? ''
    : `You are using Veil ${client.appVersion}; the host is using ${host.appVersion}. Some features may not work properly.`;
}
