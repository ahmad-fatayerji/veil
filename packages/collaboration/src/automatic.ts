import {
  DIRECT_TIMEOUT_MS,
  RELAY_TIMEOUT_MS,
  SignalCipher,
  invitationKeys,
  randomSecret,
  sha256,
  encodeServerInvitation,
  decodeServerInvitation,
  normalizeServer,
  type ServerInvitation,
  type SignalEnvelope,
  type PeerCode,
  createShareIdentity,
  createExchange,
  encryptShortInvitation,
  decryptShortInvitation,
  parseShareLink,
  shortLinkKeys,
  signAdmissionStatus,
  verifyAdmissionStatus,
  type AdmissionStatus,
  linkInvitation,
  shareAdmission,
  signHandshake,
  verifyHandshake,
  establishLink,
  newShareId,
  clientCompatibility,
  compatibilityWarning,
  protocolGenerations,
  requireServerCompatibility,
  signCompatibility,
  verifyCompatibility,
  type ClientCompatibility,
  type ShareInvitation,
  type ShareHandshake,
} from '@veil/protocol';
import { createPeerSession, type PeerSession, type AutomaticCallbacks } from './peer';

export interface CompatibilityCallbacks {
  client: () => Promise<ClientCompatibility>;
  confirm: (message: string) => Promise<boolean>;
  warning: (message: string) => void;
}
export interface SignalingTransport {
  compatibility?: CompatibilityCallbacks;
  request: (
    server: string,
    path: string,
    method: string,
    body: unknown,
    ticket?: string,
  ) => Promise<unknown>;
  connect: (
    server: string,
    sessionId: string,
    ticket: string,
    receive: (message: unknown) => void,
  ) => Promise<void>;
  send: (message: SignalEnvelope) => Promise<void>;
  disconnect: () => Promise<void>;
}
export type JoinMode = 'auto' | 'approval';
export interface PendingGuest {
  id: string;
  name: string;
  deadline: number;
}
interface PendingAdmission {
  message: Record<string, unknown>;
  name: string;
  deadline: number;
  requiresApproval: boolean;
  timer: ReturnType<typeof setTimeout>;
}
interface RelayServer extends RTCIceServer {
  expiresAt: number;
}
interface Link {
  invite: ServerInvitation;
  cipher: SignalCipher;
  remoteId?: number;
  generation: number;
  connectionId?: string;
  previous?: string;
  phase: 'direct' | 'relay';
  ready: boolean;
  migrating: boolean;
  retryCount: number;
  lastMigration: number;
  timer?: ReturnType<typeof setTimeout>;
  refresh?: ReturnType<typeof setTimeout>;
  candidates: RTCIceCandidateInit[];
}
interface GroupBootstrap {
  group: ShareInvitation;
  cipher: SignalCipher;
  exchange: Awaited<ReturnType<typeof createExchange>>;
  remoteId: number;
  handshake?: ShareHandshake;
  signature?: string;
  hostCompatibility?: ClientCompatibility;
  compatibilitySignature?: string;
}
interface Signal {
  kind: 'offer' | 'answer' | 'candidate' | 'request' | 'cancel';
  phase?: 'direct' | 'relay';
  connectionId?: string;
  clientId?: number;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  migrate?: boolean;
  restart?: boolean;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid server response.');
  return value as Record<string, unknown>;
}
function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error('Invalid server authorization.');
  return value;
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value))
    throw new Error('Invalid server identity.');
  return value;
}
function stunServers(value: unknown): RTCIceServer[] {
  if (
    !Array.isArray(value) ||
    value.length > 8 ||
    value.some((v) => typeof v !== 'string' || !/^stuns?:[^\s@/]+$/.test(v))
  )
    throw new Error('Invalid discovery configuration.');
  return value.length ? [{ urls: value as string[] }] : [];
}
function validateSdp(sdp: unknown): string {
  if (
    typeof sdp !== 'string' ||
    sdp.length > 64 * 1024 ||
    !sdp.startsWith('v=0\r\n') ||
    !/^a=fingerprint:sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}\r?$/im.test(sdp) ||
    !sdp.includes('m=application ') ||
    !sdp.includes('a=sctp-port:')
  )
    throw new Error('Invalid authenticated WebRTC description.');
  return sdp;
}

