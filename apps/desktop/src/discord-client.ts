import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, errorMessage } from './overlay/api';
import type {
  DiscordConnectionView,
  DiscordInvitation,
  DiscordInviteResult,
  DiscordPerson,
} from './discord-social';
import type { DiscordInvitationSelection } from './discord-invitations';
import { clearDiscordAvatarCache } from './dialogs/DiscordAvatar';

interface SocialSnapshot {
  available: boolean;
  status: string;
  person: DiscordPerson | null;
  friends: DiscordPerson[];
  invitations: DiscordInvitation[];
  joinRequests: DiscordInvitation[];
  warning: string | null;
  version: number;
  inviteReady: boolean;
  consentEpoch: number;
}

function inviteFailure(cause: unknown): Extract<DiscordInviteResult, { ok: false }> {
  const reason = errorMessage(cause);
  return {
    ok: false,
    reason:
      reason === 'connection' ||
      reason === 'not-friend' ||
      reason === 'rate-limit' ||
      reason === 'stale-document'
        ? reason
        : 'unavailable',
  };
}

export function useDiscordSocial(onConnectionLost: () => void) {
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const active = useRef(false);
  const polling = useRef(false);
  const lastVersion = useRef<number | null>(null);
  const consentEpoch = useRef<number | null>(null);
  const lost = useRef(onConnectionLost);
  /** People invited this connection, listed first; memory only. */
  const [invited, setInvited] = useState<ReadonlySet<string>>(() => new Set());
  const identity = snapshot?.person?.id ?? null;
  /** Friends this window asked to join; their answering invite opens directly. */
  const [awaiting, setAwaiting] = useState<ReadonlySet<string>>(() => new Set());
  const [invitedFor, setInvitedFor] = useState(identity);
  if (invitedFor !== identity) {
    setInvitedFor(identity);
    setInvited(new Set());
    setAwaiting(new Set());
  }
  useEffect(() => {
    clearDiscordAvatarCache();
  }, [identity]);
  useEffect(() => {
    lost.current = onConnectionLost;
  }, [onConnectionLost]);

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const next = await invoke<SocialSnapshot | null>('discord_social_snapshot', {
        afterVersion: lastVersion.current,
      });
      if (!active.current) return;
      setError('');
      if (!next) return;
      lastVersion.current = next.version;
      if (
        next.status !== 'connected' ||
        (consentEpoch.current !== null && consentEpoch.current !== next.consentEpoch)
      )
        lost.current();
      consentEpoch.current = next.consentEpoch;
      setSnapshot((previous) =>
        previous?.version === next.version &&
        previous.available === next.available &&
        previous.status === next.status
          ? previous
          : next,
      );
    } catch {
      if (active.current) setError('Discord connection status could not be read.');
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    active.current = true;
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 750);
    return () => {
      active.current = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  async function action(command: string, status?: string) {
    if (busy.current) return;
    busy.current = true;
    setError('');
    if (status) setSnapshot((current) => (current ? { ...current, status } : current));
    try {
      await invoke(command);
    } catch (cause) {
      lastVersion.current = null;
      if (active.current) setError(errorMessage(cause));
    } finally {
      busy.current = false;
    }
  }
  const connect = () => void action('discord_connect', 'authorizing');
  const disconnect = () => {
    lost.current();
    void action('discord_disconnect', 'disconnecting');
  };
  const cancel = () => void action('discord_cancel_connection');
  let connection: DiscordConnectionView;
  if (!snapshot)
    connection = error
      ? { status: 'error', message: error, retry: () => void refresh() }
      : { status: 'loading' };
  else if (!snapshot.available)
    connection = {
      status: 'unavailable',
      reason:
        snapshot.warning ||
        'This build does not include the Discord Social SDK. You can still copy invite links into Discord.',
    };
  else if (snapshot.status === 'authorizing') connection = { status: 'authorizing', cancel };
  else if (snapshot.status === 'disconnecting') connection = { status: 'disconnecting' };
  else if (snapshot.status === 'connecting' && !snapshot.person)
    connection = { status: 'connecting', cancel: disconnect };
  else if (
    (snapshot.status === 'connected' ||
      snapshot.status === 'reconnecting' ||
      snapshot.status === 'connecting') &&
    snapshot.person
  )
    connection = {
      status: snapshot.status === 'connected' ? 'connected' : 'reconnecting',
      person: snapshot.person,
      disconnect,
    };
  else if (snapshot.status === 'expired')
    connection = { status: 'expired', reconnect: connect, disconnect };
  else connection = { status: 'disconnected', connect };

  async function send(
    personId: string,
    selection: Readonly<DiscordInvitationSelection>,
  ): Promise<DiscordInviteResult> {
    try {
      await invoke('discord_send_invite', {
        personId,
        documentId: selection.documentId,
        generation: selection.generation,
        owner: selection.owner,
      });
      setInvited((current) => new Set(current).add(personId));
      return { ok: true };
    } catch (cause) {
      return inviteFailure(cause);
    }
  }
  async function requestJoin(personId: string): Promise<DiscordInviteResult> {
    setAwaiting((current) => new Set(current).add(personId));
    try {
      await invoke('discord_request_join', { personId });
      return { ok: true };
    } catch (cause) {
      stopAwaiting(personId);
      return inviteFailure(cause);
    }
  }
  function stopAwaiting(personId: string) {
    setAwaiting((current) => {
      if (!current.has(personId)) return current;
      const next = new Set(current);
      next.delete(personId);
      return next;
    });
  }
  async function answerJoin(requestId: string, accept: boolean): Promise<DiscordInviteResult> {
    try {
      await invoke('discord_answer_join_request', { requestId, accept });
      return { ok: true };
    } catch (cause) {
      return inviteFailure(cause);
    }
  }
  return {
    connection,
    available: snapshot?.available ?? false,
    inviteReady: snapshot?.inviteReady ?? false,
    status: snapshot?.status ?? 'loading',
    friends: snapshot?.friends ?? [],
    invited,
    invitations: snapshot?.invitations ?? [],
    joinRequests: snapshot?.joinRequests ?? [],
    awaiting,
    requestJoin,
    stopAwaiting,
    answerJoin,
    warning: error || snapshot?.warning || '',
    refreshFriends: () => void action('discord_refresh_friends'),
    send,
    review: (invitationId: string) => invoke<string>('discord_review_invite', { invitationId }),
    dismiss: (invitationId: string) => invoke('discord_dismiss_invite', { invitationId }),
  };
}
