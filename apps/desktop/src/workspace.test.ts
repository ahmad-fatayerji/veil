import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { PeerSession } from '@veil/collaboration';
import { documentFingerprint, loadMarkdown } from '@veil/editor';
import { DOCUMENT_TITLE, encodeShortLink, encodeServerInvitation } from '@veil/protocol';
import { invoke } from './overlay/api';
import { Workspace } from './workspace';

vi.mock('./AutomaticApp', () => ({ AutomaticApp: () => null }));
// The UI package reads `window` on import; these tests exercise only the Workspace model.
vi.mock('@veil/ui', () => ({}));
vi.mock('./overlay/session', () => ({
  SessionBridge: () => null,
  flushOverlay: vi.fn(async () => {}),
}));
vi.mock('./overlay/api', () => ({
  invoke: vi.fn(),
  errorMessage: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.useRealTimers();
});

function documentTab(workspace: Workspace, title: string) {
  const tab = workspace.add('new');
  const doc = new Y.Doc();
  loadMarkdown(doc, `# ${title}\n\nNotes\n`);
  workspace.attach(tab, { doc } as PeerSession);
  tab.close = vi.fn(async () => {});
  return tab;
}

describe('document workspace lifecycle', () => {
  it('rejects known host links and reset links locally before any lookup', () => {
    const workspace = new Workspace();
    const host = workspace.add('new');
    const guest = workspace.add('join');
    const links = ['A'.repeat(22), 'B'.repeat(21) + 'A'].map((code) =>
      encodeShortLink({ server: 'https://share.example.com', code }),
    );
    for (const link of links) workspace.claimInvitation(host, link);
    for (const link of links) {
      expect(() => workspace.claimInvitation(guest, ` ${link}\n`)).toThrow('already open');
      workspace.releaseSession(guest);
      expect(() => workspace.claimInvitation(guest, link)).toThrow('already open');
    }
    expect(invoke).not.toHaveBeenCalled();
    workspace.releaseSession(host);
    expect(() => workspace.claimInvitation(guest, links[0])).not.toThrow();
  });

  it('reserves short links while a join is still resolving and releases cancelled attempts', () => {
    const workspace = new Workspace();
    const first = workspace.add('join');
    const second = workspace.add('join');
    const link = encodeShortLink({ server: 'https://share.example.com', code: 'A'.repeat(22) });
    workspace.claimInvitation(first, link);
    expect(() => workspace.claimInvitation(second, link)).toThrow('already open');
    workspace.releaseSession(first);
    expect(() => workspace.claimInvitation(second, link)).not.toThrow();
    const separate = new Workspace();
    expect(() => separate.claimInvitation(separate.add('join'), link)).not.toThrow();
  });

  it('checks session identities from retained invitations without resolving the link', () => {
    const workspace = new Workspace();
    const host = workspace.add('new');
    const guest = workspace.add('join');
    const server = 'https://share.example.com';
    const sessionId = 'a'.repeat(32);
    workspace.claimSession(host, server, sessionId);
    const invitation = encodeServerInvitation({
      version: 2,
      server,
      sessionId,
      inviteId: 'b'.repeat(32),
      secret: 'c'.repeat(64),
      hostClientId: 1,
      expiresAt: Date.now() + 60_000,
    });
    expect(() => workspace.claimInvitation(guest, invitation)).toThrow('already open');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('blocks joining a hosted or pending session twice, even with different links', () => {
    const workspace = new Workspace();
    const host = workspace.add('new');
    const guest = workspace.add('join');
    workspace.claimSession(host, 'https://share.example.com', 'session');
    expect(() => workspace.claimSession(guest, 'https://share.example.com', 'session')).toThrow(
      'already open in another tab',
    );
    // A failed duplicate attempt cannot remove the original tab's reservation.
    workspace.releaseSession(guest);
    expect(() => workspace.claimSession(guest, 'https://share.example.com', 'session')).toThrow();
    workspace.releaseSession(host);
    workspace.claimSession(guest, 'https://share.example.com', 'session');
    const concurrent = workspace.add('join');
    expect(() =>
      workspace.claimSession(concurrent, 'https://share.example.com', 'session'),
    ).toThrow();
    workspace.releaseSession(guest);
    expect(() =>
      workspace.claimSession(concurrent, 'https://share.example.com', 'session'),
    ).not.toThrow();
  });

  it('allows independent sessions and the same session ID on another server', () => {
    const workspace = new Workspace();
    const first = workspace.add('new');
    const second = workspace.add('join');
    const third = workspace.add('join');
    workspace.claimSession(first, 'https://one.example.com', 'session');
    expect(() => workspace.claimSession(second, 'https://one.example.com', 'other')).not.toThrow();
    expect(() => workspace.claimSession(third, 'https://two.example.com', 'session')).not.toThrow();
  });

  it('recovers a draft locally and requires confirmation if its file changed while closed', async () => {
    vi.useFakeTimers();
    const workspace = new Workspace();
    const original = new Y.Doc();
    loadMarkdown(original, '# Original\n\nSaved\n');
    const baseline = documentFingerprint(original);
    original.destroy();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'workspace_load')
        return {
          enabled: true,
          warning: null,
          workspace: {
            activeId: 'recovered',
            tabs: [
              {
                id: 'recovered',
                path: 'C:\\Notes.md',
                markdown: '# Draft\n\nUnsaved work\n',
                dirty: true,
                baseline,
              },
            ],
          },
        };
      if (command === 'file_open')
        return { id: 'file-1', path: 'C:\\Notes.md', content: '# External\n\nEdited elsewhere\n' };
    });
    await workspace.initialize();
    const tab = workspace.active()!;
    expect(tab.externalChange).toBe(true);
    expect(tab.sharing).toBe(false);
    const doc = new Y.Doc();
    loadMarkdown(doc, tab.source!);
    workspace.attach(tab, { doc } as PeerSession);
    vi.spyOn(workspace, 'ask').mockResolvedValue('cancel');
    expect(await workspace.save(tab)).toBe(false);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'file_save')).toBe(false);
    expect(tab.document!.doc.getText(DOCUMENT_TITLE).toString()).toBe('Draft');
    vi.clearAllTimers();
    doc.destroy();
  });

  it('leaves edits that arrive during a save marked unsaved', async () => {
    const workspace = new Workspace();
    const tab = documentTab(workspace, 'Before');
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'file_save') {
        tab.document!.doc.getText(DOCUMENT_TITLE).insert(6, ' after');
        const request = (args as { request: { content: string } }).request;
        return {
          kind: 'saved',
          file: { id: 'file-1', path: 'C:\\Before.md', content: request.content },
        };
      }
    });
    expect(await workspace.save(tab)).toBe(true);
    expect(tab.dirty).toBe(true);
    expect(tab.file!.content).toContain('# Before\n');
    tab.document!.doc.destroy();
  });

  it('does not close or disconnect any tab when quitting is cancelled', async () => {
    const workspace = new Workspace();
    workspace.ready = true;
    const first = documentTab(workspace, 'First');
    const second = documentTab(workspace, 'Second');
    vi.spyOn(workspace, 'ask').mockResolvedValueOnce('discard').mockResolvedValueOnce('cancel');
    await workspace.quit();
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith('app_complete_quit');
    expect(workspace.tabs).toHaveLength(2);
    first.document!.doc.destroy();
    second.document!.doc.destroy();
  });

  it('quits after an action that was running when quitting was requested', async () => {
    const workspace = new Workspace();
    workspace.ready = true;
    let finish!: () => void;
    const running = workspace.run(() => new Promise<void>((done) => (finish = done)));
    void workspace.quit();
    expect(invoke).not.toHaveBeenCalledWith('app_complete_quit');
    finish();
    await running;
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('app_complete_quit'));
  });

  it('does not ask again when quitting is requested twice and then cancelled', async () => {
    const workspace = new Workspace();
    workspace.ready = true;
    const tab = documentTab(workspace, 'First');
    let answer!: (choice: 'cancel') => void;
    const ask = vi
      .spyOn(workspace, 'ask')
      .mockImplementation(() => new Promise((done) => (answer = done)));
    const quitting = workspace.quit();
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    void workspace.quit();
    answer('cancel');
    await quitting;
    await Promise.resolve();
    expect(ask).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalledWith('app_complete_quit');
    tab.document!.doc.destroy();
  });

  it('quits once the workspace is ready when quitting was requested during startup', async () => {
    const workspace = new Workspace();
    let load!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation((command) =>
      command === 'workspace_load'
        ? new Promise((done) => (load = done))
        : Promise.resolve(undefined),
    );
    const initializing = workspace.initialize();
    void workspace.quit();
    load({ enabled: false, workspace: null, warning: null });
    await initializing;
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('app_complete_quit'));
  });

  it('closes only the selected tab and preserves other sessions', async () => {
    const workspace = new Workspace();
    const first = documentTab(workspace, 'First');
    const second = documentTab(workspace, 'Second');
    vi.spyOn(workspace, 'ask').mockResolvedValue('discard');
    await workspace.close(first);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    expect(workspace.tabs).toEqual([second]);
    first.document!.doc.destroy();
    second.document!.doc.destroy();
  });

  it('keeps the tab open when a save dialog is cancelled or writing fails', async () => {
    const workspace = new Workspace();
    const tab = documentTab(workspace, 'Notes');
    vi.spyOn(workspace, 'ask').mockResolvedValue('save');
    vi.mocked(invoke).mockResolvedValueOnce({ kind: 'cancelled' });
    await workspace.close(tab);
    expect(tab.close).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Disk full'));
    await workspace.close(tab);
    expect(workspace.error).toContain('Disk full');
    expect(workspace.tabs).toContain(tab);
    expect(tab.dirty).toBe(true);
    tab.document!.doc.destroy();
  });

  it('replaces a pristine Home tab instead of leaving it behind', async () => {
    const workspace = new Workspace();
    const home = workspace.add('start');
    home.unsubscribe = vi.fn();
    workspace.newTab();
    expect(workspace.tabs).toHaveLength(1);
    expect(workspace.active()!.mode).toBe('new');
    expect(home.unsubscribe).toHaveBeenCalledOnce();

    const again = workspace.add('start');
    workspace.joinTab();
    expect(workspace.tabs.map((tab) => tab.mode)).toEqual(['new', 'join']);
    expect(workspace.tabs).not.toContain(again);

    workspace.add('start');
    vi.mocked(invoke).mockResolvedValueOnce({
      id: 'file-1',
      path: 'C:\\Notes.md',
      content: '# Notes\n',
    });
    await workspace.open('C:\\Notes.md');
    expect(workspace.tabs.map((tab) => tab.mode)).toEqual(['new', 'join', 'new']);
    expect(workspace.active()!.file?.path).toBe('C:\\Notes.md');
  });

  it('keeps a Home tab that is in use or not selected', () => {
    const workspace = new Workspace();
    const used = workspace.add('start');
    used.document = {} as PeerSession;
    workspace.newTab();
    expect(workspace.tabs).toContain(used);

    const busy = workspace.add('start', { busy: true });
    workspace.newTab();
    expect(workspace.tabs).toContain(busy);

    const background = workspace.add('start');
    workspace.select(used);
    workspace.newTab();
    expect(workspace.tabs).toContain(background);
  });

  it('removes discarded drafts from normal-quit recovery and reopens saved tabs from disk', async () => {
    vi.useFakeTimers();
    const workspace = new Workspace();
    workspace.ready = true;
    workspace.restore = true;
    const draft = documentTab(workspace, 'Draft');
    const saved = documentTab(workspace, 'Saved');
    saved.file = { id: 'file-1', path: 'C:\\Saved.md', content: '# Saved\n\nNotes\n' };
    vi.spyOn(workspace, 'ask').mockResolvedValue('discard');
    await workspace.quit();
    expect(invoke).toHaveBeenCalledWith('workspace_store', {
      enabled: true,
      workspace: {
        activeId: saved.id,
        tabs: [{ id: saved.id, path: 'C:\\Saved.md', markdown: '', dirty: false }],
      },
    });
    expect(invoke).toHaveBeenCalledWith('app_complete_quit');
    vi.clearAllTimers();
    draft.document!.doc.destroy();
    saved.document!.doc.destroy();
  });
});
