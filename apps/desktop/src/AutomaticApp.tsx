import { useCallback, useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { listen } from '@tauri-apps/api/event';
import {
  createPeerSession,
  joinShareLink,
  shareDocument,
  type AutomaticSession,
  type PeerSession,
  type PeerSummary,
} from '@veil/collaboration';
import { decodeShareLink, decodeServerInvitation } from '@veil/protocol';
import {
  Brand,
  Dialog,
  PeoplePanel,
  hasDocumentContent,
  useAppearance,
  DeveloperCredit,
  AppVersion,
  type Appearance,
} from '@veil/ui';
import { nativeSignaling } from './networking';
import { DesktopEditor, SessionBridge } from './overlay/session';
import { OverlayControls } from './overlay/Controls';
import { Updates } from './Updates';
import { readDisplayName, saveDisplayName } from './display-name';
import { errorMessage, invoke, useOverlay, type OverlaySnapshot } from './overlay/api';

type Section = 'General' | 'Appearance' | 'Hosting server' | 'Overlay' | 'Updates' | 'About';
const sections: Section[] = [
  'General',
  'Appearance',
  'Hosting server',
  'Overlay',
  'Updates',
  'About',
];
export function AutomaticApp() {
  const [document, setDocument] = useState<PeerSession | null>(null);
  const documentRef = useRef<PeerSession | null>(null);
  const network = useRef<AutomaticSession | null>(null);
  const [session, setSession] = useState<AutomaticSession | null>(null);
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [server, setServer] = useState('');
  const [savedServer, setSavedServer] = useState('');
  const [credential, setCredential] = useState('');
  const [serverTest, setServerTest] = useState('');
  const [testingServer, setTestingServer] = useState(false);
  const [savingServer, setSavingServer] = useState(false);
  const [name, setName] = useState(readDisplayName);
  const [invitation, setInvitation] = useState('');
  const [link, setLink] = useState('');
  const [peers, setPeers] = useState<PeerSummary[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [development, setDevelopment] = useState(false);
  const [people, setPeople] = useState(() => window.innerWidth >= 900);
  const [settings, setSettings] = useState(false);
  const [section, setSection] = useState<Section>('General');
  const [shareOpen, setShareOpen] = useState(false);
  const [resumeShare, setResumeShare] = useState(false);
  const [pendingLink, setPendingLink] = useState('');
  const [confirmExit, setConfirmExit] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [connected, setConnected] = useState(false);
  const [serviceOnline, setServiceOnline] = useState(false);
  const { appearance, setAppearance } = useAppearance();
  const overlay = useOverlay();
  const onUpdateBusy = useCallback((value: boolean) => setUpdating(value), []);
  function updateName(value: string) {
    saveDisplayName(value);
    setName(value);
  }
  useEffect(() => {
    const unlisten = listen('app-quit-requested', () => setConfirmQuit(true));
    const unlistenFailure = listen<string>('app-quit-failed', (event) => setError(event.payload));
    return () => {
      void unlisten.then((stop) => stop()).catch(() => {});
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
        decodeShareLink(code, development);
        if (documentRef.current || busyRef.current) setPendingLink(code);
        else {
          setInvitation(code);
          setTab('join');
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
    const timer = setInterval(
      () => setServiceOnline(network.current?.serviceOnline ?? false),
      1000,
    );
    return () => {
      clearInterval(timer);
      document.provider.off('peers', changed);
      document.provider.off('status', changed);
      document.provider.off('sync', changed);
    };
  }, [document]);
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
      setNotice('');
    } catch (e) {
      await invoke('document_closed');
      throw e;
    }
  }
  async function join() {
    if (!name.trim()) throw new Error('Enter your name.');
    if (invitation.trim().startsWith('veil://')) decodeShareLink(invitation.trim(), development);
    else decodeServerInvitation(invitation.trim(), development);
    await invoke('document_open');
    setNotice('Connecting to host…');
    try {
      const joined = await joinShareLink(
        invitation,
        name.trim(),
        nativeSignaling(),
        setNotice,
        development,
      );
      network.current = joined;
      setSession(joined);
      adopt(joined.session);
      setInvitation('');
    } catch (e) {
      await invoke('document_closed');
      setNotice('');
      throw e;
    }
  }
  function openSettings(next: Section = 'General') {
    setSection(next);
    setSettings(true);
  }
  async function share(configuredServer = savedServer) {
    if (!documentRef.current) return;
    if (!configuredServer) {
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
        nativeSignaling(),
        setNotice,
        development,
      );
      network.current = started;
      setSession(started);
    }
    setLink(await network.current.enableSharing());
    setShareOpen(true);
    setNotice('');
    setServiceOnline(network.current.serviceOnline);
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
      setNotice('');
      setError('');
      setShareOpen(false);
      setConfirmExit(false);
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
    setTab('join');
  }
  const guest = session?.role === 'guest';
  const status = !session
    ? 'Local document'
    : guest
      ? connected
        ? 'Connected'
        : session.sessionEnded
          ? 'Disconnected'
          : 'Connecting…'
      : peers.some((p) => p.state === 'connected')
        ? 'Connected'
        : link
          ? 'Sharing enabled'
          : 'Local document';
  return (
    <div className="app-shell desktop-shell">
      <div inert={updating} aria-busy={busy || updating}>
        <header className="app-header">
          <Brand />
          {document && (
            <span className={`status ${connected ? 'status-synced' : ''}`} role="status">
              <span className="status-dot" />
              {status}
            </span>
          )}
          <div className="header-actions">
            {document && (
              <>
                {!guest && (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void run(() => share())}
                  >
                    Share
                  </button>
                )}
                <button
                  className="secondary-button"
                  aria-expanded={people}
                  onClick={() => setPeople(!people)}
                >
                  People
                </button>
                <button
                  className="secondary-button"
                  disabled={!overlay.state || busy}
                  onClick={() =>
                    void run(async () => {
                      overlay.setState(
                        await invoke('overlay_visibility', {
                          visible: !overlay.state?.settings.visible,
                        }),
                      );
                    })
                  }
                >
                  {overlay.state?.settings.visible ? 'Hide overlay' : 'Show overlay'}
                </button>
              </>
            )}
            <button className="quiet-button" onClick={() => openSettings()}>
              Settings
            </button>
          </div>
        </header>
        {!document ? (
          <main className="welcome">
            <div className="welcome-intro">
              <span className="eyebrow">A LITTLE SPACE TO THINK TOGETHER</span>
              <h1>
                Your words.
                <br />A shared space.
              </h1>
              <p>
                Create a document, invite your people, and keep it close with the desktop overlay.
              </p>
            </div>
            <section className="welcome-card" aria-label="Get started">
              <div
                className="segment-tabs"
                role="tablist"
                aria-label="Get started"
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 'create'
                      : event.key === 'End'
                        ? 'join'
                        : tab === 'create'
                          ? 'join'
                          : 'create';
                  setTab(next);
                  event.currentTarget.querySelector<HTMLButtonElement>(`#${next}-tab`)?.focus();
                }}
              >
                <button
                  role="tab"
                  id="create-tab"
                  aria-controls="start-panel"
                  aria-selected={tab === 'create'}
                  tabIndex={tab === 'create' ? 0 : -1}
                  onClick={() => setTab('create')}
                >
                  Create document
                </button>
                <button
                  role="tab"
                  id="join-tab"
                  aria-controls="start-panel"
                  aria-selected={tab === 'join'}
                  tabIndex={tab === 'join' ? 0 : -1}
                  onClick={() => setTab('join')}
                >
                  Join session
                </button>
              </div>
              <form
                id="start-panel"
                role="tabpanel"
                aria-labelledby={tab === 'create' ? 'create-tab' : 'join-tab'}
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(tab === 'create' ? create : join);
                }}
              >
                <h2>{tab === 'create' ? 'Start with a blank page' : 'Join your people'}</h2>
                <p>
                  {tab === 'create'
                    ? 'Write now. Share when you’re ready.'
                    : 'Open a shared link or paste an invitation below.'}
                </p>
                <label htmlFor="automatic-name">
                  Your name {tab === 'create' && <span className="muted">(optional)</span>}
                </label>
                <input
                  id="automatic-name"
                  autoComplete="nickname"
                  placeholder="e.g. Alex"
                  value={name}
                  maxLength={40}
                  disabled={busy}
                  onChange={(e) => updateName(e.target.value)}
                />
                {tab === 'join' && (
                  <>
                    <label htmlFor="automatic-invitation">Session link</label>
                    <textarea
                      id="automatic-invitation"
                      placeholder="veil://join/…"
                      autoComplete="off"
                      value={invitation}
                      maxLength={4096}
                      disabled={busy}
                      onChange={(e) => setInvitation(e.target.value)}
                    />
                  </>
                )}
                <button
                  className="primary-button"
                  disabled={busy || (tab === 'join' && (!name.trim() || !invitation.trim()))}
                >
                  {busy ? 'Connecting…' : tab === 'create' ? 'Create document' : 'Join session'}
                </button>
              </form>
              <p className="welcome-footnote">
                Documents are temporary. Keep Veil open to keep your work.
              </p>
            </section>
          </main>
        ) : (
          <main className={`workspace ${people ? 'with-sidebar' : ''}`}>
            <section className="document-workspace" aria-label="Collaborative workspace">
              <div className="document-heading">
                <div>
                  <span className="eyebrow">
                    {guest ? 'JOINED SESSION' : session ? 'YOUR SHARED DOCUMENT' : 'YOUR DOCUMENT'}
                  </span>
                  <h1>Untitled document</h1>
                </div>
                <button className="quiet-button danger-text" disabled={busy} onClick={requestLeave}>
                  {guest ? 'Leave session' : 'Close document'}
                </button>
              </div>
              <div className="document-panel">
                <DesktopEditor connection={document} />
              </div>
              <footer className="document-footer">
                <span>Temporary document · not saved to disk</span>
                <span>{guest ? 'Host must stay online' : 'Saved only in this open session'}</span>
              </footer>
            </section>
            {people && (
              <PeoplePanel
                connection={document}
                peers={peers}
                role={guest ? 'guest' : 'host'}
                onClose={() => setPeople(false)}
              >
                <details className="connection-details">
                  <summary>Connection details</summary>
                  <p>
                    {session
                      ? `Sharing service: ${serviceOnline ? 'Available' : 'Unavailable'}`
                      : 'This document is local. Share to invite others.'}
                  </p>
                  {session && (
                    <>
                      <p>
                        Direct connections are tried first. A relay is used automatically when
                        needed.
                      </p>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void run(() => session.reconnect())}
                      >
                        Reconnect
                      </button>
                    </>
                  )}
                </details>
              </PeoplePanel>
            )}
          </main>
        )}
        {notice && (
          <div className="app-notice" role="status">
            {notice}
          </div>
        )}
        {error && (
          <div className="app-notice error" role="alert">
            {error}
            <button className="quiet-button" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}
      </div>
      <SessionBridge connection={document} />
      <Dialog
        open={settings}
        title="Settings"
        locked={updating}
        wide
        onClose={() => {
          if (!updating) {
            setSettings(false);
            setResumeShare(false);
          }
        }}
      >
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map((item) => (
              <button
                key={item}
                aria-current={section === item ? 'page' : undefined}
                disabled={updating && item !== 'Updates'}
                onClick={() => setSection(item)}
              >
                {item}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            <section hidden={section !== 'General'}>
              <h3>Window and app</h3>
              <label htmlFor="close-behavior">When closing the main window</label>
              <select
                id="close-behavior"
                value={overlay.state?.settings.closeBehavior ?? 'tray'}
                disabled={!overlay.state || busy || updating}
                onChange={(event) => {
                  const closeBehavior = event.target.value;
                  void run(async () => {
                    overlay.setState(
                      await invoke<OverlaySnapshot>('overlay_update', {
                        patch: { closeBehavior },
                      }),
                    );
                  });
                }}
              >
                <option value="tray">Minimize to tray</option>
                <option value="quit">Quit app</option>
              </select>
              <p>
                Minimize to tray keeps your document, connections and visible overlay active. Quit
                app closes Veil and its overlay immediately. You can reopen Veil, show or hide the
                overlay, or quit from the tray menu.
              </p>
            </section>
            <section hidden={section !== 'Appearance'}>
              <h3>Appearance</h3>
              <p>Make this space feel like yours.</p>
              <label htmlFor="appearance">Theme</label>
              <select
                id="appearance"
                value={appearance}
                onChange={(e) => setAppearance(e.target.value as Appearance)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
              <label htmlFor="settings-name">Your name</label>
              <input
                id="settings-name"
                value={name}
                maxLength={40}
                onChange={(e) => {
                  updateName(e.target.value);
                  if (document)
                    document.provider.awareness.setLocalStateField('user', {
                      ...document.provider.awareness.getLocalState()?.user,
                      name: e.target.value.trim() || 'You',
                    });
                }}
              />
            </section>
            <section hidden={section !== 'Hosting server'}>
              <h3>Hosting server</h3>
              <p>Configure once to share your documents. Guests only need your link.</p>
              {resumeShare && (
                <div className="notice">
                  Save your server settings to continue sharing this document.
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(saveServer);
                }}
              >
                <label htmlFor="automatic-server">Server address</label>
                <input
                  id="automatic-server"
                  value={server}
                  placeholder="https://signal.example.com"
                  autoComplete="off"
                  disabled={busy}
                  onChange={(e) => {
                    setServer(e.target.value);
                    setServerTest('');
                  }}
                />
                <label htmlFor="automatic-credential">Host access credential</label>
                <input
                  id="automatic-credential"
                  type="password"
                  value={credential}
                  placeholder="Leave empty to keep your saved credential"
                  autoComplete="off"
                  disabled={busy}
                  onChange={(e) => {
                    setCredential(e.target.value);
                    setServerTest('');
                  }}
                />
                <div className="form-actions">
                  <button className="primary-button" disabled={busy || !server.trim()}>
                    {savingServer
                      ? 'Checking and saving...'
                      : resumeShare
                        ? 'Save and share'
                        : 'Save settings'}
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={busy || !server.trim()}
                    onClick={() => void run(testServer)}
                  >
                    {testingServer ? 'Testing...' : 'Test connection'}
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={busy || !savedServer}
                    onClick={() =>
                      void run(async () => {
                        await invoke('network_forget', { server: savedServer });
                        setCredential('');
                        setServerTest('');
                        setNotice('Saved host credential removed.');
                      })
                    }
                  >
                    Forget credential
                  </button>
                </div>
                <p role="status" aria-live="polite">
                  {serverTest}
                </p>
              </form>
              <p className="muted">
                Your server operator provides the address and credential. Changes apply when you
                start sharing a new document.
              </p>
            </section>
            <section hidden={section !== 'Overlay'}>
              <h3>Overlay</h3>
              <OverlayControls settingsOnly />
            </section>
            <section hidden={section !== 'Updates'}>
              <h3>App updates</h3>
              <Updates onBusy={onUpdateBusy} settingsView />
            </section>
            <section hidden={section !== 'About'}>
              <h3>About Veil</h3>
              <AppVersion />
              <DeveloperCredit
                onVisit={(event) => {
                  event.preventDefault();
                  void openUrl('https://ahmadfatayerji.com').catch((cause) => {
                    setError(errorMessage(cause));
                  });
                }}
              />
            </section>
            {notice && <p role="status">{notice}</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </Dialog>
      <Dialog open={shareOpen} title="Share document" onClose={() => setShareOpen(false)}>
        <p>Anyone with this link can join and edit. Send it to people you trust.</p>
        {link ? (
          <>
            <label htmlFor="share-link">Session link</label>
            <input
              id="share-link"
              value={link}
              readOnly
              autoComplete="off"
              onFocus={(e) => e.target.select()}
            />
            <div className="form-actions">
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(link);
                    setNotice('Link copied.');
                  })
                }
              >
                Copy link
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setLink(await network.current!.enableSharing(true));
                    setNotice('New link ready. The previous link no longer accepts new people.');
                  })
                }
              >
                Reset link
              </button>
            </div>
            <p className="muted">
              Works until sharing stops or this host session ends. Guests need Veil installed.
            </p>
            <button
              className="quiet-button danger-text"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await network.current!.stopSharing();
                  setLink('');
                  setNotice('Sharing stopped. Existing collaborators stay connected.');
                })
              }
            >
              Stop sharing
            </button>
          </>
        ) : (
          <>
            <p>New people cannot join. Existing collaborators stay connected.</p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void run(() => share())}
            >
              Enable sharing
            </button>
          </>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </Dialog>
      <Dialog
        open={confirmQuit}
        title="Quit Veil?"
        locked={updating || busy}
        onClose={() => setConfirmQuit(false)}
      >
        <p>
          Veil and the overlay will close.
          {document &&
            ' This document is temporary. Copy any text you want to keep before quitting.'}
          {document && !guest && session && ' Everyone will be disconnected.'}
        </p>
        <div className="form-actions">
          <button className="secondary-button" onClick={() => setConfirmQuit(false)}>
            Cancel
          </button>
          <button
            className="danger-button"
            disabled={busy || updating}
            onClick={() => void run(() => invoke('app_quit'))}
          >
            Quit Veil
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </Dialog>
      <Dialog
        open={confirmExit}
        title={guest ? 'Leave session?' : 'Close document?'}
        onClose={() => setConfirmExit(false)}
      >
        <p>
          This document is temporary. Copy any text you want to keep before{' '}
          {guest ? 'leaving' : 'closing'}. {!guest && session && 'Everyone will be disconnected.'}
        </p>
        <div className="form-actions">
          <button className="secondary-button" onClick={() => setConfirmExit(false)}>
            Cancel
          </button>
          <button className="danger-button" disabled={busy} onClick={() => void run(leave)}>
            {guest ? 'Leave session' : 'Close document'}
          </button>
        </div>
      </Dialog>
      <Dialog open={!!pendingLink} title="Open another session?" onClose={() => setPendingLink('')}>
        <p>
          {document && hasDocumentContent(document)
            ? 'Your current document contains temporary content. Copy anything you want to keep before leaving.'
            : 'Leave your current document before opening this invitation.'}
        </p>
        <div className="form-actions">
          <button className="secondary-button" onClick={() => setPendingLink('')}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || updating}
            onClick={() => void run(acceptIncoming)}
          >
            Leave and open invitation
          </button>
        </div>
      </Dialog>
    </div>
  );
}
