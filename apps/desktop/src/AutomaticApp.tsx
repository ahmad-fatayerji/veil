import { useCallback, useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { listen } from '@tauri-apps/api/event';
import { ChevronDown, Copy, Eye, EyeOff, Link, LogOut, Pencil, Settings, X } from 'lucide-react';
import {
  createPeerSession,
  joinShareLink,
  shareDocument,
  type AutomaticSession,
  type PeerSession,
  type PeerSummary,
  type PendingGuest,
  type JoinMode,
} from '@veil/collaboration';
import { parseShareLink, decodeServerInvitation } from '@veil/protocol';
import { useDocumentTitle } from '@veil/editor';
import {
  Banner,
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  ToastRegion,
  hasDocumentContent,
  useAppearance,
  useParticipants,
} from '@veil/ui';
import { nativeSignaling } from './networking';
import { SessionBridge } from './overlay/session';
import { useUpdateAttention } from './Updates';
import { readDisplayName, saveDisplayName } from './display-name';
import { errorMessage, invoke, useOverlay, type OverlaySnapshot } from './overlay/api';
import { DocumentStatus, PeopleButton, TitleBar, type ConnectionState } from './shell/TitleBar';
import { StatusBar } from './shell/StatusBar';
import { StartScreen } from './screens/StartScreen';
import { DocumentScreen } from './screens/DocumentScreen';
import { SettingsDialog, type Section } from './dialogs/SettingsDialog';
import { ShareDialog } from './dialogs/ShareDialog';
import { useDiscordPresence } from './discord';

export function AutomaticApp() {
  const [document, setDocument] = useState<PeerSession | null>(null);
  const documentRef = useRef<PeerSession | null>(null);
  const network = useRef<AutomaticSession | null>(null);
  const [session, setSession] = useState<AutomaticSession | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [server, setServer] = useState('');
  const [savedServer, setSavedServer] = useState('');
  const [credential, setCredential] = useState('');
  const [serverTest, setServerTest] = useState('');
  const [testingServer, setTestingServer] = useState(false);
  const [savingServer, setSavingServer] = useState(false);
  const [name, setName] = useState(readDisplayName);
  const [invitation, setInvitation] = useState('');
  const [link, setLink] = useState('');
  const [joinMode, setJoinMode] = useState<JoinMode>('auto');
  const [pendingGuests, setPendingGuests] = useState<PendingGuest[]>([]);
  const joining = useRef<AbortController | null>(null);
  const [joinInProgress, setJoinInProgress] = useState(false);
  const [peers, setPeers] = useState<PeerSummary[]>([]);
  const [notice, setNotice] = useState('');
  const [compatibilityNotice, setCompatibilityNotice] = useState('');
  const [compatibilityPrompt, setCompatibilityPrompt] = useState('');
  const compatibilityDecision = useRef<((accepted: boolean) => void) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [development, setDevelopment] = useState(false);
  const [people, setPeople] = useState(false);
  const peopleButton = useRef<HTMLButtonElement>(null);
  const updateAttention = useUpdateAttention();
  const [settings, setSettings] = useState(false);
  const [section, setSection] = useState<Section>('General');
  const [shareOpen, setShareOpen] = useState(false);
  const [resumeShare, setResumeShare] = useState(false);
  const [pendingLink, setPendingLink] = useState('');
  const [confirmExit, setConfirmExit] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [connected, setConnected] = useState(false);
  const [serviceOnline, setServiceOnline] = useState(false);
  const { appearance, setAppearance } = useAppearance();
  const overlay = useOverlay();
  const participants = useParticipants(document);
  const title = useDocumentTitle(document?.doc);
  const discord = useDiscordPresence(
    document ? title : null,
    participants.filter((person) => !person.local).length,
  );
  const onUpdateBusy = useCallback((value: boolean) => setUpdating(value), []);
  function signaling() {
    return nativeSignaling({
      confirm: (message) =>
        new Promise<boolean>((resolve) => {
          compatibilityDecision.current = resolve;
          setCompatibilityPrompt(message);
        }),
      warning: setCompatibilityNotice,
    });
  }
  function decideCompatibility(accepted: boolean) {
    const resolve = compatibilityDecision.current;
    compatibilityDecision.current = null;
    setCompatibilityPrompt('');
    resolve?.(accepted);
  }
  useEffect(
    () => () => {
      compatibilityDecision.current?.(false);
      joining.current?.abort();
    },
    [],
  );
  function updateName(value: string) {
    saveDisplayName(value);
    setName(value);
    const current = documentRef.current;
    if (current)
      current.provider.awareness.setLocalStateField('user', {
        ...current.provider.awareness.getLocalState()?.user,
        name: value.trim() || 'You',
      });
  }
  useEffect(() => {
    const unlistenFailure = listen<string>('app-quit-failed', (event) => setError(event.payload));
    return () => {
      void unlistenFailure.then((stop) => stop()).catch(() => {});
    };
  }, []);
  useEffect(() => {
    void invoke<{ server: string; development: boolean }>('network_preferences')
      .then((p) => {
        setServer(p.server);
        setSavedServer(p.server);
        setDevelopment(p.development);
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      void network.current?.close();
      if (!network.current) documentRef.current?.destroy();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const receive = (urls: string[]) => {
      if (!active) return;
      const code = urls.find((url) => url.startsWith('veil:'));
      if (!code) return;
      try {
        parseShareLink(code, development);
        if (documentRef.current || busyRef.current) setPendingLink(code);
        else {
          setInvitation(code);
          setJoinOpen(true);
          setError('');
        }
      } catch {
        setError('This invitation link is invalid. Ask the host for a new link.');
      }
    };
    const listener = onOpenUrl(receive);
    void listener
      .then(() => getCurrent())
      .then((urls) => {
        if (urls) receive(urls);
      })
      .catch(() => {});
    return () => {
      active = false;
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [development]);
  useEffect(() => {
    if (!document) return;
    const changed = () => {
      setPeers(document.provider.summaries());
      setConnected(document.provider.synced);
    };
    document.provider.on('peers', changed);
    document.provider.on('status', changed);
    document.provider.on('sync', changed);
    changed();
    const timer = setInterval(() => {
      setServiceOnline(network.current?.serviceOnline ?? false);
      setPendingGuests(network.current?.pendingGuests ?? []);
    }, 1000);
    return () => {
      clearInterval(timer);
      document.provider.off('peers', changed);
      document.provider.off('status', changed);
      document.provider.off('sync', changed);
    };
  }, [document]);
  // Informational notices are transient; errors stay until dismissed.
  useEffect(() => {
    if (!notice || busy || joinInProgress) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice, busy, joinInProgress]);
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function adopt(value: PeerSession) {
    documentRef.current = value;
    setDocument(value);
  }
  async function create() {
    await invoke('document_open');
    try {
      const local = createPeerSession('host', name.trim() || 'You');
      local.provider.connect();
      adopt(local);
      setJoinOpen(false);
      setNotice('');
    } catch (e) {
      await invoke('document_closed');
      throw e;
    }
  }
  async function join() {
    if (!name.trim()) throw new Error('Enter your name.');
    if (invitation.trim().startsWith('veil://')) parseShareLink(invitation.trim(), development);
    else decodeServerInvitation(invitation.trim(), development);
    const controller = new AbortController();
    joining.current = controller;
    setJoinInProgress(true);
    let opened = false;
    try {
      await invoke('document_open');
      opened = true;
      setCompatibilityNotice('');
      setNotice('Connecting to host...');
      const joined = await joinShareLink(
        invitation,
        name.trim(),
        signaling(),
        setNotice,
        development,
        controller.signal,
      );
      network.current = joined;
      setSession(joined);
      adopt(joined.session);
      setInvitation('');
      setJoinOpen(false);
    } catch (e) {
      if (opened) await invoke('document_closed');
      setNotice('');
      throw e;
    } finally {
      joining.current = null;
      setJoinInProgress(false);
    }
  }
  function openSettings(next: Section = 'General') {
    setSection(next);
    setSettings(true);
  }
  async function share(configuredServer = savedServer) {
    if (!documentRef.current) return;
    if (!configuredServer) {
      setShareOpen(false);
      setResumeShare(true);
      openSettings('Hosting server');
      return;
    }
    if (network.current?.sessionEnded)
      throw new Error('The sharing session ended. Keep this document open to copy its content.');
    if (!network.current) {
      const started = await shareDocument(
        documentRef.current,
        configuredServer,
        name.trim() || 'You',
        signaling(),
        setNotice,
        development,
      );
      network.current = started;
      setSession(started);
      setJoinMode(started.joinMode);
    }
    setLink(await network.current.enableSharing());
    setShareOpen(true);
    setNotice('');
    setServiceOnline(network.current.serviceOnline);
  }
  function requestShare() {
    // Ask for a name before the first invitation so guests know who is hosting.
    if (!network.current && !name.trim()) setShareOpen(true);
    else void run(() => share());
  }
  async function testServer() {
    setTestingServer(true);
    setServerTest('Testing connection...');
    try {
      await invoke('network_test', { server, credential: credential || null });
      setServerTest('Connection successful. Host credential accepted.');
    } catch (e) {
      setServerTest(errorMessage(e));
    } finally {
      setTestingServer(false);
    }
  }
  async function saveServer() {
    setSavingServer(true);
    setServerTest('Checking settings before saving...');
    let saved: { server: string };
    try {
      saved = await invoke<{ server: string }>('network_configure', {
        server,
        credential: credential || null,
      });
    } catch (e) {
      setServerTest(errorMessage(e));
      return;
    } finally {
      setSavingServer(false);
    }
    setServerTest('');
    setServer(saved.server);
    setSavedServer(saved.server);
    setCredential('');
    if (resumeShare) {
      setResumeShare(false);
      setSettings(false);
      await share(saved.server);
    } else setNotice('Hosting settings saved on this device.');
  }
  async function leave() {
    const current = network.current;
    network.current = null;
    try {
      if (current) await current.close();
      else documentRef.current?.destroy();
    } finally {
      await invoke('document_closed');
      documentRef.current = null;
      setDocument(null);
      setSession(null);
      setPeers([]);
      setLink('');
      setPendingGuests([]);
      setJoinMode('auto');
      setNotice('');
      setCompatibilityNotice('');
      setError('');
      setShareOpen(false);
      setConfirmExit(false);
      setPeople(false);
    }
  }
  function requestLeave() {
    if (document && hasDocumentContent(document)) setConfirmExit(true);
    else void run(leave);
  }
  async function acceptIncoming() {
    const incoming = pendingLink;
    await leave();
    setPendingLink('');
    setInvitation(incoming);
    setJoinOpen(true);
  }
  function togglePeople(open = !people) {
    setPeople(open);
    if (!open) peopleButton.current?.focus();
  }
  function toggleOverlay() {
    void run(async () => {
      overlay.setState(
        await invoke('overlay_visibility', { visible: !overlay.state?.settings.visible }),
      );
    });
  }
  const guest = session?.role === 'guest';
  function copyInvite() {
    if (!link) return;
    void run(async () => {
      await navigator.clipboard.writeText(link);
      setNotice('Invite link copied.');
    });
  }
  useEffect(() => {
    if (!document || busy || updating) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'w' && !event.shiftKey) {
        event.preventDefault();
        requestLeave();
      } else if (key === 'c' && event.shiftKey && !guest && link) {
        event.preventDefault();
        copyInvite();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const connection: ConnectionState = !session
    ? 'local'
    : guest
      ? connected
        ? 'connected'
        : session.sessionEnded
          ? 'disconnected'
          : 'connecting'
      : peers.some((p) => p.state === 'connected')
        ? 'connected'
        : link
          ? 'sharing'
          : 'local';
  const overlayVisible = !!overlay.state?.settings.visible;
  const leaveLabel = guest ? 'Leave session' : 'Close document';
  const settingsButton = (
    <IconButton
      label="Settings"
      className="desktop-settings-button"
      attention={updateAttention}
      aria-description={updateAttention ? 'Update requires attention' : undefined}
      onClick={() => openSettings(updateAttention ? 'Updates' : 'General')}
    >
      <Settings size={18} aria-hidden="true" />
    </IconButton>
  );
  return (
    <div className="desktop-shell">
      <div className="desktop-content" inert={updating} aria-busy={busy || updating}>
        {document ? (
          <TitleBar
            start={
              <>
                <Menu
                  label={`Document menu: ${title.trim() || 'Untitled'}`}
                  align="start"
                  tooltip={false}
                  triggerClassName="titlebar-title"
                  trigger={
                    <>
                      <span
                        className="titlebar-title-text"
                        data-empty={title.trim() ? undefined : ''}
                      >
                        {title.trim() || 'Untitled'}
                      </span>
                      <ChevronDown size={14} aria-hidden="true" />
                    </>
                  }
                >
                  <MenuItem
                    icon={<Pencil size={16} aria-hidden="true" />}
                    onSelect={() => {
                      const input = window.document.querySelector<HTMLInputElement>('.doc-title');
                      input?.focus();
                      input?.select();
                    }}
                  >
                    Rename
                  </MenuItem>
                  {!guest && link && (
                    <MenuItem
                      icon={<Link size={16} aria-hidden="true" />}
                      shortcut="Ctrl+Shift+C"
                      onSelect={copyInvite}
                    >
                      Copy invite link
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  <MenuItem
                    tone="danger"
                    icon={
                      guest ? (
                        <LogOut size={16} aria-hidden="true" />
                      ) : (
                        <X size={16} aria-hidden="true" />
                      )
                    }
                    shortcut="Ctrl+W"
                    disabled={busy}
                    onSelect={requestLeave}
                  >
                    {leaveLabel}
                  </MenuItem>
                </Menu>
                <DocumentStatus state={connection} count={participants.length} />
              </>
            }
            end={
              <>
                <PeopleButton
                  ref={peopleButton}
                  participants={participants}
                  waiting={guest ? 0 : pendingGuests.length}
                  expanded={people}
                  onToggle={() => togglePeople()}
                />
                <IconButton
                  label={overlayVisible ? 'Hide overlay' : 'Show overlay'}
                  shortcut={overlay.state?.hideShortcutAvailable ? 'Ctrl+Alt+Shift+V' : undefined}
                  aria-pressed={overlayVisible}
                  disabled={!overlay.state || busy}
                  onClick={toggleOverlay}
                >
                  {overlayVisible ? (
                    <Eye size={18} aria-hidden="true" />
                  ) : (
                    <EyeOff size={18} aria-hidden="true" />
                  )}
                </IconButton>
                {!guest &&
                  (link ? (
                    <div className="split-button">
                      <Button variant="primary" size="sm" disabled={busy} onClick={requestShare}>
                        Share
                      </Button>
                      <IconButton
                        label="Copy invite link"
                        shortcut="Ctrl+Shift+C"
                        className="split-button-icon"
                        disabled={busy}
                        onClick={copyInvite}
                      >
                        <Copy size={16} aria-hidden="true" />
                      </IconButton>
                    </div>
                  ) : (
                    <Button variant="primary" size="sm" disabled={busy} onClick={requestShare}>
                      Share
                    </Button>
                  ))}
              </>
            }
          />
        ) : (
          <TitleBar />
        )}
        <div className="app-banners">
          {document && connection === 'disconnected' && (
            <Banner
              tone="warning"
              actions={
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => session!.reconnect())}
                >
                  Reconnect
                </Button>
              }
            >
              Disconnected from the host. Your copy stays open until you leave.
            </Banner>
          )}
          {document && compatibilityNotice && (
            <Banner tone="warning" onDismiss={() => setCompatibilityNotice('')}>
              {compatibilityNotice}
            </Banner>
          )}
        </div>
        {!document ? (
          <StartScreen
            name={name}
            onNameChange={updateName}
            invitation={invitation}
            onInvitationChange={setInvitation}
            joinOpen={joinOpen}
            onJoinOpenChange={setJoinOpen}
            busy={busy}
            development={development}
            onCreate={() => void run(create)}
            onJoin={() => void run(join)}
          />
        ) : (
          <DocumentScreen
            document={document}
            peers={peers}
            role={guest ? 'guest' : 'host'}
            sharing={!!session}
            serviceOnline={serviceOnline}
            busy={busy}
            showPeople={people}
            onClosePeople={() => togglePeople(false)}
            pendingGuests={pendingGuests}
            onApprove={(id) =>
              void run(async () => {
                await session!.approveGuest(id);
                setPendingGuests(session!.pendingGuests);
              })
            }
            onDecline={(id) =>
              void run(async () => {
                await session!.rejectGuest(id);
                setPendingGuests(session!.pendingGuests);
              })
            }
            onReconnect={() => void run(() => session!.reconnect())}
            link={link}
            onCopyLink={copyInvite}
            onShare={requestShare}
          />
        )}
        <StatusBar
          start={
            document ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={
                    guest ? (
                      <LogOut size={14} aria-hidden="true" />
                    ) : (
                      <X size={14} aria-hidden="true" />
                    )
                  }
                  disabled={busy}
                  title={`${leaveLabel} (Ctrl+W)`}
                  onClick={requestLeave}
                >
                  {leaveLabel}
                </Button>
              </>
            ) : (
              <span className="statusbar-note">Overlay hidden from compatible screen capture</span>
            )
          }
          end={settingsButton}
        />
        <ToastRegion>
          {notice && !joinInProgress && (
            <Banner tone="info" className="toast" onDismiss={() => setNotice('')}>
              {notice}
            </Banner>
          )}
          {error && (
            <Banner
              tone="danger"
              role="alert"
              className="toast"
              onDismiss={() => setError('')}
              actions={
                /protocol|update/i.test(error) && (
                  <Button size="sm" variant="ghost" onClick={() => openSettings('Updates')}>
                    Open updates
                  </Button>
                )
              }
            >
              {error}
            </Banner>
          )}
        </ToastRegion>
      </div>
      <SessionBridge connection={document} />
      <Dialog
        open={!!compatibilityPrompt}
        title="Session compatibility"
        onClose={() => decideCompatibility(false)}
      >
        <p>{compatibilityPrompt}</p>
        <div className="dialog-actions">
          <Button onClick={() => decideCompatibility(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => decideCompatibility(true)}>
            Join anyway
          </Button>
        </div>
      </Dialog>
      <SettingsDialog
        open={settings}
        section={section}
        onSectionChange={setSection}
        onClose={() => {
          if (!updating) {
            setSettings(false);
            setResumeShare(false);
          }
        }}
        updating={updating}
        busy={busy}
        updateAttention={updateAttention}
        onUpdateBusy={onUpdateBusy}
        name={name}
        onNameChange={updateName}
        discord={discord}
        closeBehavior={overlay.state?.settings.closeBehavior ?? 'tray'}
        closeBehaviorDisabled={!overlay.state || busy || updating}
        onCloseBehaviorChange={(closeBehavior) =>
          void run(async () => {
            overlay.setState(
              await invoke<OverlaySnapshot>('overlay_update', { patch: { closeBehavior } }),
            );
          })
        }
        appearance={appearance}
        onAppearanceChange={setAppearance}
        hosting={{
          server,
          credential,
          savedServer,
          status: serverTest,
          testing: testingServer,
          saving: savingServer,
          resumeShare,
          onServerChange: (value) => {
            setServer(value);
            setServerTest('');
          },
          onCredentialChange: (value) => {
            setCredential(value);
            setServerTest('');
          },
          onSave: () => void run(saveServer),
          onTest: () => void run(testServer),
          onForget: () =>
            void run(async () => {
              await invoke('network_forget', { server: savedServer });
              setCredential('');
              setServerTest('');
              setNotice('Saved host credential removed.');
            }),
        }}
        notice={notice}
        error={error}
        onOpenUrl={(url) => {
          void openUrl(url).catch((cause) => setError(errorMessage(cause)));
        }}
      />
      {joinInProgress && (
        <Dialog
          open
          title="Joining session"
          onClose={() => {
            joining.current?.abort();
            decideCompatibility(false);
          }}
        >
          <p role="status">{notice || 'Connecting to host...'}</p>
          <p className="muted">Approval requests expire after two minutes.</p>
          <div className="dialog-actions">
            <Button
              onClick={() => {
                joining.current?.abort();
                decideCompatibility(false);
              }}
            >
              Cancel join
            </Button>
          </div>
        </Dialog>
      )}
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        started={!!session}
        link={link}
        joinMode={joinMode}
        onJoinModeChange={(mode) => {
          network.current?.setJoinMode(mode);
          setJoinMode(mode);
        }}
        name={name}
        onNameChange={updateName}
        busy={busy}
        onStart={() => void run(() => share())}
        onCopy={() =>
          void run(async () => {
            await navigator.clipboard.writeText(link);
            setNotice('Link copied.');
          })
        }
        onReset={() =>
          void run(async () => {
            setLink(await network.current!.enableSharing(true));
            setNotice('New link ready. The previous link no longer accepts new people.');
          })
        }
        onStop={() =>
          void run(async () => {
            await network.current!.stopSharing();
            setLink('');
            setNotice('Sharing stopped. Existing collaborators stay connected.');
          })
        }
        onEnable={() => void run(() => share())}
        notice={notice}
        error={error}
      />
      <Dialog
        open={confirmExit}
        title={`${leaveLabel}?`}
        dismissOnBackdrop
        onClose={() => setConfirmExit(false)}
      >
        <p>
          This document is temporary. Copy any text you want to keep before{' '}
          {guest ? 'leaving' : 'closing'}. {!guest && session && 'Everyone will be disconnected.'}
        </p>
        <div className="dialog-actions">
          <Button onClick={() => setConfirmExit(false)}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={() => void run(leave)}>
            {leaveLabel}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!pendingLink}
        title="Open another session?"
        dismissOnBackdrop
        onClose={() => setPendingLink('')}
      >
        <p>
          {document && hasDocumentContent(document)
            ? 'Your current document contains temporary content. Copy anything you want to keep before leaving.'
            : 'Leave your current document before opening this invitation.'}
        </p>
        <div className="dialog-actions">
          <Button onClick={() => setPendingLink('')}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || updating}
            onClick={() => void run(acceptIncoming)}
          >
            Leave and open invitation
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
