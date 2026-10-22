<div align="center">

<img src="packages/ui/src/assets/veil-icon.png" alt="Veil logo" width="88" />

# Veil

**Your notes. Your collaborators. Your overlay.**

A Windows workspace for Markdown notes, live collaboration, and an overlay that stays visible to you while compatible recordings capture what's underneath.

[**Download for Windows**](https://github.com/ahmad-fatayerji/veil/releases/latest) · [Get started](#get-started) · [Share a document](#share-a-document) · [Report an issue](https://github.com/ahmad-fatayerji/veil/issues)

[![Latest release](https://img.shields.io/github/v/release/ahmad-fatayerji/veil)](https://github.com/ahmad-fatayerji/veil/releases/latest) [![MIT license](https://img.shields.io/github/license/ahmad-fatayerji/veil)](LICENSE) [![Windows 10 / 11](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4)](https://github.com/ahmad-fatayerji/veil/releases/latest)

</div>

Keep talking points beside a presentation, work through a checklist during a call, or write with someone in real time. Start with a local document, open your own Markdown files, and share a tab when you need another pair of hands. No account is required.

> This README describes the current `develop` source. Features may reach the Windows installer in a later release; check the [release notes](https://github.com/ahmad-fatayerji/veil/releases) for your installed version.

## A workspace for your notes

- **Multiple documents, independent sessions.** Create, open, and switch between tabs. Each document can have its own shared session, and background tabs stay connected. The overlay follows your selected tab.
- **Rich text or Markdown.** Switch between formatted editing and Markdown source. Both views edit the same live document, including headings, emphasis, lists, nested checklists, quotes, code, and dividers. Your view choice stays local.
- **Files you control.** Open and save UTF-8 `.md` files with native Windows dialogs. Each participant can save a private local copy. Veil is available through **Open with** without replacing your default Markdown editor.
- **Live collaboration.** See named cursors, selections, and participant activity. Invite people with a short reusable link and choose automatic joining or approval for new guests.
- **An editable desktop overlay.** Move, resize, keep it on top, or let clicks pass through to the app underneath. Adjust font size, background opacity, and text opacity independently, or link the opacity sliders. Choose a compact formatting toolbar, a selection toolbar, or shortcuts only.
- **A setup that fits your desktop.** Choose light, dark, or system theme; follow your Windows accent color or pick your own. Rebind shortcuts, keep Veil in the tray, and optionally start it with Windows.

## Get started

1. [Download the latest Windows installer](https://github.com/ahmad-fatayerji/veil/releases/latest) and run the setup `.exe`. Veil supports **Windows 10 and 11, x64**; setup installs WebView2 if needed.
2. Choose **Create document** to start writing, or **Open** (`Ctrl+O`) to work with an existing Markdown file.
3. Choose **Show overlay** to bring the selected document onto your desktop. Customize it under **Settings → Overlay**.
4. Save with **Ctrl+S**. For a new document, choose a filename and folder; use **Ctrl+Shift+S** to save a separate copy.

Local writing does not need a sharing server. Unsaved changes prompt **Save / Discard / Cancel** before closing a tab or quitting. Optional **Settings → General → Reopen tabs and unsaved drafts** restores your workspace and crash drafts locally; it is off by default and does not replace saving your files.

See [document files, tabs, and recovery](docs/document-files.md) for details.

## Keep the overlay out of compatible captures

The overlay can remain on your screen while compatible recording and screen-sharing methods capture the content beneath it. **Exclude overlay from compatible captures** is enabled by default under **Settings → Overlay**.

Capture exclusion has been verified with OBS Display Capture using DXGI and Windows Graphics Capture, and FFmpeg GDI and DXGI capture on the documented Windows test machine. Results depend on the recorder and capture mode. **Check a saved recording or the remote viewer's screen before relying on it.** The main control panel remains capturable.

Use the built-in capture test and see [capture compatibility and recorded results](docs/capture-compatibility.md). Exclusion is a display feature, not encryption or access control.

| Default shortcut              | Action                                                |
| ----------------------------- | ----------------------------------------------------- |
| `Ctrl+Alt+V`                  | Restore interaction and bring back the control panel. |
| `Ctrl+Alt+Shift+V`            | Hide or show the overlay.                             |
| `Ctrl+N`                      | Create a document tab.                                |
| `Ctrl+J`                      | Join with a session link.                             |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch document tabs.                                 |
| `Ctrl+W`                      | Close the selected tab.                               |

Change assignments in **Settings → Keybinds**. Click-through requires a registered recovery shortcut; tray controls also let you recover the overlay. Closing the main window moves Veil to the tray by default and keeps your documents and sessions running. Choose **Quit Veil** from the tray to exit, or change the close behavior in Settings.

## Share a document

1. Open a document and choose **Share**. On first use, Veil opens **Settings → Sharing → Hosting server** so you can confirm your server choice.
2. Use **Veil's public servers**, or configure your own compatible server. Save the configuration to continue sharing the same document.
3. Choose **Copy link** and send it to your guests. They install Veil, open the link or paste it into **Join session**, enter a name, and join. Guests do not need to configure a server.
4. Keep the host app and shared tab open. The People panel shows participants and, when approval is required, incoming join requests.

**Auto join** is the default. Choose **Require approval** to review guests before they receive document access. Everyone admitted can read and edit; display names do not verify identity.

### Public servers or your own

Veil offers public hosting without a host credential. These are shared resources: the public tier allows **up to five guests per document**, limits sessions per connection and relay usage, and has no availability guarantee. If capacity is reached, Veil offers **Try again** or **Configure your own server**; your local document remains available.

For larger sessions or control over hosting, deploy [veil-server](https://github.com/ahmad-fatayerji/veil-server) or use another operator's compatible server. Enter its HTTPS address and, when required, an operator-issued host credential under **Settings → Sharing → Hosting server**. **Test connection** checks the configuration before you save it. Saved host credentials stay in Windows Credential Manager.

Veil itself has no application-level participant cap; a server's policy, device resources, and network capacity determine practical limits. Connections use a direct WebRTC path when available, with TURN relay fallback when needed. See [networking and server setup](docs/automatic-networking.md).

### Manage access

Treat invitation links as secrets. **Reset link** replaces the invitation, and **Stop sharing** blocks new joins; both cancel pending requests. Already admitted guests retain access until the session ends. Close the hosted shared tab or quit Veil to disconnect everyone. There is no host migration, and restoring a saved document does not reconnect its old session.

## Privacy and preferences

- **Encrypted collaboration.** Document traffic uses WebRTC DTLS, with authenticated host identity and separate encryption keys for each guest's signaling. Sharing servers do not receive document contents or the invitation root secret; operators can observe connection metadata and affect service availability.
- **Local storage.** Markdown files are saved where you choose. Optional tab and draft recovery stores snapshots on this device. Files and recovery drafts are not encrypted by Veil, and authorized participants can save, copy, or record shared content.
- **Discord activity.** Discord Rich Presence is enabled by default. When Discord is running and allows activity sharing, Veil shares the selected document's title and participant count. Under **Settings → Sharing → Discord**, hide either detail or disable the integration. Activity continues while Veil is in the tray.
- **Startup and updates.** Starting with Windows is optional and off by default; enabling it launches Veil quietly in the tray. Veil checks for updates in the background, while downloading and installing remain explicit. Choose stable or beta under Updates; package signatures are verified before installation.

Veil has not undergone an independent security audit. Updater signatures are separate from Windows publisher certificates: the installer currently lacks an Authenticode signature, so SmartScreen may show a warning. Read the [security model](docs/security.md), or [report a vulnerability privately](https://github.com/ahmad-fatayerji/veil/security/advisories/new).

## Build and contribute

The app is built with **Tauri, Rust, React, TypeScript, Tiptap, and Yjs**. This repository contains the desktop app, shared packages, development tools, and release automation. The production sharing server lives in [veil-server](https://github.com/ahmad-fatayerji/veil-server).

For Windows development, install Node.js **22.12+**, pnpm **10.30.1**, Rust, the Visual Studio C++ build tools, and WebView2:

```powershell
git clone --branch develop https://github.com/ahmad-fatayerji/veil.git
cd veil
pnpm install --frozen-lockfile
pnpm dev:desktop
```

| Path                        | Purpose                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `apps/desktop`              | Windows app, native integration, workspace, and overlay.              |
| `packages/editor`           | Shared rich text and Markdown editing.                                |
| `packages/collaboration`    | Document synchronization, peer connections, and session coordination. |
| `packages/protocol`         | Shared protocol types and compatibility declarations.                 |
| `packages/ui`               | Shared interface components and styling.                              |
| `apps/web`, `packages/host` | Retained browser and local development/test tools.                    |

Read [AGENTS.md](AGENTS.md) before contributing. Ordinary work starts from `develop` and is reviewed through PRs; `main` holds approved release source. The standalone development host listens on loopback and must not be exposed as a public service.

[Project specification](PROJECT_SPEC.md) · [Architecture](docs/architecture.md) · [Overlay](docs/overlay.md) · [Testing](docs/testing.md) · [Releases](docs/releasing.md)

Found a bug or have an idea? [Open an issue](https://github.com/ahmad-fatayerji/veil/issues) with your Veil version and steps to reproduce it.

## Star history

<a href="https://www.star-history.com/?repos=ahmad-fatayerji%2Fveil&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ahmad-fatayerji/veil&amp;type=Date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ahmad-fatayerji/veil&amp;type=Date" />
    <img src="https://api.star-history.com/svg?repos=ahmad-fatayerji/veil&amp;type=Date" alt="Veil's GitHub star history over time" width="800" />
  </picture>
</a>

## License

[MIT](LICENSE) © Ahmad Fatayerji. Free to use, modify, and distribute, including commercially, with the copyright and license notice retained.

Made by [Ahmad Fatayerji](https://ahmadfatayerji.com).
