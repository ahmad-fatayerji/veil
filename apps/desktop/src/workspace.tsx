import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { ChevronDown, FolderOpen, Home, Link2, Plus, X } from 'lucide-react';
import * as Y from 'yjs';
import type { PeerSession } from '@veil/collaboration';
import {
  documentFingerprint,
  loadMarkdown,
  saveMarkdown,
  suggestedFilename,
  useDocumentTitle,
} from '@veil/editor';
import { DOCUMENT_TITLE, parseShareLink } from '@veil/protocol';
import {
  Banner,
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  useAppearance,
  useParticipants,
} from '@veil/ui';
import { useDiscordPresence } from './discord';
import { AutomaticApp } from './AutomaticApp';
import { SessionBridge, flushOverlay } from './overlay/session';
import { errorMessage, invoke, useOverlay } from './overlay/api';
import { defaultKeybinds, matchesShortcut, type Keybinds } from './keybinds';
import { TitleBar, connectionStates } from './shell/TitleBar';
import './workspace.css';

export interface DocumentFile {
  id: string;
  path: string;
  content: string;
}
interface RecoveryTab {
  id: string;
  path: string | null;
  markdown: string;
  dirty: boolean;
  baseline?: string | null;
}
interface RecoveryWorkspace {
  tabs: RecoveryTab[];
  activeId: string;
}
type SaveResult = { kind: 'cancelled' | 'conflict' } | { kind: 'saved'; file: DocumentFile };
type Choice = 'save' | 'discard' | 'cancel' | 'overwrite' | 'saveAs' | 'close';
interface Prompt {
  title: string;
  message: string;
  choices: { value: Choice; label: string }[];
  resolve: (choice: Choice) => void;
}

export interface WorkspaceTab {
  id: string;
  mode: 'start' | 'new' | 'join';
  source?: string;
  invitation?: string;
  file?: DocumentFile;
  recoveredDirty?: boolean;
  recoveredBaseline?: string | null;
  externalChange?: boolean;
  document: PeerSession | null;
  title: string;
  status: string;
  dirty: boolean;
  busy: boolean;
  hosted: boolean;
  sharing: boolean;
  baseline: string;
  close?: () => Promise<void>;
  unsubscribe?: () => void;
}

const emptyFingerprint = JSON.stringify(['', []]);
const id = () => crypto.randomUUID();

