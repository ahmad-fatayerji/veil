import { decodeShortLink } from '@veil/protocol';

/** Discord's ActivitySecrets.Join field accepts at most 128 characters. Veil
 * short links are ASCII, so character and UTF-8 byte lengths are identical. */
export const DISCORD_JOIN_LIMIT = 128;

export type DiscordPayload =
  { ok: true; value: string } | { ok: false; reason: 'invalid' | 'too-long'; message: string };

export function discordJoinPayload(link: string): DiscordPayload {
  try {
    // Production, canonical short links only. Never forward a legacy invitation,
    // local development origin, credentials, or an arbitrary launch command.
    if (link !== link.trim()) throw new Error('Non-canonical invitation.');
    decodeShortLink(link);
  } catch {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Create a current Veil invite link before enabling Discord invites.',
    };
  }
  if (link.length > DISCORD_JOIN_LIMIT)
    return {
      ok: false,
      reason: 'too-long',
      message:
        'This server address makes the link too long for a direct Discord invite. Copy the link into Discord instead.',
    };
  return { ok: true, value: link };
}

export interface DiscordInvitationDocument {
  id: string;
  host: boolean;
  link: string;
}

export interface DiscordInvitationSelection {
  owner: string;
  documentId: string;
  link: string;
  generation: number;
  /** Public Discord party: friends may join from the profile. Otherwise invites only. */
  publicJoin: boolean;
}

/** Session-only consent, deliberately separate from presence preferences and
 * document/recovery data. This policy does not publish a link or call Discord.
 * The native SDK adapter rechecks the selection before every queued send. */
export class DiscordInvitationPolicy {
  readonly ownerId = crypto.randomUUID();
  private selection: DiscordInvitationSelection | null = null;
  private generation = 0;
  get revision() {
    return this.generation;
  }

  get current(): Readonly<DiscordInvitationSelection> | null {
    return this.selection ? { ...this.selection } : null;
  }

  enable(document: DiscordInvitationDocument, publicJoin = false) {
    if (!document.host) throw new Error('Only the host can enable Discord invites.');
    const payload = discordJoinPayload(document.link);
    if (!payload.ok) throw new Error(payload.message);
    this.selection = {
      owner: this.ownerId,
      documentId: document.id,
      link: payload.value,
      generation: ++this.generation,
      publicJoin,
    };
  }

  /** Selects a document unless it is already selected with the same link, so
   * reopening invites keeps the generation, readiness and queued sends.
   * Returns whether the selection changed. */
  use(document: DiscordInvitationDocument) {
    if (this.selection?.documentId === document.id && this.selection.link === document.link)
      return false;
    this.enable(document);
    return true;
  }

  /** Changes who may join from Discord without invalidating sent invites. */
  setPublicJoin(documentId: string, publicJoin: boolean) {
    if (this.selection?.documentId !== documentId || this.selection.publicJoin === publicJoin)
      return false;
    this.selection = { ...this.selection, publicJoin };
    return true;
  }

  disable(documentId?: string) {
    if (!this.selection || (documentId && this.selection.documentId !== documentId)) return;
    this.selection = null;
    this.generation++;
  }

  reconcile(document: DiscordInvitationDocument) {
    if (
      this.selection?.documentId === document.id &&
      (!document.host || !document.link || this.selection.link !== document.link)
    )
      this.disable(document.id);
  }

  isCurrent(selection: Readonly<DiscordInvitationSelection>) {
    return (
      this.selection?.documentId === selection.documentId &&
      this.selection.owner === selection.owner &&
      this.selection.link === selection.link &&
      this.selection.generation === selection.generation
    );
  }
}
