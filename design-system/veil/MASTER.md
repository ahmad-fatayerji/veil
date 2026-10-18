# Veil desktop workspace

The startup and document pages use a minimal, content-first desktop layout.
This adapts the UI/UX skill's Minimalism & Swiss Style guidance to Veil's
temporary document workflow. The overlay and legacy/browser interfaces retain
their existing styles.

## Visual rules

- Use the existing local Segoe UI font stack and official Veil mark. Load no
  remote fonts or new icon dependencies.
- Use a quiet canvas, raised controls, and a separate document surface. Reserve
  the accent for primary actions, selected controls, and focus.
- Use consistent outline icons; decorative icons are hidden from assistive
  technology. Icon buttons retain accessible names.
- Use 4/8px spacing increments, 8px control corners, 12px document/sidebar
  corners, and 16px startup-card corners.
- Use color/background feedback without layout shifts. Retain the shared
  reduced-motion preference.

| Token          | Light     | Dark      |
| -------------- | --------- | --------- |
| Canvas         | `#f4f5f8` | `#14161c` |
| Surface        | `#ffffff` | `#1c1f28` |
| Raised surface | `#fafbfe` | `#20242f` |
| Text           | `#242735` | `#eeeff6` |
| Secondary text | `#646b7d` | `#a2a9bd` |
| Border         | `#dce0e9` | `#353b4c` |
| Accent         | `#5358c5` | `#b3b4ff` |
| On accent      | `#ffffff` | `#1b1b32` |

## Startup page

Place a short introduction beside one Create/Join form. Keep local creation
immediate and the name optional. Preserve keyboard tab navigation, input labels,
deep-link entry, and explicit joining. Explain that documents are temporary and
important content must be copied. Stack the introduction and form in narrow
windows; hide the supplementary feature list when space is limited.

## Document page

Keep Share, People, and overlay visibility in the header. Keep close/leave away
from primary actions. Give the writing surface a compact toolbar and a readable
paragraph measure of approximately 76ch while retaining a full-width editor.
Keep the temporary-document notice visible below the surface.

Place People in a separate card aligned with the document surface. In narrow
windows, use a dismissible non-modal side panel. Return focus to the People
button when it is dismissed. Preserve participant names, activity, connection
details, and host approval controls.

Implementation: `apps/desktop/src/workspace.css`, scoped to `.automatic-workspace`.