export class Workspace {
  tabs: WorkspaceTab[] = [];
  activeId = '';
  restore = false;
  ready = false;
  error = '';
  notice = '';
  working = false;
  prompt: Prompt | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryDeadline: ReturnType<typeof setTimeout> | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private pending: Promise<unknown> = Promise.resolve();
  private pathsWaiting = false;
  private linksWaiting: string[] = [];
  private exiting = false;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  changed = () => {
    this.version++;
    this.listeners.forEach((listener) => listener());
    if (this.ready && this.restore && !this.exiting) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = setTimeout(() => {
        void this.persist().catch((cause) => this.fail(cause));
      }, 700);
      this.recoveryDeadline ??= setTimeout(() => {
        void this.persist().catch((cause) => this.fail(cause));
      }, 5000);
    }
  };
  fail = (cause: unknown) => {
    this.error = errorMessage(cause);
    this.version++;
    this.listeners.forEach((listener) => listener());
  };
  dismiss = () => {
    this.error = '';
    this.notice = '';
    this.changed();
  };
  dismissNotice = () => {
    if (!this.notice) return;
    this.notice = '';
    this.changed();
  };
  active = () => this.tabs.find((tab) => tab.id === this.activeId);
  select = (tab: WorkspaceTab) => {
    this.activeId = tab.id;
    this.changed();
  };
  add(mode: WorkspaceTab['mode'], seed: Partial<WorkspaceTab> = {}) {
    const tab: WorkspaceTab = {
      id: id(),
      mode,
      document: null,
      title: '',
      status: 'local',
      dirty: false,
      busy: false,
      hosted: false,
      sharing: false,
      baseline: emptyFingerprint,
      ...seed,
    };
    // A pristine Home tab is replaced, so opening the first document never leaves it behind.
    const home = this.active();
    const index =
      mode !== 'start' && home?.mode === 'start' && !home.document && !home.busy
        ? this.tabs.indexOf(home)
        : -1;
    if (index >= 0) {
      home!.unsubscribe?.();
      this.tabs.splice(index, 1, tab);
    } else this.tabs.push(tab);
    this.select(tab);
    return tab;
  }
  selectIndex = (index: number) => {
    const tab = this.tabs[index];
    if (tab && !this.working) this.select(tab);
  };
  newTab = () => {
    if (!this.working) this.add('new');
  };
  joinTab = (invitation = '') => {
    if (invitation) {
      try {
        parseShareLink(invitation, true);
      } catch {
        this.fail('This invitation link is invalid. Ask the host for a new link.');
        return;
      }
    }
    if (this.working) this.linksWaiting.push(invitation);
    else this.add('join', { invitation });
  };
  update(tab: WorkspaceTab, patch: Partial<WorkspaceTab>) {
    Object.assign(tab, patch);
    this.changed();
  }
  attach(tab: WorkspaceTab, document: PeerSession | null) {
    tab.unsubscribe?.();
    tab.document = document;
    if (document) {
      if (tab.recoveredDirty && tab.recoveredBaseline) tab.baseline = tab.recoveredBaseline;
      else if (tab.file && !tab.recoveredDirty) tab.baseline = documentFingerprint(document.doc);
      else if (tab.file) {
        const saved = new Y.Doc();
        try {
          loadMarkdown(saved, tab.file.content, tab.file.path);
          tab.baseline = documentFingerprint(saved);
        } finally {
          saved.destroy();
        }
      }
      const update = () => {
        tab.title = document.doc.getText(DOCUMENT_TITLE).toString();
        tab.dirty = documentFingerprint(document.doc) !== tab.baseline;
        this.changed();
      };
      document.doc.on('update', update);
      tab.unsubscribe = () => document.doc.off('update', update);
      update();
    } else {
      tab.unsubscribe = undefined;
      this.changed();
    }
  }
  run = async (action: () => Promise<void>) => {
    if (this.working) return;
    this.working = true;
    this.error = '';
    this.changed();
    try {
      await action();
    } catch (cause) {
      this.fail(cause);
    } finally {
      this.working = false;
      for (const invitation of this.linksWaiting.splice(0)) this.joinTab(invitation);
      this.changed();
      if (this.pathsWaiting) {
        this.pathsWaiting = false;
        void this.receivePaths();
      }
    }
  };
  open = (path?: string) =>
    this.run(async () => {
      await this.openPath(path);
    });
  private async openPath(path?: string) {
    const file = await invoke<DocumentFile | null>('file_open', { path: path ?? null });
    if (!file) return;
    const existing = this.tabs.find((tab) => tab.file?.id === file.id);
    if (existing) {
      this.select(existing);
      return;
    }
    // Parse before adding a tab, so an invalid file cannot disrupt the workspace.
    const probe = new Y.Doc();
    try {
      loadMarkdown(probe, file.content, file.path);
    } catch (cause) {
      await invoke('file_release', { fileId: file.id });
      throw cause;
    } finally {
      probe.destroy();
    }
    this.add('new', { file, source: file.content });
  }
  receivePaths = () => {
    if (this.working) {
      this.pathsWaiting = true;
      return this.pending;
    }
    this.pending = this.pending
      .then(async () => {
        const paths = await invoke<string[]>('file_pending');
        await this.run(async () => {
          for (const path of paths) {
            try {
              await this.openPath(path);
            } catch (cause) {
              this.fail(cause);
            }
          }
        });
      })
      .catch(this.fail);
    return this.pending;
  };
  ask(title: string, message: string, choices: Prompt['choices']): Promise<Choice> {
    return new Promise((resolve) => {
      this.prompt = {
        title,
        message,
        choices,
        resolve: (choice) => {
          this.prompt = null;
          this.changed();
          resolve(choice);
        },
      };
      this.changed();
    });
  }
  async save(tab: WorkspaceTab, saveAs = false, overwrite = false): Promise<boolean> {
    if (!tab.document || tab.busy) return false;
    await flushOverlay();
    const doc = tab.document.doc;
    const fingerprint = documentFingerprint(doc);
    const content = saveMarkdown(doc);
    const result: SaveResult =
      tab.externalChange && !saveAs && !overwrite
        ? { kind: 'conflict' }
        : await invoke<SaveResult>('file_save', {
            request: {
              fileId: tab.file?.id ?? null,
              content,
              suggestedName: suggestedFilename(tab.title),
              saveAs,
              overwrite,
            },
          });
    if (result.kind === 'cancelled') return false;
    if (result.kind === 'conflict') {
      const choice = await this.ask(
        'File changed outside Veil',
        'Overwrite the external changes, or save your document to another file?',
        [
          { value: 'cancel', label: 'Cancel' },
          { value: 'saveAs', label: 'Save As…' },
          { value: 'overwrite', label: 'Overwrite' },
        ],
      );
      if (choice === 'cancel') return false;
      return this.save(tab, choice === 'saveAs', choice === 'overwrite');
    }
    if (result.kind !== 'saved') return false;
    tab.file = result.file;
    tab.externalChange = false;
    tab.baseline = fingerprint;
    tab.dirty = documentFingerprint(doc) !== fingerprint;
    // The status bar already shows "Saved"; only explain the less obvious outcome.
    if (tab.dirty) this.notice = 'Saved. Newer changes are still unsaved.';
    this.changed();
    return true;
  }
  private async resolveChanges(tab: WorkspaceTab): Promise<boolean> {
    if (tab.busy) {
      this.fail('Wait for this document’s current operation before closing it.');
      return false;
    }
    this.select(tab);
    if (tab.dirty) {
      const choice = await this.ask(
        `Save changes to ${tab.title || 'Untitled'}?`,
        'Save your changes before closing. Discard also deletes the local recovery draft.',
        [
          { value: 'cancel', label: 'Cancel' },
          { value: 'discard', label: 'Discard' },
          { value: 'save', label: 'Save' },
        ],
      );
      if (choice === 'cancel') return false;
      if (choice === 'save') {
        if (!(await this.save(tab))) return false;
        if (tab.dirty) {
          this.fail('New changes arrived while saving. Save again or discard them before closing.');
          return false;
        }
      }
    }
    if (tab.hosted && tab.sharing) {
      const confirmed = tab.document ? documentFingerprint(tab.document.doc) : '';
      const choice = await this.ask(
        'End this shared session?',
        'Everyone connected to this document will be disconnected. Other tabs will stay connected.',
        [
          { value: 'cancel', label: 'Cancel' },
          { value: 'close', label: 'End session' },
        ],
      );
      if (choice !== 'close') return false;
      if (tab.document && documentFingerprint(tab.document.doc) !== confirmed)
        throw new Error(
          'New changes arrived while confirming. Save or discard them before closing.',
        );
      return true;
    }
    return true;
  }
  close = (tab: WorkspaceTab) =>
    this.run(async () => {
      await flushOverlay();
      if (!(await this.resolveChanges(tab))) return;
      await tab.close?.();
      tab.unsubscribe?.();
      if (tab.file) await invoke('file_release', { fileId: tab.file.id });
      const index = this.tabs.indexOf(tab);
      this.tabs = this.tabs.filter((item) => item !== tab);
      if (this.activeId === tab.id)
        this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? '';
      if (!this.tabs.length) this.add('start');
      this.changed();
      await this.persist();
    });
  quit = () =>
    this.run(async () => {
      const selected = this.activeId;
      await flushOverlay();
      // Collect every decision before closing any connection, so Cancel preserves the workspace.
      const decisions = new Map<WorkspaceTab, string>();
      for (const tab of this.tabs) {
        if (!(await this.resolveChanges(tab))) return;
        if (tab.document) decisions.set(tab, documentFingerprint(tab.document.doc));
      }
      await flushOverlay();
      if (
        [...decisions].some(
          ([tab, fingerprint]) =>
            tab.document && documentFingerprint(tab.document.doc) !== fingerprint,
        )
      ) {
        throw new Error('Documents changed while quitting. Review the new changes and quit again.');
      }
      // After a normal quit, saved tabs reopen from disk. Discarded unnamed drafts never return.
      const workspace: RecoveryWorkspace = {
        activeId: selected,
        tabs: this.tabs
          .filter((tab) => tab.file)
          .map((tab) => ({ id: tab.id, path: tab.file!.path, markdown: '', dirty: false })),
      };
      await this.persist(workspace);
      this.exiting = true;
      try {
        await invoke('app_complete_quit');
      } catch (cause) {
        this.exiting = false;
        throw cause;
      }
    });
  configureRestore = (enabled: boolean) =>
    this.run(async () => {
      // Persist the choice first; failed writes must not claim recovery is enabled.
      await this.enqueueWrite(enabled, enabled ? this.recovery() : null);
      this.restore = enabled;
      clearTimeout(this.recoveryTimer);
      clearTimeout(this.recoveryDeadline);
      this.recoveryDeadline = undefined;
      this.changed();
    });
  private recovery(): RecoveryWorkspace {
    return {
      activeId: this.activeId,
      tabs: this.tabs
        .filter((tab) => tab.document || tab.source !== undefined)
        .map((tab) => ({
          id: tab.id,
          path: tab.file?.path ?? null,
          markdown: tab.document ? saveMarkdown(tab.document.doc) : tab.source!,
          dirty: tab.document ? tab.dirty : !!tab.recoveredDirty,
          baseline: tab.document ? tab.baseline : (tab.recoveredBaseline ?? tab.baseline),
        })),
    };
  }
  private enqueueWrite(enabled: boolean, workspace: RecoveryWorkspace | null) {
    const write = this.writes
      .catch(() => {})
      .then(() => invoke('workspace_store', { enabled, workspace }));
    this.writes = write;
    return write;
  }
  async persist(workspace?: RecoveryWorkspace) {
    clearTimeout(this.recoveryTimer);
    clearTimeout(this.recoveryDeadline);
    this.recoveryDeadline = undefined;
    if (this.ready)
      await this.enqueueWrite(this.restore, this.restore ? (workspace ?? this.recovery()) : null);
  }
  async initialize() {
    try {
      const recovery = await invoke<{
        enabled: boolean;
        workspace: RecoveryWorkspace | null;
        warning: string | null;
      }>('workspace_load');
      this.restore = recovery.enabled;
      if (recovery.warning) this.error = recovery.warning;
      if (this.restore && recovery.workspace) {
        if (
          !Array.isArray(recovery.workspace.tabs) ||
          typeof recovery.workspace.activeId !== 'string'
        )
          throw new Error(
            'Saved workspace recovery is damaged. Existing files have not been changed.',
          );
        for (const entry of recovery.workspace.tabs) {
          try {
            if (
              !entry ||
              typeof entry.id !== 'string' ||
              typeof entry.markdown !== 'string' ||
              typeof entry.dirty !== 'boolean' ||
              !(entry.path === null || typeof entry.path === 'string') ||
              this.tabs.some((tab) => tab.id === entry.id)
            )
              throw new Error('A damaged recovery tab could not be reopened.');
            const file = entry.path
              ? await invoke<DocumentFile | null>('file_open', { path: entry.path }).catch(
                  () => null,
                )
              : null;
            if (!file && !entry.dirty) {
              if (entry.path) this.error = `A saved file could not be reopened: ${entry.path}`;
              continue;
            }
            if (file && this.tabs.some((tab) => tab.file?.id === file.id)) continue;
            const source = entry.dirty ? entry.markdown : file!.content;
            const probe = new Y.Doc();
            let externalChange = false;
            try {
              loadMarkdown(probe, source, file?.path);
              if (file && entry.dirty && typeof entry.baseline === 'string') {
                const disk = new Y.Doc();
                try {
                  loadMarkdown(disk, file.content, file.path);
                  externalChange = documentFingerprint(disk) !== entry.baseline;
                } finally {
                  disk.destroy();
                }
              }
            } finally {
              probe.destroy();
            }
            this.add('new', {
              id: entry.id,
              file: file ?? undefined,
              source,
              recoveredDirty: entry.dirty,
              recoveredBaseline: entry.baseline,
              externalChange,
            });
            if (!file && entry.path)
              this.error =
                'A missing file was recovered as an unsaved draft. Use Save As to choose a location.';
          } catch (cause) {
            this.fail(cause);
          }
        }
        if (this.tabs.some((tab) => tab.id === recovery.workspace!.activeId))
          this.activeId = recovery.workspace.activeId;
      }
    } catch (cause) {
      this.fail(cause);
    }
    if (!this.tabs.length) this.add('start');
    this.ready = true;
    // Do not overwrite recovery until tab engines have attached their restored documents.
    this.version++;
    this.listeners.forEach((listener) => listener());
  }
}

