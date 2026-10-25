import { useRef } from 'react';
import { ChevronRight, Copy, UserPlus } from 'lucide-react';
import type { PeerSession, PeerSummary, PendingGuest } from '@veil/collaboration';
import { DocumentTitle } from '@veil/editor';
import { Banner, Button, PeoplePanel } from '@veil/ui';
import { DesktopEditor } from '../overlay/session';
import { DiscordLogo } from '../dialogs/DiscordLogo';

export function JoinRequests({
  guests,
  busy,
  onApprove,
  onDecline,
}: {
  guests: PendingGuest[];
  busy: boolean;
  onApprove: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  if (guests.length === 0) return null;
  return (
    <section className="doc-requests" aria-label="Join requests" aria-live="polite">
      {guests.map((guest) => (
        <Banner
          key={guest.id}
          tone="info"
          role="group"
          icon={<UserPlus size={16} aria-hidden="true" />}
          actions={
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecline(guest.id)}>
                Decline
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => onApprove(guest.id)}
              >
                Approve
              </Button>
            </>
          }
        >
          <strong>{guest.name}</strong> wants to join.{' '}
          <span className="muted">Names are chosen by guests and aren’t verified.</span>
        </Banner>
      ))}
    </section>
  );
}

export function DocumentScreen({
  document,
  peers,
  role,
  sharing,
  serviceOnline,
  busy,
  showPeople,
  onClosePeople,
  pendingGuests,
  onApprove,
  onDecline,
  onReconnect,
  link,
  onCopyLink,
  onShare,
  onInviteDiscord,
}: {
  document: PeerSession;
  peers: PeerSummary[];
  role: 'host' | 'guest';
  sharing: boolean;
  serviceOnline: boolean;
  busy: boolean;
  showPeople: boolean;
  onClosePeople: () => void;
  pendingGuests: PendingGuest[];
  onApprove: (id: string) => void;
  onDecline: (id: string) => void;
  onReconnect: () => void;
  link: string;
  onCopyLink: () => void;
  onShare: () => void;
  /** Present only while Discord invites can be sent from this device. */
  onInviteDiscord?: () => void;
}) {
  const page = useRef<HTMLElement>(null);
  return (
    <main className={`doc-main ${showPeople ? 'with-people' : ''}`}>
      <section ref={page} className="doc-page" aria-label="Document">
        <DesktopEditor
          connection={document}
          header={
            <DocumentTitle
              doc={document.doc}
              onEnter={() => page.current?.querySelector<HTMLElement>('.document-editor')?.focus()}
            />
          }
          aside={
            role === 'host' && (
              <JoinRequests
                guests={pendingGuests}
                busy={busy}
                onApprove={onApprove}
                onDecline={onDecline}
              />
            )
          }
        />
      </section>
      {showPeople && (
        <PeoplePanel
          connection={document}
          peers={peers}
          role={role}
          onClose={onClosePeople}
          invite={
            role === 'host' && (
              <div className="people-invite">
                <span className="muted">
                  {link
                    ? 'Invite more people to edit with you.'
                    : 'Invite people to edit with you.'}
                </span>
                <div className="people-invite-actions">
                  {link && (
                    <Button
                      size="sm"
                      icon={<Copy size={14} aria-hidden="true" />}
                      disabled={busy}
                      onClick={onCopyLink}
                    >
                      Copy link
                    </Button>
                  )}
                  {link && onInviteDiscord && (
                    <Button
                      size="sm"
                      icon={<DiscordLogo size={14} />}
                      aria-label="Invite Discord friends"
                      disabled={busy}
                      onClick={onInviteDiscord}
                    >
                      Discord
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={onShare}>
                    {link ? 'Sharing options' : 'Share…'}
                  </Button>
                </div>
              </div>
            )
          }
        >
          <details className="connection-details">
            <summary>
              <ChevronRight size={14} aria-hidden="true" />
              Connection details
            </summary>
            <div>
              {sharing ? (
                <>
                  <p>Sharing service: {serviceOnline ? 'available' : 'unavailable'}</p>
                  <p>
                    Direct connections are tried first. A relay is used automatically when needed.
                  </p>
                  <Button size="sm" disabled={busy} onClick={onReconnect}>
                    Reconnect
                  </Button>
                </>
              ) : (
                <p>This document is only on this device. Share it to invite others.</p>
              )}
            </div>
          </details>
        </PeoplePanel>
      )}
    </main>
  );
}
