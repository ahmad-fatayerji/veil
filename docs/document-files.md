# Document files, tabs, and recovery

Use **Open** (`Ctrl+O`) to choose a UTF-8 Markdown (`.md`) file with the native
Windows picker. Opening adds a tab; reopening the same file selects its existing
tab. The installed app is an optional **Open with Veil** handler for Markdown.
Installation does not change your default Markdown editor.

**Save** (`Ctrl+S`) writes to the tab's existing file. On the first save, choose a
filename and folder in the Windows Save As dialog. **Save As** (`Ctrl+Shift+S`)
chooses a different location. Renaming the shared document title does not rename
its file. The title becomes a leading `# Heading`; opening a leading H1 moves it
into Veil's title field. Without a leading H1, the filename supplies the title.
Headings, emphasis, lists, nested checklists, quotes, code, and dividers retain
their formatting. Unsupported constructs remain visible as literal Markdown.
Files must be UTF-8 and at most 16 MiB; recovery data is also limited to 16 MiB.

Tabs live in the window's title bar. Each tab shows a dot for unsaved changes,
which becomes a close button on hover, and an icon for its connection: a link
while sharing, and a green, amber, or red dot when connected, connecting, or
disconnected. Hover a tab for its file path and status. **+** (`Ctrl+N`) creates a
document; the arrow next to it offers **Open file…** and **Join with link…**
(`Ctrl+J`). Starting from a blank **Home** tab replaces it. Use `Ctrl+Tab` /
`Ctrl+Shift+Tab` or `Ctrl+1`–`Ctrl+8` to navigate (`Ctrl+9` selects the last
tab), and `Ctrl+W` or a middle-click to close. The **⋯** document menu holds
Save, Save As, Rename, Copy invite link, and Close or Leave.
Each tab has its own editor history and optional host or guest session.
Background sessions stay connected. Share, People, Discord activity, and the
overlay follow the selected tab. Strikethrough uses `Ctrl+Shift+X`. File and document
shortcuts can be changed in **Settings → Keybinds**. Existing custom assignments
are preserved; if a new file shortcut would conflict, Veil assigns that new action
a free shortcut shown in Settings and the document menu.

Each participant can save a local copy of the shared title and notes. File paths,
save status, and recovery settings are private to their device. Remote and overlay
edits also make a document unsaved. Save writes a snapshot; newer changes stay
marked unsaved. Writes replace files atomically; cancellation and failures preserve
the document. External changes require explicit overwrite or Save As. Veil does
not automatically reload externally edited files.

Closing an unsaved tab or quitting offers **Save / Discard / Cancel**. A failed
or cancelled save leaves the document open. Closing a hosted shared tab also
warns that its participants will disconnect. Other tabs remain connected.
Quitting resolves every tab before exiting; cancelling preserves all sessions.
Closing the main window to the tray keeps the workspace running normally.

**Settings → General → Reopen tabs and unsaved drafts** is off by default.
Enabling it stores recovery snapshots locally without automatically saving your
Markdown files. On normal quit, you still save or discard unsaved work. Discard
deletes the draft; saved tabs reopen from disk. After an unexpected exit, drafts
can restore unsaved work as local documents without reconnecting sessions. A
missing saved file with a draft recovers as an unnamed document for Save As.
Missing files without drafts and damaged recovery records show a notice. Damaged
recovery files are backed up before replacement for manual recovery.

Disabling recovery removes stored snapshots and keeps current documents open.
Saved files and recovery data are not encrypted by Veil; see [security and
privacy](security.md). Recovery cannot guarantee preservation of edits immediately
before a crash or recovery write failure. Save important work to a file.
