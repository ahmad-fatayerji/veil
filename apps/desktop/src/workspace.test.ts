import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { PeerSession } from '@veil/collaboration';
import { documentFingerprint, loadMarkdown } from '@veil/editor';
import { DOCUMENT_TITLE } from '@veil/protocol';
import { invoke } from './overlay/api';
import { Workspace } from './workspace';

vi.mock('./AutomaticApp', () => ({ AutomaticApp: () => null }));
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
