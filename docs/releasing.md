# Windows releases (M6)

Source is private at `ahmad-fatayerji/Veil-source`; public installers, signed updater packages, release notes and tester instructions live at [ahmad-fatayerji/veil](https://github.com/ahmad-fatayerji/veil). Never put source, credentials or signing keys in the public repository. GitHub is used for distribution only, not collaboration or signaling. There is no purchased domain.

## Build locally

`pnpm package:windows` builds a production x64 NSIS installer and its updater signature under `target/release/bundle/nsis`. Per-user installation needs no administrator account for Veil itself. WebView2 is downloaded by Microsoft's bootstrapper only if missing. Friends need no Rust, Node, pnpm or local server.

The updater public key is embedded in the Tauri config. Its encrypted private key and password are stored outside the repository under `%USERPROFILE%/.veil/release-signing`, in a directory restricted to the current Windows user. Back up that directory privately. `scripts/init-signing.mjs` initializes a new key only if one does not already exist; do not run it to rotate a published release key. Private keys and passwords must never be logged, shared with testers or committed. The public key is safe to distribute.

The local build script loads those files into the child build's environment. CI instead provides `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets. The bundle creates a mandatory updater signature. This is distinct from Windows Authenticode: no publisher certificate is configured, so SmartScreen/unknown-publisher warnings may appear. Do not describe the executable as Windows signed.

Generate upload assets with `node scripts/release-manifest.mjs <installer-path>`. It copies the installer/signature, generates `latest.json`, SHA256 checksums and `TESTING.md` under `target/release/share`. Signature must contain the signature content; update URLs must use HTTPS. Both installer and manifest are versioned. Never replace assets under an existing version once users have downloaded them.

## Release workflow

`.github/workflows/release.yml` runs in the private source repository on version tags or manual dispatch. It validates the tag, runs builds/checks/tests, packages signed updates, and creates a **draft** release in the public repository. Review and publish the draft to make it available to the app's `/releases/latest/download/latest.json` feed. A draft or prerelease is not the stable latest release. Experimental stability is stated in release notes; publishing does not imply internet acceptance.

Configure these Actions repository secrets in the private source repository:

- `RELEASES_TOKEN`: a GitHub fine-grained personal access token restricted to the public `veil` repository with Contents read/write permission. The source repository's automatic `GITHUB_TOKEN` cannot write into a different repository. Do not embed a token in the installed app.
- `TAURI_SIGNING_PRIVATE_KEY`: the encrypted private key content from the private backup.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the corresponding password.

Create the restricted token through GitHub settings, then store it directly as an Actions repository secret. Do not reuse a broad login token or paste it into chat. Signing secrets can be uploaded from private files using stdin to `gh secret set`; do not print their contents. A protected release environment can be added later if the repository's plan supports it. The workflow does not publish a source website; the GitHub release page is the download page.

Before a new release, increment the Tauri version, desktop Cargo package version, desktop package version and root package version consistently; update Cargo/pnpm lockfiles and add matching notes under `docs/releases/<version>.md`. Keep the app identifier unchanged to retain preferences. Verify the release workflow with a real Actions run before calling CI publishing verified.

## Update behavior

Checks only occur on **Check for updates**, never automatically on startup. The native updater uses HTTPS and the embedded public key. A failed check clears stale candidates. Installation is explicitly requested and rejected while a document session or embedded host is active. Starting a new session is rejected during installation. Verified download and atomic preference flush precede launching the installer; Windows updater relaunches after installation. Failed download/signature/preferences/install steps show an error. The overlay cannot invoke updater administration.

Documents are still in memory. The updater never automatically ends a session or promises document persistence: copy text before ending/leaving, then install. Durable recovery belongs to M3. Preferences live in the same application config directory across versions and must survive an upgrade.

## Acceptance still required

Verify installed production app startup, P2P/overlay, signature rejection, session installation guard and local upgrade/preferences. A clean Windows VM without a development toolchain/WebView2 remains a separate test; local installer success does not cover bootstrap download, SmartScreen or a fresh user's machine. Version N → N+1 via the real HTTPS feed must be tested, and a private-to-public GitHub Actions release needs its own run. Different-network peer connections and a self-hosted TURN relay remain P1 internet acceptance.
