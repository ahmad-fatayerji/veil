import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Eye,
  EyeOff,
  Link,
  LogOut,
  MoreHorizontal,
  Pencil,
  Radio,
  Save,
  Settings,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
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
import { loadMarkdown, useDocumentTitle } from '@veil/editor';
import {
  Banner,
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  ToastRegion,
  useAppearance,
  useParticipants,
} from '@veil/ui';
import { nativeSignaling } from './networking';
import type { Workspace, WorkspaceTab } from './workspace';
import { useUpdateAttention } from './Updates';
import { saveDisplayName, useDisplayName } from './display-name';
import { errorMessage, invoke, useOverlay, type OverlaySnapshot } from './overlay/api';
import { PeopleButton, type ConnectionState } from './shell/TitleBar';
import { StatusBar } from './shell/StatusBar';
import { OverlayStatus } from './shell/OverlayStatus';
import { StartScreen } from './screens/StartScreen';
import { JoinSessions } from './screens/JoinSessions';
import { DocumentScreen } from './screens/DocumentScreen';
import { SettingsDialog, type Section } from './dialogs/SettingsDialog';
import { ShareDialog, type ShareView } from './dialogs/ShareDialog';
import { discordShareState } from './dialogs/discord-share-state';
import type { useDiscordPresence } from './discord';
import { defaultKeybinds, matchesShortcut } from './keybinds';
import {
  capacityProblem,
  sameServer,
  serverHost,
  SELF_HOSTING_URL,
  type CapacityProblem,
} from './capacity';
import type { HostingForm, HostingMode } from './dialogs/HostingChoice';