/** One controller per document; each host/guest link negotiates independently. */
export class AutomaticSession {
  readonly session: PeerSession;
  private links = new Map<string, Link>();
  private groups = new Map<string, { invite: ShareInvitation; signingKey: CryptoKey }>();
  private bootstraps = new Map<string, GroupBootstrap>();
  private sharingLink = '';
  private activeGroup?: string;
  private mode: JoinMode = 'auto';
  private pending = new Map<string, PendingAdmission>();
  private deciding = new Set<string>();
  get joinMode() {
    return this.mode;
  }
  get pendingGuests(): PendingGuest[] {
    return [...this.pending]
      .filter(([, p]) => p.requiresApproval)
      .map(([id, p]) => ({ id, name: p.name, deadline: p.deadline }));
  }
  setJoinMode(mode: JoinMode) {
    if (this.role !== 'host' || !['auto', 'approval'].includes(mode))
      throw new Error('Invalid host join mode.');
    this.mode = mode;
  }
  private groupGuestId?: string;
  get sharedLink() {
    return this.sharingLink;
  }
  get serviceOnline() {
    return this.socketOnline && !this.ended;
  }
  get sessionEnded() {
    return this.ended;
  }
  private client?: ClientCompatibility;
  private compatibilityExtension = false;
  private expectedHost: ClientCompatibility | null = null;
  private approvedWarning = '';
  private authentication?: { resolve: () => void; reject: (error: Error) => void };
  private authenticationTimer?: ReturnType<typeof setTimeout>;
  private joinRetryTimer?: ReturnType<typeof setTimeout>;
  private joinRetryDeadline = 0;
  private ticket = '';
  private sessionId = '';
  private discovery: RTCIceServer[] = [];
  private stopped = false;
  private closing?: Promise<void>;
  private ended = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private socketAttempts = 0;
  private input = Promise.resolve();
  private output = Promise.resolve();
  private socketOnline = false;
  private connectivity?: EventTarget;
  private telemetry?: ReturnType<typeof setInterval>;
  constructor(
    readonly role: 'host' | 'guest',
    readonly server: string,
    private name: string,
    private transport: SignalingTransport,
    private notice: (message: string) => void,
    existingSession?: PeerSession,
  ) {
    this.session = existingSession ?? createPeerSession(role, name);
    this.connectivity = (navigator as Navigator & { connection?: EventTarget }).connection;
    this.connectivity?.addEventListener('change', this.networkChanged);
    window.addEventListener('online', this.networkChanged);
    this.telemetry = setInterval(() => {
      void this.reportPaths();
    }, 30_000);
  }
  private async request(path: string, body: unknown = {}, method = 'POST') {
    return record(
      await this.transport.request(this.server, path, method, body, this.ticket || undefined),
    );
  }
  private async prepareCompatibility() {
    if (!this.transport.compatibility) return;
    this.client = clientCompatibility(await this.transport.compatibility.client());
    const capabilities = await this.request('/v2/capabilities', {}, 'GET');
    if (capabilities.compatibility !== undefined && capabilities.compatibility !== 1)
      throw new Error(
        'This server uses an unsupported compatibility contract. Update Veil or ask the operator to update the server.',
      );
    this.compatibilityExtension = capabilities.compatibility === 1;
    if (this.compatibilityExtension)
      requireServerCompatibility(this.client, protocolGenerations(capabilities.serverProtocols));
  }
  private compatibilityBody() {
    return this.compatibilityExtension && this.client ? { compatibility: this.client } : {};
  }
  private async approveHost(host: ClientCompatibility | null, changed = false) {
    if (!this.client || !this.transport.compatibility) return;
    const warning = compatibilityWarning(this.client, host);
    const prompt = changed
      ? `Host compatibility information changed after the preview. ${warning || 'Confirm joining this session.'}`
      : warning;
    if (prompt && prompt !== this.approvedWarning) {
      if (!(await this.transport.compatibility.confirm(prompt)))
        throw new Error('Joining cancelled.');
      if (this.stopped) throw new Error('Joining cancelled.');
      this.approvedWarning = prompt;
    }
    const visibleWarning =
      !this.compatibilityExtension && host
        ? `Server compatibility could not be verified. ${warning}`.trim()
        : warning;
    this.transport.compatibility.warning(visibleWarning);
  }
  private async preflight(invite: ServerInvitation | ShareInvitation) {
    await this.prepareCompatibility();
    if (!this.client) return;
    let host: ClientCompatibility | null = null;
    if (this.compatibilityExtension) {
      const reusable = invite.version === 4;
      const admission = reusable
        ? await shareAdmission(invite)
        : (await invitationKeys(invite)).admission;
      const data = await this.request('/v3/compatibility', {
        sessionId: invite.sessionId,
        admission,
        ...this.compatibilityBody(),
        ...(reusable ? { groupId: invite.groupId } : { inviteId: invite.inviteId }),
      });
      if (data.hostClientId !== invite.hostClientId)
        throw new Error('Server substituted the invited host identity.');
      if (
        !this.client.serverProtocols.includes(data.serverProtocol as number) ||
        !this.client.peerProtocols.includes(data.peerProtocol as number)
      )
        throw new Error('The server selected an unsupported protocol. Update Veil or the server.');
      host = data.hostCompatibility === null ? null : clientCompatibility(data.hostCompatibility);
    }
    this.expectedHost = host;
    await this.approveHost(host);
  }
  async startHost() {
    await this.prepareCompatibility();
    const data = await this.request('/v2/sessions', {
      clientId: this.session.doc.clientID,
      ...this.compatibilityBody(),
    });
    this.ticket = token(data.ticket);
    this.sessionId = identity(data.sessionId);
    this.session.provider.sessionId = this.sessionId;
    this.discovery = stunServers(data.stunUrls);
    await this.openSocket();
    this.session.provider.connect();
  }
  async startGuest(invite: ServerInvitation) {
    await this.preflight(invite);
    if (this.stopped) throw new Error('Joining cancelled.');
    const keys = await invitationKeys(invite);
    const data = await this.request('/v2/join', {
      sessionId: invite.sessionId,
      inviteId: invite.inviteId,
      admission: keys.admission,
      clientId: this.session.doc.clientID,
      ...this.compatibilityBody(),
    });
    this.ticket = token(data.ticket);
    this.sessionId = invite.sessionId;
    if (this.stopped) {
      await this.request('/v2/leave', { sessionId: invite.sessionId, inviteId: invite.inviteId });
      throw new Error('Joining cancelled.');
    }
    this.session.provider.sessionId = this.sessionId;
    this.discovery = stunServers(data.stunUrls);
    this.links.set(invite.inviteId, this.link(invite, keys, invite.hostClientId));
    if (data.hostClientId !== invite.hostClientId)
      throw new Error('Server substituted the invited host identity.');
    if (this.client && this.compatibilityExtension) {
      const host =
        data.hostCompatibility === null ? null : clientCompatibility(data.hostCompatibility);
      await this.approveHost(host, JSON.stringify(host) !== JSON.stringify(this.expectedHost));
    }
    await this.openSocket();
    await this.send(this.links.get(invite.inviteId)!, {
      kind: 'request',
      clientId: this.session.doc.clientID,
    });
  }
  private link(
    invite: ServerInvitation,
    keys: Awaited<ReturnType<typeof invitationKeys>>,
    remoteId?: number,
  ): Link {
    return {
      invite,
      cipher: new SignalCipher(invite, keys),
      remoteId,
      generation: 0,
      phase: 'direct',
      ready: false,
      migrating: false,
      retryCount: 0,
      lastMigration: 0,
      candidates: [],
    };
  }
  async createInvitation(): Promise<string> {
    if (this.role !== 'host' || this.stopped || this.ended)
      throw new Error('Only an active host creates invitations.');
    const invite: ServerInvitation = {
      version: 2,
      server: this.server,
      sessionId: this.sessionId,
      inviteId: randomSecret(16),
      secret: randomSecret(),
      hostClientId: this.session.doc.clientID,
      expiresAt: Date.now() + 600_000,
    };
    const keys = await invitationKeys(invite);
    await this.request(`/v2/sessions/${this.sessionId}/invitations`, {
      inviteId: invite.inviteId,
      admissionHash: await sha256(keys.admission),
      expiresAt: invite.expiresAt,
    });
    this.links.set(invite.inviteId, this.link(invite, keys));
    // Bound unused local invitation state; connected participants have no count cap.
    for (const [id, link] of this.links)
      if (link.remoteId === undefined && link.invite.expiresAt < Date.now()) this.links.delete(id);
    return encodeServerInvitation(invite);
  }
  async enableSharing(reset = false): Promise<string> {
    if (this.role !== 'host' || this.stopped || this.ended)
      throw new Error('Only an active host can share.');
    if (this.sharingLink && !reset) return this.sharingLink;
    const capabilities = await this.request('/v2/capabilities', {}, 'GET');
    if (capabilities.groupSharing !== 1 || capabilities.shortInvitations !== 1)
      throw new Error(
        'This server needs an update to support short sharing links. Update the server, then retry.',
      );
    const signing = await createShareIdentity();
    const invite: ShareInvitation = {
      version: 4,
      server: this.server,
      sessionId: this.sessionId,
      groupId: newShareId(),
      secret: randomSecret(),
      hostClientId: this.session.doc.clientID,
      hostPublic: signing.publicKey,
    };
    const short = await encryptShortInvitation(invite);
    const previousGroup = this.activeGroup;
    this.activeGroup = invite.groupId;
    // Store before registration so an immediately admitted guest finds its key.
    this.groups.set(invite.groupId, { invite, signingKey: signing.privateKey });
    try {
      await this.request(`/v3/sessions/${this.sessionId}/sharing`, {
        groupId: invite.groupId,
        admissionHash: await sha256(await shareAdmission(invite)),
        shortInvitation: short.record,
      });
    } catch (error) {
      this.groups.delete(invite.groupId);
      this.activeGroup = previousGroup;
      throw error;
    }
    for (const [id, pending] of this.pending) {
      if (pending.message.groupId !== invite.groupId) this.forgetPending(id);
    }
    this.sharingLink = short.link;
    return this.sharingLink;
  }
  async stopSharing() {
    await this.request(`/v3/sessions/${this.sessionId}/sharing`, {}, 'DELETE');
    this.sharingLink = '';
    this.activeGroup = undefined;
    for (const id of this.pending.keys()) this.forgetPending(id);
  }
  async startGroupGuest(group: ShareInvitation, short = false) {
    await this.preflight(group);
    if (this.stopped) throw new Error('Joining cancelled.');
    const inviteId = newShareId();
    const exchange = await createExchange();
    if (this.stopped) throw new Error('Joining cancelled.');
    const data = await this.request('/v3/join', {
      sessionId: group.sessionId,
      groupId: group.groupId,
      admission: await shareAdmission(group),
      inviteId,
      clientId: this.session.doc.clientID,
      guestPublic: exchange.publicKey,
      ...(short ? { approvalProtocol: 1 } : {}),
      ...this.compatibilityBody(),
    });
    this.ticket = token(data.ticket);
    this.sessionId = group.sessionId;
    if (this.stopped) {
      await this.request('/v2/leave', { sessionId: group.sessionId, inviteId });
      throw new Error('Joining cancelled.');
    }
    this.session.provider.sessionId = this.sessionId;
    this.discovery = stunServers(data.stunUrls);
    const invite = linkInvitation(group, inviteId);
    this.groupGuestId = inviteId;
    this.bootstraps.set(inviteId, {
      group,
      cipher: new SignalCipher(invite, await invitationKeys(invite)),
      exchange,
      remoteId: group.hostClientId,
    });
    if (this.stopped) throw new Error('Joining cancelled.');
    if (data.hostClientId !== group.hostClientId)
      throw new Error('Server substituted the invited host identity.');
    if (this.client && this.compatibilityExtension) {
      const host =
        data.hostCompatibility === null ? null : clientCompatibility(data.hostCompatibility);
      const changed = JSON.stringify(host) !== JSON.stringify(this.expectedHost);
      await this.approveHost(host, changed);
      this.expectedHost = host;
    }
    if (this.stopped) throw new Error('Joining cancelled.');
    this.joinRetryDeadline = Date.now() + (short ? 120_000 : 30_000);
    if (!this.client && !short) {
      await this.openSocket();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.authentication = { resolve, reject };
      this.authenticationTimer = setTimeout(
        () =>
          reject(
            new Error(
              short
                ? 'Join request expired. Try joining again.'
                : 'Host authentication timed out. Ask the host to keep Veil open and retry.',
            ),
          ),
        short ? 120_000 : 30_000,
      );
      void this.openSocket().catch(reject);
    }).finally(() => {
      clearTimeout(this.authenticationTimer);
      this.stopJoinRetries();
      this.authentication = undefined;
    });
  }
  private async bootstrapSend(id: string, payload: unknown) {
    const operation = this.output.then(async () => {
      const bootstrap = this.bootstraps.get(id);
      if (!bootstrap || this.stopped || this.ended) return;
      const envelope = await bootstrap.cipher.seal(this.role, 0, payload);
      if (this.bootstraps.get(id) !== bootstrap || this.stopped || this.ended) return;
      await this.transport.send({ ...envelope, bootstrap: true });
    });
    this.output = operation.catch(() => {});
    return operation;
  }
  private stopJoinRetries() {
    clearTimeout(this.joinRetryTimer);
    this.joinRetryDeadline = 0;
  }
  /** Re-send fresh encrypted handshakes: the server drops signals to offline hosts. */
  private async sendJoinRequest() {
    clearTimeout(this.joinRetryTimer);
    if (
      !this.groupGuestId ||
      this.stopped ||
      this.ended ||
      this.links.has(this.groupGuestId) ||
      Date.now() >= this.joinRetryDeadline
    )
      return;
    try {
      if (this.socketOnline)
        await this.bootstrapSend(this.groupGuestId, {
          kind: 'handshake',
          clientId: this.session.doc.clientID,
          name: this.name.trim().slice(0, 80),
        });
    } catch {
      // A transient send failure must not abort admission; retry within its deadline.
    } finally {
      if (!this.stopped && !this.ended && Date.now() < this.joinRetryDeadline) {
        clearTimeout(this.joinRetryTimer);
        this.joinRetryTimer = setTimeout(() => {
          void this.sendJoinRequest();
        }, 2_000);
      }
    }
  }
  /** Uses a new display name, and resends a join request the host may still be deciding on. */
  rename(name: string) {
    if (name === this.name) return;
    this.name = name;
    // Hosts already replace a pending guest's name when the request arrives again.
    if (this.role === 'guest' && this.socketOnline) void this.sendJoinRequest().catch(() => {});
  }
  private async admitGroup(message: Record<string, unknown>) {
    const id = identity(message.inviteId),
      groupId = identity(message.groupId);
    if (this.links.has(id)) return;
    const group = this.groups.get(groupId);
    if (groupId !== this.activeGroup) return;
    if (
      !group ||
      !Number.isInteger(message.clientId) ||
      (message.clientId as number) < 0 ||
      (message.clientId as number) > 0xffffffff ||
      message.clientId === this.session.doc.clientID ||
      typeof message.guestPublic !== 'string'
    )
      throw new Error('Invalid group admission.');
    const waiting = this.pending.get(id);
    if (waiting) {
      if (
        waiting.message.clientId !== message.clientId ||
        waiting.message.guestPublic !== message.guestPublic ||
        waiting.message.groupId !== groupId
      )
        throw new Error('Server substituted a pending guest.');
      return;
    }
    if (this.pending.size >= 128) {
      await this.request('/v3/admission/decision', {
        sessionId: this.sessionId,
        inviteId: id,
        approve: false,
      });
      return;
    }
    const requiresApproval = this.mode === 'approval';
    const exchange = await createExchange();
    const invite = linkInvitation(group.invite, id);
    this.bootstraps.set(id, {
      group: group.invite,
      cipher: new SignalCipher(invite, await invitationKeys(invite)),
      exchange,
      remoteId: message.clientId as number,
    });
    if (this.stopped || this.ended || groupId !== this.activeGroup) {
      this.bootstraps.delete(id);
      return;
    }
    const deadline = Date.now() + 120_000;
    const timer = setTimeout(() => {
      void this.rejectGuest(id).catch(() => {});
    }, 120_000);
    this.pending.set(id, {
      message,
      name: 'Guest',
      deadline,
      requiresApproval,
      timer,
    });
    if (requiresApproval) await this.sendPendingStatus(id, 'waiting');
  }
  private forgetPending(id: string) {
    const pending = this.pending.get(id);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(id);
    if (!this.links.has(id)) this.bootstraps.delete(id);
  }
  private async pendingStatus(id: string, state: 'waiting' | 'rejected') {
    const pending = this.pending.get(id),
      bootstrap = this.bootstraps.get(id);
    if (!pending || !bootstrap) return;
    const group = this.groups.get(bootstrap.group.groupId);
    if (!group) return;
    const status: AdmissionStatus = {
      version: 1,
      sessionId: this.sessionId,
      groupId: bootstrap.group.groupId,
      inviteId: id,
      hostClientId: this.session.doc.clientID,
      guestClientId: bootstrap.remoteId,
      guestPublic: pending.message.guestPublic as string,
      state,
      deadline: pending.deadline,
    };
    return { status, signature: await signAdmissionStatus(group.signingKey, status) };
  }
  private async sendPendingStatus(id: string, state: 'waiting' | 'rejected') {
    const payload = await this.pendingStatus(id, state);
    if (payload) await this.bootstrapSend(id, payload);
  }
  async rejectGuest(id: string) {
    if (this.role !== 'host' || !this.pending.has(id) || this.deciding.has(id)) return;
    this.deciding.add(id);
    try {
      const operation = this.output.then(async () => {
        const bootstrap = this.bootstraps.get(id);
        const payload = await this.pendingStatus(id, 'rejected');
        const rejection =
          bootstrap && payload
            ? { ...(await bootstrap.cipher.seal('host', 0, payload)), bootstrap: true }
            : undefined;
        await this.request('/v3/admission/decision', {
          sessionId: this.sessionId,
          inviteId: id,
          approve: false,
          ...(rejection ? { rejection } : {}),
        });
      });
      this.output = operation.catch(() => {});
      await operation;
    } finally {
      this.forgetPending(id);
      this.deciding.delete(id);
    }
  }
  async approveGuest(id: string) {
    if (this.role !== 'host' || this.deciding.has(id)) return;
    const pending = this.pending.get(id),
      bootstrap = this.bootstraps.get(id);
    if (!pending || !bootstrap || pending.deadline <= Date.now()) {
      await this.rejectGuest(id);
      return;
    }
    this.deciding.add(id);
    let registered = false;
    try {
      await this.request('/v3/admission/decision', {
        sessionId: this.sessionId,
        inviteId: id,
        approve: true,
      });
      registered = true;
      if (
        pending.deadline <= Date.now() ||
        this.stopped ||
        this.ended ||
        this.pending.get(id) !== pending ||
        pending.message.groupId !== this.activeGroup
      ) {
        await this.request('/v3/admission/decision', {
          sessionId: this.sessionId,
          inviteId: id,
          approve: false,
        }).catch(() => {});
        return;
      }
      const group = this.groups.get(bootstrap.group.groupId)!;
      const exchange = bootstrap.exchange;
      const groupId = bootstrap.group.groupId;
      const message = pending.message;
      const handshake: ShareHandshake = {
        version: 1,
        sessionId: this.sessionId,
        groupId,
        inviteId: id,
        hostClientId: this.session.doc.clientID,
        guestClientId: message.clientId as number,
        guestPublic: message.guestPublic as string,
        hostExchange: exchange.publicKey,
      };
      const established = await establishLink(
        group.invite,
        handshake,
        exchange.privateKey,
        handshake.guestPublic,
      );
      if (
        pending.deadline <= Date.now() ||
        this.stopped ||
        this.ended ||
        this.pending.get(id) !== pending ||
        groupId !== this.activeGroup
      ) {
        await this.request('/v3/admission/decision', {
          sessionId: this.sessionId,
          inviteId: id,
          approve: false,
        }).catch(() => {});
        return;
      }
      bootstrap.handshake = handshake;
      bootstrap.signature = await signHandshake(group.signingKey, handshake);
      if (this.client) {
        bootstrap.hostCompatibility = this.client;
        bootstrap.compatibilitySignature = await signCompatibility(
          group.signingKey,
          handshake,
          this.client,
        );
      }
      if (
        pending.deadline <= Date.now() ||
        this.stopped ||
        this.ended ||
        this.pending.get(id) !== pending ||
        groupId !== this.activeGroup
      ) {
        await this.request('/v3/admission/decision', {
          sessionId: this.sessionId,
          inviteId: id,
          approve: false,
        }).catch(() => {});
        return;
      }
      this.links.set(id, this.link(established.invite, established.keys, handshake.guestClientId));
      this.forgetPending(id);
      await this.bootstrapSend(id, {
        handshake,
        signature: bootstrap.signature,
        ...(bootstrap.hostCompatibility
          ? {
              hostCompatibility: bootstrap.hostCompatibility,
              compatibilitySignature: bootstrap.compatibilitySignature,
            }
          : {}),
      });
    } catch (error) {
      if (registered || pending.deadline <= Date.now()) {
        await this.request('/v3/admission/decision', {
          sessionId: this.sessionId,
          inviteId: id,
          approve: false,
        }).catch(() => {});
        this.forgetPending(id);
      }
      throw error;
    } finally {
      this.deciding.delete(id);
    }
  }
  private async receiveBootstrap(envelope: SignalEnvelope) {
    const bootstrap = this.bootstraps.get(envelope.inviteId);
    if (!bootstrap || envelope.generation !== 0) return;
    const payload = record(
      await bootstrap.cipher.open(envelope, this.role === 'host' ? 'guest' : 'host'),
    );
    if (this.role === 'host') {
      if (payload.clientId !== bootstrap.remoteId || payload.kind !== 'handshake')
        throw new Error('Invalid handshake request.');
      const pending = this.pending.get(envelope.inviteId);
      if (pending) {
        if (typeof payload.name === 'string')
          pending.name = payload.name.trim().slice(0, 80) || 'Guest';
        if (!pending.requiresApproval) await this.approveGuest(envelope.inviteId);
        else await this.sendPendingStatus(envelope.inviteId, 'waiting');
        return;
      }
      if (!bootstrap.handshake) return;
      await this.bootstrapSend(envelope.inviteId, {
        handshake: bootstrap.handshake,
        signature: bootstrap.signature,
        ...(bootstrap.hostCompatibility
          ? {
              hostCompatibility: bootstrap.hostCompatibility,
              compatibilitySignature: bootstrap.compatibilitySignature,
            }
          : {}),
      });
      return;
    }
    if (this.links.has(envelope.inviteId)) return;
    if (payload.status !== undefined) {
      const received = record(payload.status);
      if (
        !['waiting', 'rejected'].includes(received.state as string) ||
        !Number.isSafeInteger(received.deadline) ||
        typeof payload.signature !== 'string'
      )
        throw new Error('Invalid host approval status.');
      const status: AdmissionStatus = {
        version: 1,
        sessionId: this.sessionId,
        groupId: bootstrap.group.groupId,
        inviteId: envelope.inviteId,
        hostClientId: bootstrap.remoteId,
        guestClientId: this.session.doc.clientID,
        guestPublic: bootstrap.exchange.publicKey,
        state: received.state as 'waiting' | 'rejected',
        deadline: received.deadline as number,
      };
      await verifyAdmissionStatus(bootstrap.group, status, payload.signature);
      if (status.state === 'rejected')
        this.authentication?.reject(new Error('The host declined this join request.'));
      else this.notice('Waiting for the host to approve your request.');
      return;
    }
    const received = record(payload.handshake);
    if (typeof received.hostExchange !== 'string' || typeof payload.signature !== 'string')
      throw new Error('Invalid host handshake.');
    // Reconstruct the canonical transcript from locally expected identities/keys.
    const handshake: ShareHandshake = {
      version: 1,
      sessionId: this.sessionId,
      groupId: bootstrap.group.groupId,
      inviteId: envelope.inviteId,
      hostClientId: bootstrap.remoteId,
      guestClientId: this.session.doc.clientID,
      guestPublic: bootstrap.exchange.publicKey,
      hostExchange: received.hostExchange,
    };
    await verifyHandshake(bootstrap.group, handshake, payload.signature);
    this.stopJoinRetries();
    if (this.client) {
      let host: ClientCompatibility | null = null;
      if (payload.hostCompatibility !== undefined) {
        host = clientCompatibility(payload.hostCompatibility);
        if (typeof payload.compatibilitySignature !== 'string')
          throw new Error('Missing host compatibility signature.');
        await verifyCompatibility(bootstrap.group, handshake, host, payload.compatibilitySignature);
      } else if (this.expectedHost)
        throw new Error('The host did not authenticate its advertised compatibility information.');
      // User confirmation has no timeout; no document negotiation has started.
      clearTimeout(this.authenticationTimer);
      await this.approveHost(
        host,
        !!this.expectedHost && JSON.stringify(host) !== JSON.stringify(this.expectedHost),
      );
      if (this.stopped) return;
    }
    const established = await establishLink(
      bootstrap.group,
      handshake,
      bootstrap.exchange.privateKey,
      handshake.hostExchange,
    );
    const link = this.link(established.invite, established.keys, bootstrap.remoteId);
    this.links.set(envelope.inviteId, link);
    await this.send(link, { kind: 'request', clientId: this.session.doc.clientID });
    this.authentication?.resolve();
  }
  private async openSocket() {
    this.socketOnline = true;
    try {
      await this.transport.connect(this.server, this.sessionId, this.ticket, (message) => {
        this.input = this.input
          .then(() => this.receive(message))
          .catch((error: unknown) => {
            this.authentication?.reject(
              error instanceof Error ? error : new Error('Invalid signaling.'),
            );
            this.notice(error instanceof Error ? error.message : 'Invalid signaling.');
          });
      });
    } catch (error) {
      this.socketOnline = false;
      throw error;
    }
    this.socketAttempts = 0;
  }
  private async send(link: Link, signal: Signal) {
    const generation = link.generation;
    const operation = this.output.then(async () => {
      if (!this.active(link)) return;
      if (!this.socketOnline)
        throw new Error('Signaling is unavailable; pending document edits remain local.');
      const envelope = await link.cipher.seal(this.role, generation, signal);
      if (!this.active(link)) return;
      await this.transport.send(envelope);
    });
    this.output = operation.catch(() => {});
    return operation;
  }
  private async receive(value: unknown) {
    if (this.stopped || this.ended) return;
    const message = record(value);
    if (message.kind === 'admission-ended' && this.role === 'guest') {
      this.authentication?.reject(
        new Error('Join request expired or was cancelled. Try joining again.'),
      );
      return;
    }
    if (message.kind === 'ended') {
      this.authentication?.reject(new Error('The session ended before joining.'));
      this.ended = true;
      this.stopTimers();
      this.session.provider.disconnect();
      this.notice(
        'The server session ended or restarted. Your local document remains available to copy.',
      );
      return;
    }
    if (message.kind === 'disconnected') {
      this.socketOnline = false;
      this.notice(
        'Signaling disconnected. Healthy peer connections continue; reconnecting automatically.',
      );
      this.scheduleSocket();
      return;
    }
    if (message.kind === 'ready') {
      await this.sendJoinRequest();
      if (this.role === 'guest')
        for (const link of this.links.values())
          await this.send(link, { kind: 'request', clientId: this.session.doc.clientID });
      if (this.role === 'host')
        for (const link of this.links.values()) {
          // Restart only stalled links; healthy and in-flight peers keep their transports.
          if (!link.ready && !link.connectionId) {
            link.retryCount = 0;
            void this.begin(link, 'direct');
          }
        }
      return;
    }
    if (message.kind === 'replaced') return;
    if (message.kind === 'left' && this.role === 'host') {
      this.forgetPending(identity(message.inviteId));
      const link = this.links.get(identity(message.inviteId));
      if (link) {
        this.links.delete(link.invite.inviteId);
        this.bootstraps.delete(link.invite.inviteId);
        clearTimeout(link.timer);
        clearTimeout(link.refresh);
        if (link.connectionId) this.session.provider.automaticClose(link.connectionId);
        if (link.previous) this.session.provider.automaticClose(link.previous);
        if (![...this.links.values()].some((remaining) => remaining.remoteId !== undefined))
          this.notice('No guests connected. Waiting for someone to join.');
      }
      return;
    }
    if (message.kind === 'admitted' && this.role === 'host') {
      if (message.groupId) {
        await this.admitGroup(message);
        return;
      }
      const link = this.links.get(identity(message.inviteId));
      if (!link) return;
      if (
        !Number.isSafeInteger(message.clientId) ||
        (message.clientId as number) < 0 ||
        (message.clientId as number) > 0xffffffff
      )
        throw new Error('Invalid guest identity.');
      if (link.remoteId !== undefined && link.remoteId !== message.clientId)
        throw new Error('Server substituted the admitted participant.');
      link.remoteId = message.clientId as number;
      return;
    }
    if (message.kind !== 'signal') return;
    const envelope = record(message.envelope) as unknown as SignalEnvelope;
    if (envelope.bootstrap) {
      await this.receiveBootstrap(envelope);
      return;
    }
    const link = this.links.get(envelope.inviteId);
    if (!link) return;
    const payload = record(
      await link.cipher.open(envelope, this.role === 'host' ? 'guest' : 'host'),
    ) as unknown as Signal;
    if (payload.kind === 'request' && this.role === 'host') {
      if (payload.restart && envelope.generation !== link.generation) return;
      if (payload.clientId !== link.remoteId)
        throw new Error('Guest identity does not match authenticated signaling.');
      if (payload.migrate) {
        await this.migrate(link);
      } else if (payload.restart || (!link.ready && !link.connectionId))
        await this.begin(link, 'direct');
      return;
    }
    if (payload.kind === 'offer' && this.role === 'guest') {
      if (
        envelope.generation <= link.generation ||
        payload.clientId !== link.invite.hostClientId ||
        !['direct', 'relay'].includes(payload.phase ?? '')
      )
        throw new Error('Obsolete or invalid peer negotiation.');
      const connectionId = identity(payload.connectionId),
        sdp = validateSdp(payload.sdp);
      clearTimeout(link.timer);
      clearTimeout(link.refresh);
      const previous = link.connectionId;
      if (previous && (!link.ready || !payload.migrate))
        this.session.provider.automaticClose(previous);
      link.previous = link.ready && payload.migrate ? previous : undefined;
      link.generation = envelope.generation;
      link.connectionId = connectionId;
      link.phase = payload.phase!;
      link.migrating = Boolean(payload.migrate);
      link.ready = false;
      this.notice(
        link.phase === 'relay' ? 'Trying a relay' + '\u2026' : 'Connecting to host' + '\u2026',
      );
      const servers = await this.servers(link);
      const pending: RTCIceCandidateInit[] = [];
      let announced = false;
      const callbacks = this.callbacks(link, connectionId, (candidate) => {
        if (announced) void this.sendCandidate(link, connectionId, candidate);
        else pending.push(candidate);
      });
      const answer = await this.session.provider.automaticAnswer(
        this.code(link, connectionId, sdp),
        link.remoteId!,
        servers,
        callbacks,
      );
      await this.send(link, {
        kind: 'answer',
        connectionId,
        clientId: this.session.doc.clientID,
        sdp: answer,
      });
      announced = true;
      for (const candidate of pending) await this.sendCandidate(link, connectionId, candidate);
      return;
    }
    if (envelope.generation !== link.generation || payload.connectionId !== link.connectionId)
      return;
    if (payload.kind === 'answer' && this.role === 'host') {
      if (payload.clientId !== link.remoteId)
        throw new Error('Authenticated guest identity changed.');
      await this.session.provider.automaticAccept(link.connectionId!, validateSdp(payload.sdp));
    } else if (payload.kind === 'candidate') {
      if (
        !payload.candidate ||
        typeof payload.candidate.candidate !== 'string' ||
        payload.candidate.candidate.length > 4096
      )
        throw new Error('Invalid ICE candidate.');
      await this.session.provider.automaticCandidate(link.connectionId!, payload.candidate);
    } else if (payload.kind === 'cancel') {
      this.cancelMigration(link);
    }
  }
  private code(link: Link, connectionId: string, sdp = ''): PeerCode {
    return {
      version: 1,
      kind: 'offer',
      sessionId: this.sessionId,
      connectionId,
      invite: link.invite.secret,
      clientId: link.invite.hostClientId,
      expiresAt: Date.now() + 600_000,
      sdp,
    };
  }
  private async servers(link: Link): Promise<RTCIceServer[]> {
    if (link.phase === 'direct') return this.discovery;
    const value = await this.request('/v2/relay', {
      sessionId: this.sessionId,
      inviteId: link.invite.inviteId,
    });
    if (
      !Array.isArray(value.urls) ||
      value.urls.length > 8 ||
      value.urls.some(
        (url) =>
          typeof url !== 'string' || !/^turns?:[^\s@/]+(?:\?transport=(?:udp|tcp))?$/.test(url),
      ) ||
      typeof value.username !== 'string' ||
      value.username.length > 256 ||
      typeof value.credential !== 'string' ||
      value.credential.length > 256 ||
      !Number.isSafeInteger(value.expiresAt) ||
      (value.expiresAt as number) <= Date.now()
    )
      throw new Error('Invalid relay configuration.');
    const relay = value as unknown as RelayServer;
    return [
      ...this.discovery,
      { urls: relay.urls, username: relay.username, credential: relay.credential },
    ];
  }
  private active(link: Link) {
    return !this.stopped && !this.ended && this.links.get(link.invite.inviteId) === link;
  }
  private current(link: Link, connectionId: string) {
    return this.active(link) && link.connectionId === connectionId;
  }
  private async begin(link: Link, phase: Link['phase'], migrate = false) {
    if (!this.active(link) || this.role !== 'host' || link.remoteId === undefined) return;
    clearTimeout(link.timer);
    clearTimeout(link.refresh);
    const previous = link.connectionId;
    if (previous && (!link.ready || !migrate)) this.session.provider.automaticClose(previous);
    link.previous = link.ready && migrate ? previous : undefined;
    link.migrating = migrate;
    link.phase = phase;
    this.notice(phase === 'relay' ? 'Trying a relay' + '\u2026' : 'Connecting directly' + '\u2026');
    link.ready = false;
    link.generation++;
    const connectionId = randomSecret(16);
    link.connectionId = connectionId;
    const generation = link.generation;
    if (phase === 'relay')
      link.timer = setTimeout(() => {
        void this.failed(link, connectionId);
      }, RELAY_TIMEOUT_MS);
    try {
      const servers = await this.servers(link);
      if (!this.current(link, connectionId) || link.generation !== generation) return;
      const pending: RTCIceCandidateInit[] = [];
      let announced = false;
      const callbacks = this.callbacks(link, connectionId, (candidate) => {
        if (announced) void this.sendCandidate(link, connectionId, candidate);
        else pending.push(candidate);
      });
      // Start the direct deadline only after admission and configuration, at negotiation.
      if (phase === 'direct')
        link.timer = setTimeout(() => {
          void this.failed(link, connectionId);
        }, DIRECT_TIMEOUT_MS);
      const offer = await this.session.provider.automaticOffer(
        this.code(link, connectionId),
        link.remoteId,
        servers,
        callbacks,
      );
      if (!this.current(link, connectionId) || link.generation !== generation) {
        this.session.provider.automaticClose(connectionId);
        return;
      }
      await this.send(link, {
        kind: 'offer',
        phase,
        connectionId,
        clientId: this.session.doc.clientID,
        sdp: offer,
        migrate,
      });
      announced = true;
      for (const candidate of pending) await this.sendCandidate(link, connectionId, candidate);
    } catch (error) {
      if (!this.current(link, connectionId) || link.generation !== generation) return;
      if (link.previous) {
        this.cancelMigration(link);
        this.notice('Replacement connection failed; the existing relay remains active.');
        return;
      }
      this.session.provider.automaticClose(connectionId);
      link.connectionId = undefined;
      this.notice(error instanceof Error ? error.message : 'Connection setup failed.');
      this.schedulePeer(link);
    }
  }
  private async sendCandidate(link: Link, connectionId: string, candidate: RTCIceCandidateInit) {
    if (!this.current(link, connectionId)) return;
    try {
      await this.send(link, { kind: 'candidate', connectionId, candidate });
    } catch {
      if (!this.current(link, connectionId)) return;
      this.notice(
        'Signaling is unavailable. Connection recovery will resume when the server returns.',
      );
    }
  }
  private callbacks(
    link: Link,
    connectionId: string,
    candidate: AutomaticCallbacks['candidate'],
  ): AutomaticCallbacks {
    return {
      candidate,
      failed: () => {
        if (this.current(link, connectionId)) void this.failed(link, connectionId);
      },
      authenticated: () => {
        if (!this.current(link, connectionId)) return;
        this.notice('Synchronizing' + '\u2026');
        if (link.connectionId === connectionId) {
          clearTimeout(link.timer);
          link.timer = setTimeout(() => {
            void this.failed(link, connectionId);
          }, 30_000);
        }
      },
      synced: () => {
        if (!this.current(link, connectionId)) return;
        clearTimeout(link.timer);
        link.timer = undefined;
        link.ready = true;
        link.retryCount = 0;
        if (link.previous) this.session.provider.automaticClose(link.previous);
        link.previous = undefined;
        link.migrating = false;
        this.refreshRelay(link);
        this.notice('Connected.');
        setTimeout(() => {
          void this.reportPaths();
        }, 1500);
      },
    };
  }
  private async failed(link: Link, connectionId: string) {
    if (!this.current(link, connectionId)) return;
    clearTimeout(link.timer);
    if (this.role === 'guest') {
      if (link.migrating && link.previous) {
        try {
          await this.send(link, { kind: 'cancel', connectionId });
        } catch {
          this.notice('Signaling unavailable; the existing relay remains active.');
        } finally {
          this.cancelMigration(link);
        }
        return;
      }
      this.session.provider.automaticClose(connectionId);
      link.connectionId = undefined;
      link.ready = false;
      try {
        await this.send(link, {
          kind: 'request',
          clientId: this.session.doc.clientID,
          restart: true,
        });
      } catch {
        /* Socket recovery retries admission-bound negotiation. */
      }
      return;
    }
    if (link.migrating && link.previous) {
      try {
        await this.send(link, { kind: 'cancel', connectionId });
      } catch {
        this.notice('Signaling unavailable; the existing relay remains active.');
      } finally {
        this.cancelMigration(link);
      }
      return;
    }
    const wasReady = link.ready;
    link.ready = false;
    if (!wasReady && link.phase === 'direct') {
      await this.begin(link, 'relay');
      return;
    }
    this.session.provider.automaticClose(connectionId);
    link.connectionId = undefined;
    if (wasReady) await this.begin(link, 'direct');
    else {
      this.notice('No working connection or relay capacity available. Unsent edits remain local.');
      this.schedulePeer(link);
    }
  }
  private cancelMigration(link: Link) {
    if (!this.active(link)) return;
    if (link.connectionId) this.session.provider.automaticClose(link.connectionId);
    link.connectionId = link.previous;
    link.previous = undefined;
    link.ready = Boolean(link.connectionId);
    link.migrating = false;
    link.phase = 'relay';
    clearTimeout(link.timer);
    this.refreshRelay(link);
  }
  private schedulePeer(link: Link) {
    clearTimeout(link.timer);
    if (!this.active(link) || ++link.retryCount > 5) return;
    link.timer = setTimeout(
      () => {
        if (this.socketOnline) void this.begin(link, 'direct');
      },
      Math.min(30_000, 1000 * 2 ** link.retryCount),
    );
  }
  private scheduleSocket() {
    if (this.stopped || this.ended || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = undefined;
        void this.openSocket().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (/authorization|rejected/i.test(message)) {
            this.authentication?.reject(new Error('Join request is no longer available.'));
            this.ended = true;
            this.stopTimers();
            this.session.provider.disconnect();
            this.notice(
              'Session authorization is no longer valid. Keep this document open to copy unsaved content.',
            );
          } else {
            this.socketAttempts++;
            this.scheduleSocket();
          }
        });
      },
      Math.min(30_000, 1000 * 2 ** Math.min(this.socketAttempts, 5)),
    );
  }
  private refreshRelay(link: Link) {
    clearTimeout(link.refresh);
    if (!this.active(link) || !link.ready || link.phase !== 'relay') return;
    link.refresh = setTimeout(() => {
      if (!this.active(link)) return;
      // Refresh credentials only if the actual selected path uses TURN.
      if (
        !this.session.provider
          .summaries()
          .some((p) => p.id === link.connectionId && p.path === 'relay')
      )
        return;
      // Renew with a new authenticated transport; setConfiguration alone does not
      // replace the credentials used by an existing TURN allocation.
      if (this.role !== 'host') return;
      void this.begin(link, 'relay', true).catch(() =>
        this.notice(
          'Relay credential renewal failed; existing allocations may continue until expiry.',
        ),
      );
    }, 480_000);
  }
  private async migrate(link: Link) {
    if (
      !this.active(link) ||
      !link.ready ||
      link.phase !== 'relay' ||
      Date.now() - link.lastMigration < 300_000
    )
      return;
    link.lastMigration = Date.now();
    await this.begin(link, 'direct', true);
  }
  private networkChanged = () => {
    void this.reconnect().catch(() =>
      this.notice('Signaling unavailable; retrying when it returns.'),
    );
  };
  async reconnect() {
    if (this.stopped || this.ended) return;
    for (const link of this.links.values()) {
      if (this.role === 'host') {
        if (link.ready) await this.migrate(link);
        else if (link.remoteId !== undefined) {
          link.retryCount = 0;
          await this.begin(link, 'direct');
        }
      } else
        await this.send(link, {
          kind: 'request',
          clientId: this.session.doc.clientID,
          migrate: link.ready,
        });
    }
  }
  private stopTimers() {
    this.stopJoinRetries();
    for (const id of this.pending.keys()) this.forgetPending(id);
    clearTimeout(this.authenticationTimer);
    clearInterval(this.telemetry);
    clearTimeout(this.reconnectTimer);
    for (const link of this.links.values()) {
      clearTimeout(link.timer);
      clearTimeout(link.refresh);
    }
  }
  private async reportPaths() {
    if (this.role !== 'host' || this.stopped || this.ended || !this.socketOnline) return;
    const summaries = this.session.provider.summaries();
    for (const link of this.links.values()) {
      if (link.remoteId === undefined) continue;
      const path = summaries.find((peer) => peer.id === link.connectionId)?.path ?? 'checking';
      try {
        await this.request('/v2/path', {
          sessionId: this.sessionId,
          inviteId: link.invite.inviteId,
          path,
        });
      } catch {
        /* Optional operator telemetry cannot interrupt document links. */
      }
    }
  }
  close(preserveDocument = false): Promise<void> {
    this.closing ??= this.closeSession(preserveDocument);
    return this.closing;
  }
  private async closeSession(preserveDocument: boolean) {
    if (this.stopped) return;
    this.stopped = true;
    this.authentication?.reject(new Error('Joining cancelled.'));
    this.stopTimers();
    for (const id of this.pending.keys()) this.forgetPending(id);
    this.connectivity?.removeEventListener('change', this.networkChanged);
    window.removeEventListener('online', this.networkChanged);
    if (this.role === 'host' && this.sessionId && !this.ended) {
      try {
        await this.request(`/v2/sessions/${this.sessionId}`, {}, 'DELETE');
      } catch {
        /* Server expires abandoned session registrations. */
      }
    } else if (this.role === 'guest' && this.sessionId && !this.ended) {
      for (const inviteId of new Set([
        ...this.links.keys(),
        ...this.bootstraps.keys(),
        ...(this.groupGuestId ? [this.groupGuestId] : []),
      ])) {
        try {
          await this.request('/v2/leave', {
            sessionId: this.sessionId,
            inviteId,
          });
        } catch {
          /* Closing local transports still releases allocations. */
        }
      }
    }
    try {
      await this.transport.disconnect();
    } finally {
      if (!preserveDocument) this.session.destroy();
      this.links.clear();
      this.bootstraps.clear();
      this.groups.clear();
    }
  }
}
export async function hostAutomatic(
  server: string,
  name: string,
  transport: SignalingTransport,
  notice: (message: string) => void,
  development = false,
) {
  const current = new AutomaticSession(
    'host',
    normalizeServer(server, development),
    name,
    transport,
    notice,
  );
  try {
    await current.startHost();
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}
export async function joinAutomatic(
  code: string,
  name: string,
  transport: SignalingTransport,
  notice: (message: string) => void,
  development = false,
  signal?: AbortSignal,
  started?: (session: AutomaticSession) => void,
  beforeJoin?: (invitation: ServerInvitation | ShareInvitation) => void,
) {
  if (signal?.aborted) throw new Error('Joining cancelled.');
  const invite = decodeServerInvitation(code.trim(), development);
  beforeJoin?.(invite);
  const current = new AutomaticSession('guest', invite.server, name, transport, notice);
  started?.(current);
  const abort = () => {
    void current.close().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await current.startGuest(invite);
    if (signal?.aborted) throw new Error('Joining cancelled.');
    return current;
  } catch (error) {
    await current.close();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/** Attach sharing to a document that already exists. Failure does not own it. */
export async function shareDocument(
  session: PeerSession,
  server: string,
  name: string,
  transport: SignalingTransport,
  notice: (message: string) => void,
  development = false,
) {
  const current = new AutomaticSession(
    'host',
    normalizeServer(server, development),
    name,
    transport,
    notice,
    session,
  );
  try {
    const capabilities = record(
      await transport.request(current.server, '/v2/capabilities', 'GET', {}),
    );
    if (capabilities.groupSharing !== 1 || capabilities.shortInvitations !== 1)
      throw new Error(
        'This server needs an update to support short sharing links. Update the server, then retry.',
      );
    await current.startHost();
    await current.enableSharing();
    return current;
  } catch (error) {
    await current.close(true);
    throw error;
  }
}
export async function joinShareLink(
  code: string,
  name: string,
  transport: SignalingTransport,
  notice: (message: string) => void,
  development = false,
  signal?: AbortSignal,
  /** Receives the session before the host admits it, so a rename can reach the request. */
  started?: (session: AutomaticSession) => void,
  /** Checks/reserves the resolved session locally before compatibility or admission requests. */
  beforeJoin?: (invitation: ServerInvitation | ShareInvitation) => void,
) {
  if (!code.trim().startsWith('veil://'))
    return joinAutomatic(code, name, transport, notice, development, signal, started, beforeJoin);
  if (signal?.aborted) throw new Error('Joining cancelled.');
  const parsed = parseShareLink(code, development);
  const short = 'code' in parsed;
  let invite: ShareInvitation;
  if (short) {
    const capabilities = record(
      await transport.request(parsed.server, '/v2/capabilities', 'GET', {}),
    );
    if (capabilities.shortInvitations !== 1)
      throw new Error('This server needs an update to support short sharing links.');
    if (signal?.aborted) throw new Error('Joining cancelled.');
    const keys = await shortLinkKeys(parsed);
    const encrypted = await transport.request(parsed.server, '/v3/invitations/resolve', 'POST', {
      reference: keys.reference,
      lookup: keys.lookup,
    });
    invite = await decryptShortInvitation(parsed, encrypted, development);
  } else invite = parsed;
  if (signal?.aborted) throw new Error('Joining cancelled.');
  beforeJoin?.(invite);
  const current = new AutomaticSession('guest', invite.server, name, transport, notice);
  started?.(current);
  const abort = () => {
    void current.close().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await current.startGroupGuest(invite, short);
    if (signal?.aborted) throw new Error('Joining cancelled.');
    return current;
  } catch (error) {
    await current.close();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