export function DocumentWorkspace() {
  const [workspace] = useState(() => new Workspace());
  useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const overlay = useOverlay();
  const keybinds = overlay.state?.settings.keybinds ?? defaultKeybinds;
  const activeId = workspace.activeId;
  const selectedDocument = workspace.active()?.document ?? null;
  const selectedTitle = useDocumentTitle(selectedDocument?.doc);
  const participants = useParticipants(selectedDocument);
  const discord = useDiscordPresence(
    selectedDocument ? selectedTitle : null,
    participants.filter((person) => !person.local).length,
  );
  const appearanceSettings = useAppearance();
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    document
      .getElementById(`tab-${activeId}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);
  // Informational notices are transient; errors stay until dismissed.
  const notice = workspace.notice;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(workspace.dismissNotice, 5000);
    return () => clearTimeout(timer);
  }, [workspace, notice]);
  useEffect(() => {
    let active = true;
    let initialized = false;
    const paths = listen('files-pending', () => {
      if (initialized) void workspace.receivePaths();
    });
    const quitting = listen('app-quit-requested', () => {
      if (initialized) void workspace.quit();
    });
    const receiveLinks = (urls: string[]) => {
      if (!active) return;
      for (const url of urls.filter((url) => url.startsWith('veil:'))) workspace.joinTab(url);
    };
    const links = onOpenUrl(receiveLinks);
    // Delay initialization until subscriptions are ready. Strict Mode's discarded effect cannot consume recovery or file arguments.
    void Promise.allSettled([paths, quitting, links])
      .then(async (subscriptions) => {
        if (!active) return;
        for (const subscription of subscriptions)
          if (subscription.status === 'rejected') workspace.fail(subscription.reason);
        await workspace.initialize();
        if (!active) return;
        initialized = true;
        await workspace.receivePaths();
        const urls = await getCurrent();
        if (urls) receiveLinks(urls);
      })
      .catch(workspace.fail);
    return () => {
      active = false;
      for (const listener of [paths, quitting, links])
        void listener.then((stop) => stop()).catch(() => {});
    };
  }, [workspace]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !workspace.ready ||
        workspace.working ||
        workspace.prompt ||
        document.querySelector('dialog[open]') ||
        event.repeat ||
        event.isComposing
      )
        return;
      const action = (Object.keys(keybinds) as (keyof typeof keybinds)[]).find((action) =>
        matchesShortcut(event, keybinds[action]),
      );
      const commands = [
        'newDocument',
        'joinDocument',
        'closeDocument',
        'openDocument',
        'saveDocument',
        'saveDocumentAs',
      ];
      const cycle =
        (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'tab';
      // Ctrl+1–8 select a tab and Ctrl+9 the last one, unless a custom keybind claims them.
      const digit =
        !action &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        /^Digit[1-9]$/.test(event.code)
          ? Number(event.code.slice(5))
          : 0;
      if (digit) {
        event.preventDefault();
        event.stopImmediatePropagation();
        workspace.selectIndex(digit === 9 ? workspace.tabs.length - 1 : digit - 1);
        return;
      }
      if (!cycle && (!action || !commands.includes(action))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const tab = workspace.active();
      if (action === 'newDocument') workspace.newTab();
      else if (action === 'joinDocument') workspace.joinTab();
      else if (action === 'openDocument') void workspace.open();
      else if (action === 'closeDocument' && tab) void workspace.close(tab);
      else if ((action === 'saveDocument' || action === 'saveDocumentAs') && tab?.document)
        void workspace.run(async () => {
          await workspace.save(tab, action === 'saveDocumentAs');
        });
      else if (cycle) {
        const index = workspace.tabs.findIndex((tab) => tab.id === workspace.activeId);
        workspace.select(
          workspace.tabs[
            (index + (event.shiftKey ? -1 : 1) + workspace.tabs.length) % workspace.tabs.length
          ],
        );
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [workspace, keybinds]);
  if (!workspace.ready) return <p role="status">Opening workspace…</p>;
  const toasts = (
    <>
      {workspace.notice && (
        <Banner tone="info" role="status" className="toast" onDismiss={workspace.dismissNotice}>
          {workspace.notice}
        </Banner>
      )}
      {workspace.error && (
        <Banner tone="danger" role="alert" className="toast" onDismiss={workspace.dismiss}>
          {workspace.error}
        </Banner>
      )}
    </>
  );
  return (
    <div className="document-workspace" aria-busy={workspace.working}>
      <TitleBar
        tabs={<TabStrip workspace={workspace} keybinds={keybinds} />}
        end={<div ref={setActionsSlot} className="titlebar-tab-actions" />}
      />
      {workspace.tabs.map((tab) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== workspace.activeId}
          inert={workspace.working}
          className="workspace-panel"
        >
          <AutomaticApp
            tab={tab}
            workspace={workspace}
            active={tab.id === workspace.activeId}
            discord={discord}
            appearanceSettings={appearanceSettings}
            actionsSlot={actionsSlot}
            toasts={toasts}
          />
        </div>
      ))}
      <SessionBridge
        connection={workspace.active()?.document ?? null}
        resolveDocument={(sessionId) =>
          workspace.tabs.find((tab) => String(tab.document?.doc.clientID) === sessionId)
            ?.document ?? null
        }
      />
      <Dialog
        open={!!workspace.prompt}
        title={workspace.prompt?.title ?? ''}
        onClose={() => workspace.prompt?.resolve('cancel')}
      >
        <p>{workspace.prompt?.message}</p>
        <div className="dialog-actions">
          {workspace.prompt?.choices.map((choice) => (
            <Button
              key={choice.value}
              variant={
                choice.value === 'discard' || choice.value === 'overwrite'
                  ? 'danger'
                  : choice.value === 'save'
                    ? 'primary'
                    : 'secondary'
              }
              onClick={() => workspace.prompt?.resolve(choice.value)}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

function tabLabel(tab: WorkspaceTab) {
  if (tab.title) return tab.title;
  if (tab.document) return 'Untitled';
  return tab.mode === 'start' ? 'Home' : tab.mode === 'join' ? 'Join session' : 'Untitled';
}

function TabIcon({ tab }: { tab: WorkspaceTab }) {
  if (!tab.document && tab.mode === 'start')
    return <Home size={14} className="workspace-tab-icon" aria-hidden="true" />;
  if (tab.status === 'sharing')
    return <Link2 size={14} className="workspace-tab-icon" aria-hidden="true" />;
  if (!(tab.status in connectionStates) || tab.status === 'local') return null;
  const { tone } = connectionStates[tab.status as keyof typeof connectionStates];
  return (
    <span
      className="workspace-tab-dot"
      data-tone={tone}
      data-state={tab.status}
      aria-hidden="true"
    />
  );
}

function TabStrip({ workspace, keybinds }: { workspace: Workspace; keybinds: Keybinds }) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState('');
  // Fade each edge that hides tabs; recomputed after every render, resize and scroll.
  const measure = useCallback(() => {
    const element = strip.current;
    if (!element) return;
    const start = element.scrollLeft > 1;
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setEdges([start && 'start', end && 'end'].filter(Boolean).join(' '));
  }, []);
  useEffect(measure);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  const onlyHome =
    workspace.tabs.length === 1 &&
    workspace.tabs[0].mode === 'start' &&
    !workspace.tabs[0].document;
  return (
    <div className="workspace-tabbar">
      <div className="workspace-tabs-viewport" data-overflow={edges || undefined}>
        <div
          ref={strip}
          className="workspace-tabs"
          role="tablist"
          aria-label="Documents"
          onScroll={measure}
          onWheel={(event) => {
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
              event.currentTarget.scrollLeft += event.deltaY;
          }}
        >
          {workspace.tabs.map((tab, index) => {
            const active = tab.id === workspace.activeId;
            const label = tabLabel(tab);
            const status =
              tab.status in connectionStates && tab.status !== 'local'
                ? connectionStates[tab.status as keyof typeof connectionStates].label
                : '';
            const details = [tab.file?.path, status, tab.dirty && 'Unsaved changes'].filter(
              Boolean,
            );
            return (
              <div
                key={tab.id}
                className="workspace-tab"
                data-active={active}
                data-dirty={tab.dirty || undefined}
                // Prevent Windows middle-button autoscroll so middle-click can close the tab.
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button !== 1 || onlyHome) return;
                  event.preventDefault();
                  void workspace.close(tab);
                }}
              >
                <Tooltip
                  content={
                    <span className="workspace-tab-tooltip">
                      <strong>{label}</strong>
                      {details.map((detail) => (
                        <span key={String(detail)}>{detail}</span>
                      ))}
                    </span>
                  }
                >
                  <button
                    id={`tab-${tab.id}`}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    aria-controls={`panel-${tab.id}`}
                    aria-disabled={workspace.working || undefined}
                    tabIndex={active ? 0 : -1}
                    onClick={() => {
                      if (!workspace.working) workspace.select(tab);
                    }}
                    onKeyDown={(event) => {
                      const count = workspace.tabs.length;
                      const next =
                        event.key === 'ArrowRight'
                          ? (index + 1) % count
                          : event.key === 'ArrowLeft'
                            ? (index - 1 + count) % count
                            : event.key === 'Home'
                              ? 0
                              : event.key === 'End'
                                ? count - 1
                                : -1;
                      if (next < 0 || workspace.working) return;
                      event.preventDefault();
                      workspace.select(workspace.tabs[next]);
                      document.getElementById(`tab-${workspace.tabs[next].id}`)?.focus();
                    }}
                  >
                    <TabIcon tab={tab} />
                    <span className="workspace-tab-title">{label}</span>
                    {tab.dirty && <span className="visually-hidden">, unsaved changes</span>}
                  </button>
                </Tooltip>
                {!onlyHome && (
                  <button
                    type="button"
                    className="workspace-tab-close"
                    tabIndex={-1}
                    aria-label={`Close ${label}`}
                    aria-disabled={workspace.working || undefined}
                    onClick={() => void workspace.close(tab)}
                  >
                    <span className="workspace-tab-unsaved" aria-hidden="true" />
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="workspace-new">
        <IconButton label="New document" shortcut={keybinds.newDocument} onClick={workspace.newTab}>
          <Plus size={16} aria-hidden="true" />
        </IconButton>
        <Menu
          label="Open or join"
          align="start"
          triggerClassName="icon-btn workspace-new-more"
          trigger={<ChevronDown size={14} aria-hidden="true" />}
        >
          <MenuItem
            icon={<FolderOpen size={16} aria-hidden="true" />}
            shortcut={keybinds.openDocument}
            onSelect={() => void workspace.open()}
          >
            Open file…
          </MenuItem>
          <MenuItem
            icon={<Link2 size={16} aria-hidden="true" />}
            shortcut={keybinds.joinDocument}
            onSelect={() => workspace.joinTab()}
          >
            Join with link…
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}
