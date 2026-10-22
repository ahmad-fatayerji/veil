# Veil design system

Veil should feel like a calm, built-in Windows 11 utility where the document is the
main content. This file is the source of truth for the desktop control panel and the
overlay. The legacy desktop modes and the browser build (`DemoApp`) are frozen under
`.legacy-shell` and are not covered here.

## Principles

- **Content first.** The document is a single page; the interface around it stays quiet.
- **One primary action per screen.** Share in a document, nothing on the start screen.
- **No marketing copy.** Use sentence case and plain labels; no eyebrows or hero lines.
- **Honest privacy wording.** Only the overlay is excluded, and only from _compatible_
  capture. Never claim universal exclusion.
- **Nothing app-specific in OS chrome.** Document titles stay inside the app; window and
  taskbar titles appear in recordings.

## Styles

All styles live in `packages/ui/src/styles/` and load through `styles.css` in cascade
layers. A later layer wins, so a rule never has to be repeated to override another.

| Layer        | File                                  | Contains                                     |
| ------------ | ------------------------------------- | -------------------------------------------- |
| `tokens`     | `tokens.css`                          | Every color, type, spacing and motion value  |
| `base`       | `base.css`                            | Reset, focus ring, reduced motion            |
| `components` | `components.css`, `document.css`      | Shared controls and the editor               |
| `app`        | `app.css`                             | Title bar, launcher, document page, settings |
| `overlay`    | `apps/desktop/src/overlay/styles.css` | Overlay window and overlay settings          |
| `legacy`     | `legacy.css`                          | Frozen pre-redesign styles                   |

Components use semantic tokens only. Never write a hex value outside `tokens.css`. The
one exception is the capture test card, which must stay loud in a recording.

## Tokens

| Token                                  | Light                             | Dark                              |
| -------------------------------------- | --------------------------------- | --------------------------------- |
| `--bg` (window)                        | `#f3f3f3`                         | `#1c1c1c`                         |
| `--surface` (document, cards)          | `#ffffff`                         | `#242424`                         |
| `--surface-raised` (menus, dialogs)    | `#ffffff`                         | `#2c2c2c`                         |
| `--fg` / `--fg-muted`                  | `#1a1a1a` / `#5c5c5c`             | `#f0f0f0` / `#a8a8a8`             |
| `--border` / `--border-strong`         | `#e5e5e5` / `#d1d1d1`             | `#333333` / `#454545`             |
| `--accent` / `--on-accent`             | `#0f62d6` / `#ffffff`             | `#6ea8ff` / `#0b1a33`             |
| `--danger` / `--success` / `--warning` | `#c42b1c` / `#0f7b0f` / `#9d5d00` | `#ff99a4` / `#6ccb5f` / `#fce100` |

Text pairs meet WCAG AA in both themes. Use the accent only for the primary action,
selected state and focus.

### Type

- Fonts: `Segoe UI Variable Text` for UI, `Segoe UI Variable Display` for titles,
  `Cascadia Code` for code. These are system fonts, so nothing is downloaded.
- Scale: 12 / 13 / 14 (UI default) / 16 (document body) / 20 / 28.
- Weights: 400, 500 and 600 only.
- Document body: 16px, line height 1.65, full width with 48px side margins (20px below 700px).

### Space, shape, motion

- Spacing: 4, 8, 12, 16, 20, 24, 32, 48 (`--space-1` to `--space-8`).
- Radius: 4 (chips, kbd), 6 (controls), 8 (cards, menus, dialogs, the overlay window).
- Control heights: 28 (small), 32 (default), 40 (large).
- Elevation: `--shadow-flyout` for menus, tooltips and toasts; `--shadow-dialog` for dialogs.
- Motion: 120ms or 180ms with `--ease-out`. Animate only opacity and transform.
  Every animation is removed under `prefers-reduced-motion`.

## Components

Exported from `@veil/ui`:

- `Button`: primary, secondary, ghost, danger and danger-ghost variants in sm, md and lg sizes.
- `IconButton`: requires a `label`, which becomes the accessible name and the tooltip.
- `Field`, `Input`, `Textarea`, `Select`, `Switch`, `Slider` and `SegmentedControl`
  (radio semantics).
- `Menu` (Radix DropdownMenu), `Tooltip`, `Banner`, `ToastRegion`, `StatusIndicator`.
- `Avatar`, `AvatarStack`, `Kbd`, `Dialog`, `PeoplePanel`.

Icons come from `lucide-react` at 16px in controls and 18px in the title bar. Never use
text glyphs as icons.

`Dialog` is a native modal `<dialog>`. Tooltips render inline, so they keep working
inside dialogs. Mark the element that should receive focus on open with
`data-autofocus`.

## Screens

**Title bar.** One 40px frameless bar (the main window has no native decorations) that
doubles as the drag region. Layout:
`[Title ▾][status pill] …drag… [people][overlay][Share|copy][⚙] ─ ☐ ✕`.
The title is a Document menu trigger (Rename, Copy invite link for hosts with a link,
then Close document or Leave session in the danger tone). Status pill: Local, Sharing,
Connected, Connecting…, Disconnected (a dot only below 700px). Share is a split button for
hosts once a link exists: the attached copy segment copies the invite link. The Settings
gear is always in the same spot, followed by the Windows 11 caption buttons (46×40, close
turns `--caption-close` on hover). Shortcuts: Ctrl+W closes the document or leaves the
session, Ctrl+Shift+C copies the invite link (host). The People panel starts with an
invite row (link plus Copy, or "Share…" when not yet shared). On the start screen the
left side is just a muted "Veil" wordmark.

**Start screen.** A centered 640px block: "Veil" heading, one-line subtitle, then two
large cards side by side (stacked below 560px):

- New document (Ctrl+N) opens immediately, with no name prompt.
- Join with a link (Ctrl+J) replaces the cards with an inline form (Back, Escape or Cancel returns). Pasting a `veil://` link anywhere
  opens the form with the link filled in.

Your name is asked for only when it is needed: when joining, or on the first Share.

**Document.**

- A single flush page under the title bar, no outer frame: the toolbar, then any join requests, then the scrolling column.
- The column holds the synced title (`DOCUMENT_TITLE` Y.Text), then the body.
- People opens as a bordered side panel on wide windows and as a sheet below 900px.
- Join requests appear as banners above the document, not inside People.

**Overlay.**

- 8px corners, with the backdrop faded separately from the text.
- The header shows the synced title, a click-through chip and the recovery shortcut.
- Move and resize hints pair an icon with a word.