export function AutomaticApp({
  tab,
  workspace,
  active,
  appearanceSettings,
  discord,
  actionsSlot,
  toasts,
}: {
  tab: WorkspaceTab;
  workspace: Workspace;
  active: boolean;
  appearanceSettings: ReturnType<typeof useAppearance>;
  discord: ReturnType<typeof useDiscordPresence>;
  /** The shared title bar's action area; the selected tab renders its controls there. */
  actionsSlot: HTMLElement | null;
  /** Workspace-wide messages, shown in this tab's toast region while it is selected. */
  toasts?: ReactNode;
}) {
  const [document, setDocument] = useState<PeerSession | null>(null);
  const mounted = useRef(false);
  // New-document tabs show a blank page, not the start screen, until creation settles.
  const [opening, setOpening] = useState(tab.mode === 'new');
  const createInitial = useRef(
    () =>
      void run(create).finally(() => {
        if (mounted.current) setOpening(false);
      }),
  );
  const documentRef = useRef<PeerSession | null>(null);
  const network = useRef<AutomaticSession | null>(null);
  const [session, setSession] = useState<AutomaticSession | null>(null);
  const [joinOpen, setJoinOpen] = useState(tab.mode === 'join');
  const [server, setServer] = useState('');
  const [savedServer, setSavedServer] = useState('');
  const [official, setOfficial] = useState('');
  // Chosen explicitly: an operator credential on the public server's own address is private hosting.
  const [hostingMode, setHostingMode] = useState<HostingMode>('public');
  const [savedPublic, setSavedPublic] = useState(false);
  const [capacity, setCapacity] = useState<CapacityProblem | null>(null);
  const [credential, setCredential] = useState('');
  const [serverTest, setServerTest] = useState('');
  const [testingServer, setTestingServer] = useState(false);
  const [savingServer, setSavingServer] = useState(false);
  const name = useDisplayName();
  const [invitation, setInvitation] = useState(tab.invitation ?? '');
  /** Who sent the link on Discord, shown while the form still holds that link. */
  const [inviter, setInviter] = useState(
    tab.invitedBy && tab.invitation ? { link: tab.invitation, name: tab.invitedBy } : null,
  );
  const [link, setLink] = useState('');
  const [joinMode, setJoinMode] = useState<JoinMode>('auto');
  const [pendingGuests, setPendingGuests] = useState<PendingGuest[]>([]);
  const joining = useRef<AbortController | null>(null);
  // The join session before the host admits it, so a rename can update the waiting request.
  const admitting = useRef<AutomaticSession | null>(null);
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
  const updateAttention = useUpdateAttention(active);
  const [settings, setSettings] = useState(false);
  const [section, setSection] = useState<Section>('General');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareView, setShareView] = useState<ShareView>('main');
  /** Joining from Discord chosen before the first link; applied once Discord points here. */
  const [startPublicJoin, setStartPublicJoin] = useState(false);
  const pendingPublicJoin = useRef<boolean | null>(null);
  // The Share dialog asks where to host on the first share, or after a server was full.
  const [hostingStep, setHostingStep] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [connected, setConnected] = useState(false);
  const [serviceOnline, setServiceOnline] = useState(false);
  const { appearance, setAppearance, accent, setAccent, systemAccent } = appearanceSettings;
  const overlay = useOverlay();
  const keybinds = overlay.state?.settings.keybinds ?? defaultKeybinds;
  const participants = useParticipants(document);
  const title = useDocumentTitle(document?.doc);
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
  // The name may change in another tab, so every open document follows the shared value.
  useEffect(() => {
    if (!document) return;
    const { awareness } = document.provider;
    const user = awareness.getLocalState()?.user;
    const shown = name.trim() || 'You';
    if (user?.name !== shown) awareness.setLocalStateField('user', { ...user, name: shown });
  }, [document, name]);
  useEffect(() => {
    (admitting.current ?? network.current)?.rename(name.trim());
  }, [name]);
  useEffect(() => {
    mounted.current = true;
    let initializing = true;
    void Promise.resolve().then(() => {
      if (initializing && tab.mode === 'new' && !documentRef.current) createInitial.current();
    });
    return () => {
      initializing = false;
      mounted.current = false;
      void network.current?.close();
      if (!network.current) documentRef.current?.destroy();
    };
  }, [tab.mode]);
  useEffect(() => {
    if (!active) return;
    void invoke<{ server: string; official: string; credential: boolean; development: boolean }>(
      'network_preferences',
    )
      .then((p) => {
        // Until another server is saved, sharing setup suggests our own public servers.
        const publicMode = !p.server || (sameServer(p.server, p.official) && !p.credential);
        setHostingMode(publicMode ? 'public' : 'custom');
        setSavedPublic(!!p.server && publicMode);
        setServer(p.server || p.official);
        setSavedServer(p.server);
        setOfficial(p.official);
        setDevelopment(p.development);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [active]);
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
      // Keep the previous array when nothing changed, so idle ticks don't re-render the tab.
      setPendingGuests((previous) => {
        const next = network.current?.pendingGuests ?? [];
        return next.length === previous.length &&
          next.every((guest, index) => guest === previous[index])
          ? previous
          : next;
      });
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
    await invoke('document_open', { documentId: tab.id });
    if (!mounted.current) {
      await invoke('document_closed', { documentId: tab.id });
      return;
    }
    try {
      const local = createPeerSession('host', name.trim() || 'You');
      try {
        if (tab.source !== undefined) loadMarkdown(local.doc, tab.source, tab.file?.path);
        local.provider.connect();
        adopt(local);
      } catch (cause) {
        local.destroy();
        throw cause;
      }
      setJoinOpen(false);
      setNotice('');
    } catch (e) {
      await invoke('document_closed', { documentId: tab.id });
      throw e;
    }
  }
  /** Joins with the form's link, or one Discord handed over. */
  async function join(target = invitation) {
    if (!name.trim()) throw new Error('Enter your name.');
    if (target.trim().startsWith('veil://')) parseShareLink(target.trim(), development);
    else decodeServerInvitation(target.trim(), development);
    const controller = new AbortController();
    joining.current = controller;
    setJoinInProgress(true);
    let opened = false;
    try {
      await invoke('document_open', { documentId: tab.id });
      opened = true;
      setCompatibilityNotice('');
      setNotice('Connecting to host...');
      const joined = await joinShareLink(
        target,
        name.trim(),
        signaling(),
        setNotice,
        development,
        controller.signal,
        (started) => {
          admitting.current = started;
        },
      );
      network.current = joined;
      setSession(joined);
      adopt(joined.session);
      setInvitation('');
      setJoinOpen(false);
    } catch (e) {
      if (opened) await invoke('document_closed', { documentId: tab.id });
      setNotice('');
      throw e;
    } finally {
      joining.current = null;
      admitting.current = null;
      setJoinInProgress(false);
    }
  }
  function openSettings(next: Section = 'General') {
    setSection(next);
    setSettings(true);
  }
  async function share(configuredServer = savedServer) {
    if (!documentRef.current) return;
    // Without a saved server, the Share dialog asks where to host first.
    if (!configuredServer) {
      setShareOpen(true);
      return;
    }
    if (network.current?.sessionEnded)
      throw new Error(
        'The sharing session ended. You can save this document locally before closing it.',
      );
    if (!network.current) {
      let started: AutomaticSession;
      try {
        started = await shareDocument(
          documentRef.current,
          configuredServer,
          name.trim() || 'You',
          signaling(),
          setNotice,
          development,
        );
      } catch (e) {
        // A full server is not a failure of this document; offer another server instead.
        const problem = capacityProblem(errorMessage(e));
        if (!problem) throw e;
        setShareOpen(false);
        setNotice('');
        setCapacity(problem);
        return;
      }
      // The admission choice made before the link exists applies to its first guest.
      started.setJoinMode(joinMode);
      network.current = started;
      setSession(started);
    }
    setLink(await network.current.enableSharing());
    setShareOpen(true);
    setNotice('');
    setServiceOnline(network.current.serviceOnline);
  }
  function requestShare(view: ShareView = 'main') {
    setShareView(view);
    // Ask for a name and a server before the first invitation so guests know who is hosting.
    if (!network.current && (!name.trim() || !savedServer)) setShareOpen(true);
    else void run(() => share());
  }
  /** Saves the server chosen in the Share dialog, when it asked for one, then shares. */
  async function startSharing() {
    let configured = savedServer;
    if (!configured || hostingStep) {
      const saved = await saveServer();
      if (!saved) return;
      configured = saved;
      setHostingStep(false);
    }
    await share(configured);
  }
  function changeHostingMode(mode: HostingMode) {
    setHostingMode(mode);
    // Returning to another server restores the one saved, if any.
    setServer(mode === 'public' ? official : savedPublic ? '' : savedServer);
    setCredential('');
    setServerTest('');
  }
  /** Unsaved hosting choices are dropped so Settings keeps showing the saved server. */
  function discardHostingChanges() {
    if (!savedServer) return;
    setHostingMode(savedPublic ? 'public' : 'custom');
    setServer(savedServer);
    setCredential('');
    setServerTest('');
  }
  function configureOwnServer() {
    setCapacity(null);
    setHostingStep(true);
    changeHostingMode('custom');
    setShareOpen(true);
  }
  function closeShare() {
    setShareOpen(false);
    setShareView('main');
    if (!hostingStep) return;
    setHostingStep(false);
    discardHostingChanges();
  }
  async function testServer() {
    setTestingServer(true);
    setServerTest('Testing connection...');
    try {
      await invoke('network_test', { server, credential: credential || null });
      setServerTest(
        hostingMode === 'public'
          ? 'Connection successful. Public hosting is available.'
          : 'Connection successful. Host credential accepted.',
      );
    } catch (e) {
      setServerTest(errorMessage(e));
    } finally {
      setTestingServer(false);
    }
  }
  /** Returns the saved server, or null when the settings were rejected. */
  async function saveServer() {
    setSavingServer(true);
    setServerTest('Checking settings before saving...');
    let saved: { server: string };
    try {
      // Public mode never uses a credential saved earlier for the same address.
      if (hostingMode === 'public') await invoke('network_forget', { server: official });
      saved = await invoke<{ server: string }>('network_configure', {
        server: hostingMode === 'public' ? official : server,
        credential: hostingMode === 'public' ? null : credential || null,
      });
    } catch (e) {
      setServerTest(errorMessage(e));
      return null;
    } finally {
      setSavingServer(false);
    }
    setServerTest('');
    setServer(saved.server);
    setSavedServer(saved.server);
    setSavedPublic(hostingMode === 'public');
    setCredential('');
    return saved.server;
  }
  const leave = useCallback(async () => {
    workspace.clearDiscordInvites(tab.id);
    const current = network.current;
    network.current = null;
    try {
      if (current) await current.close();
      else documentRef.current?.destroy();
    } finally {
      await invoke('document_closed', { documentId: tab.id });
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
      setPeople(false);
    }
  }, [tab.id, workspace]);
  function requestLeave() {
    void workspace.close(tab);
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
    if (
      !active ||
      !document ||
      busy ||
      updating ||
      settings ||
      shareOpen ||
      capacity ||
      compatibilityPrompt ||
      window.document.querySelector('dialog[open]')
    )
      return;
    const onKey = (event: KeyboardEvent) => {
      if (matchesShortcut(event, keybinds.copyInvite) && !guest && link) {
        event.preventDefault();
        copyInvite();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
  const discordHolder = workspace.discordInvites.current?.documentId;
  const discordElsewhere =
    discordHolder && discordHolder !== tab.id
      ? workspace.tabs.find((item) => item.id === discordHolder)?.title.trim() || 'another document'
      : null;
  const discordJoinVisible =
    discord.social.available &&
    discord.connection.status !== 'unavailable' &&
    discord.connection.status !== 'loading';
  const awaitingApproval =
    joinInProgress && notice === 'Waiting for the host to approve your request.';
  const overlayVisible = !!overlay.state?.settings.visible;
  const leaveLabel = guest ? 'Leave session' : 'Close document';
  // Settings and the Share dialog edit the same hosting choice.
  const hostingForm: HostingForm = {
    server,
    credential,
    savedServer,
    mode: hostingMode,
    status: serverTest,
    testing: testingServer,
    saving: savingServer,
    onModeChange: changeHostingMode,
    onServerChange: (value) => {
      setServer(value);
      setServerTest('');
    },
    onCredentialChange: (value) => {
      setCredential(value);
      setServerTest('');
    },
    onSave: () =>
      void run(async () => {
        if (await saveServer()) setNotice('Hosting settings saved on this device.');
      }),
    onTest: () => void run(testServer),
    onForget: () =>
      void run(async () => {
        await invoke('network_forget', { server: savedServer });
        setCredential('');
        setServerTest('');
        setNotice('Saved host credential removed.');
      }),
  };
  const hostingSummary = savedPublic ? 'Veil public servers' : serverHost(savedServer);
  useEffect(() => {
    workspace.attach(tab, document);
    return () => {
      tab.unsubscribe?.();
    };
  }, [workspace, tab, document]);
  useEffect(() => {
    workspace.update(tab, {
      close: leave,
      // Waiting for approval can take minutes; it must not block closing the tab or quitting.
      busy: (busy && !joinInProgress) || updating,
      status: connection,
      hosted: !guest,
      sharing: !!session,
      sharingLink: link,
    });
    // The tab controller always uses the latest closures without resetting its document.
  }, [workspace, tab, busy, joinInProgress, updating, connection, guest, session, leave, link]);
  // With Discord connected, the document you share becomes the one friends can be
  // invited to, unless another shared document already holds it. Runs after the
  // update above so the workspace sees the new link.
  const discordInvitable =
    active &&
    !guest &&
    !!link &&
    discordShareState({
      available: discord.social.available,
      connection: discord.connection,
      preferences: discord.preferences,
      link,
    }).kind === 'ready';
  useEffect(() => {
    if (!discordInvitable || workspace.discordInvites.current) return;
    try {
      workspace.useDiscordFor(tab);
      if (pendingPublicJoin.current) workspace.setDiscordPublicJoin(tab, true);
      pendingPublicJoin.current = null;
    } catch {
      /* The Share dialog explains why this link cannot be used on Discord. */
    }
  }, [workspace, tab, discordInvitable, link]);
  // An empty name on the first share or join uses the connected Discord name.
  const discordName =
    discord.connection.status === 'connected'
      ? discord.connection.person.displayName || discord.connection.person.username
      : '';
  useEffect(() => {
    if ((shareOpen || joinOpen) && !name.trim() && discordName)
      saveDisplayName(discordName.slice(0, 40));
  }, [shareOpen, joinOpen, name, discordName]);
  const settingsButton = (
    <IconButton
      label="Settings"
      className="desktop-settings-button"
      attention={updateAttention}
      aria-description={updateAttention ? 'Update requires attention' : undefined}
      onClick={() => openSettings(updateAttention ? 'About & updates' : 'General')}
    >
      <Settings size={18} aria-hidden="true" />
    </IconButton>
  );
  const fileName = tab.file?.path.split(/[\\/]/).pop();
  const titlebarActions = document && (
    <>
      {/* A local document has only its author, so People appears once a session exists. */}
      {session && (
        <PeopleButton
          ref={peopleButton}
          participants={participants}
          waiting={guest ? 0 : pendingGuests.length}
          expanded={people}
          onToggle={() => togglePeople()}
        />
      )}
      <IconButton
        label={overlayVisible ? 'Hide overlay' : 'Show overlay'}
        shortcut={overlay.state?.hideShortcutAvailable ? keybinds.toggleOverlay : undefined}
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
      {!guest && (
        // While an invite link is active the icon becomes a broadcast in the accent colour;
        // Copy invite link lives in the document menu and on its shortcut.
        <IconButton
          label="Share"
          className="share-button"
          data-sharing={link ? '' : undefined}
          disabled={busy}
          onClick={() => requestShare()}
        >
          {link ? (
            <Radio size={18} aria-hidden="true" />
          ) : (
            <UserPlus size={18} aria-hidden="true" />
          )}
        </IconButton>
      )}
      <Menu
        label={`Document menu: ${title.trim() || 'Untitled'}`}
        trigger={<MoreHorizontal size={18} aria-hidden="true" />}
      >
        <MenuItem
          icon={<Save size={16} aria-hidden="true" />}
          shortcut={keybinds.saveDocument}
          disabled={busy || workspace.working}
          onSelect={() =>
            void workspace.run(async () => {
              await workspace.save(tab);
            })
          }
        >
          Save
        </MenuItem>
        <MenuItem
          shortcut={keybinds.saveDocumentAs}
          disabled={busy || workspace.working}
          onSelect={() =>
            void workspace.run(async () => {
              await workspace.save(tab, true);
            })
          }
        >
          Save As…
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<Pencil size={16} aria-hidden="true" />}
          onSelect={() => {
            const input = window.document.querySelector<HTMLInputElement>(
              `#panel-${tab.id} .doc-title`,
            );
            input?.focus();
            input?.select();
          }}
        >
          Rename
        </MenuItem>
        {!guest && link && (
          <MenuItem
            icon={<Link size={16} aria-hidden="true" />}
            shortcut={keybinds.copyInvite}
            onSelect={copyInvite}
          >
            Copy invite link
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem
          tone="danger"
          icon={
            guest ? <LogOut size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />
          }
          shortcut={keybinds.closeDocument}
          disabled={busy}
          onSelect={requestLeave}
        >
          {leaveLabel}
        </MenuItem>
      </Menu>
    </>
  );
  return (
    <div className="desktop-shell">
      {active && actionsSlot && titlebarActions && createPortal(titlebarActions, actionsSlot)}
      <div className="desktop-content" inert={updating} aria-busy={busy || updating}>
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
        {!document && opening ? (
          <div className="document-opening" aria-busy="true" />
        ) : !document ? (
          <StartScreen
            name={name}
            onNameChange={saveDisplayName}
            invitation={invitation}
            invitedBy={inviter && invitation.trim() === inviter.link ? inviter.name : undefined}
            sessions={
              discordJoinVisible && (
                <JoinSessions
                  discord={discord}
                  busy={busy}
                  onJoinLink={(target, from) => {
                    setInviter({ link: target, name: from });
                    setInvitation(target);
                    // A saved name means nothing is left to ask: join right away.
                    if (name.trim()) void run(() => join(target));
                  }}
                />
              )
            }
            onInvitationChange={setInvitation}
            joinOpen={joinOpen}
            onJoinOpenChange={setJoinOpen}
            busy={busy}
            development={development}
            onOpen={() => void workspace.open()}
            keybinds={keybinds}
            shortcutsDisabled={settings || shareOpen || !!compatibilityPrompt || workspace.working}
            active={active}
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
            onShare={() => requestShare()}
            onInviteDiscord={
              discord.social.available && discord.connection.status === 'connected'
                ? () => requestShare('discord')
                : undefined
            }
          />
        )}
        <StatusBar
          start={
            document ? (
              <>
                {connection !== 'local' && (
                  <span className="statusbar-connection" data-state={connection} role="status">
                    {connection === 'sharing' || connection === 'connected' ? (
                      <Users size={14} aria-hidden="true" />
                    ) : (
                      <span className="statusbar-connection-dot" aria-hidden="true" />
                    )}
                    {connection === 'sharing'
                      ? 'Sharing'
                      : connection === 'connected'
                        ? guest
                          ? 'Connected'
                          : `Shared with ${participants.length - 1}`
                        : connection === 'connecting'
                          ? 'Connecting…'
                          : 'Disconnected'}
                  </span>
                )}
                <span className="statusbar-note" title={tab.file?.path}>
                  {tab.dirty
                    ? 'Unsaved changes'
                    : fileName
                      ? `Saved · ${fileName}`
                      : 'Not saved to a file'}
                </span>
              </>
            ) : opening || !overlay.state ? null : (
              <OverlayStatus state={overlay.state} onOpen={() => openSettings('Overlay')} />
            )
          }
          end={settingsButton}
        />
        <ToastRegion>
          {active && toasts}
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
                  <Button size="sm" variant="ghost" onClick={() => openSettings('About & updates')}>
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
      <Dialog
        open={active && !!capacity}
        title={
          capacity === 'limit'
            ? "You've reached the free limit"
            : savedPublic
              ? 'Our public servers are full right now'
              : 'This server is full right now'
        }
        onClose={() => setCapacity(null)}
      >
        <p>
          {capacity === 'limit'
            ? "You're already sharing as many documents as this server allows for one connection. Stop sharing another document, or configure your own server for more room."
            : "The server can't host another shared document right now. Try again in a few minutes, or configure your own server so sharing doesn't depend on shared capacity."}
        </p>
        <div className="dialog-actions">
          <Button onClick={() => setCapacity(null)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={() => {
              setCapacity(null);
              void run(() => share());
            }}
          >
            Try again
          </Button>
          <Button variant="primary" onClick={configureOwnServer}>
            Configure your own server
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={active && !!compatibilityPrompt}
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
      {/* Only the selected tab mounts Settings, so background tabs don't poll native state. */}
      {active && (
        <SettingsDialog
          open={settings}
          section={section}
          onSectionChange={setSection}
          onClose={() => {
            if (!updating) setSettings(false);
          }}
          updating={updating}
          busy={busy}
          updateAttention={updateAttention}
          onUpdateBusy={onUpdateBusy}
          name={name}
          onNameChange={saveDisplayName}
          discord={discord}
          restoreTabs={workspace.restore}
          onRestoreTabsChange={(enabled) => void workspace.configureRestore(enabled)}
          restoreTabsDisabled={workspace.working}
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
          accent={accent}
          systemAccent={systemAccent}
          onAccentChange={setAccent}
          hosting={hostingForm}
          notice={notice}
          error={error}
          onOpenUrl={(url) => {
            void openUrl(url).catch((cause) => setError(errorMessage(cause)));
          }}
        />
      )}
      {active && joinInProgress && (
        <Dialog
          open
          title="Joining session"
          onClose={() => {
            joining.current?.abort();
            decideCompatibility(false);
          }}
        >
          <p role="status">
            {awaitingApproval
              ? 'Waiting for the host to let you in. They approve each person before they join.'
              : notice || 'Connecting to host...'}
          </p>
          <p className="muted">
            {awaitingApproval
              ? 'You can cancel at any time. The host sees the name you entered.'
              : "Keep the host's Veil app open while connecting."}
          </p>
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
        open={active && shareOpen}
        onClose={closeShare}
        view={shareView}
        onViewChange={setShareView}
        started={!!session}
        link={link}
        othersConnected={Math.max(0, participants.length - 1)}
        joinMode={joinMode}
        onJoinModeChange={(mode) => {
          network.current?.setJoinMode(mode);
          setJoinMode(mode);
        }}
        name={name}
        onNameChange={saveDisplayName}
        busy={busy}
        hosting={hostingForm}
        chooseHosting={!savedServer || hostingStep}
        hostingSummary={hostingSummary}
        onChangeHosting={() => {
          setShareOpen(false);
          openSettings('Sharing');
        }}
        onSelfHosting={() => void openUrl(SELF_HOSTING_URL).catch((e) => setError(errorMessage(e)))}
        onStart={(view = 'main') => {
          setShareView(view);
          pendingPublicJoin.current = startPublicJoin;
          void run(startSharing);
        }}
        startPublicJoin={startPublicJoin}
        onStartPublicJoinChange={setStartPublicJoin}
        onCopy={() =>
          void run(async () => {
            await navigator.clipboard.writeText(link);
            setNotice('Link copied.');
          })
        }
        discord={discord}
        discordSelection={workspace.discordInvites.current}
        discordDocumentId={tab.id}
        discordElsewhere={discordElsewhere}
        onDiscordUse={() => {
          try {
            const moved = workspace.useDiscordFor(tab);
            if (pendingPublicJoin.current) workspace.setDiscordPublicJoin(tab, true);
            pendingPublicJoin.current = null;
            return moved;
          } catch (cause) {
            setError(errorMessage(cause));
            return null;
          }
        }}
        onDiscordPublicJoin={(publicJoin) => {
          try {
            workspace.setDiscordPublicJoin(tab, publicJoin);
          } catch (cause) {
            setError(errorMessage(cause));
          }
        }}
        onReset={() =>
          void run(async () => {
            workspace.clearDiscordInvites(tab.id);
            setLink(await network.current!.enableSharing(true));
            setNotice('New link ready. The previous link no longer accepts new people.');
          })
        }
        onStop={() =>
          void run(async () => {
            workspace.clearDiscordInvites(tab.id);
            await network.current!.stopSharing();
            setLink('');
            setNotice('Sharing stopped. Existing collaborators stay connected.');
          })
        }
        onEnable={() => void run(() => share())}
        notice={notice}
        error={error}
      />
    </div>
  );
}
