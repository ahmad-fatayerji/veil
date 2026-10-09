# Gitflow and Windows releases (M6)

Source stays private in `ahmad-fatayerji/Veil-source`. Installers, signed update packages, public release notes and tester instructions live in [ahmad-fatayerji/veil](https://github.com/ahmad-fatayerji/veil). GitHub distributes the app; it does not handle peer signaling. No purchased domain is needed.

## Everyday work and merges

`main` contains approved release source; `develop` integrates the next release. Both require PRs, a successful **CI gate**, resolved conversations and an up-to-date branch. Direct pushes, force pushes and deletion are blocked, with no administrator bypass. External approvals are zero while there is one contributor.

```powershell
git switch develop
git pull --ff-only
git switch -c feature/reconnect
# Make changes, run the relevant tests, and commit.
git add .
git commit -m "fix: reconnect after losing connection"
git push -u origin feature/reconnect
gh pr create --base develop --title "fix: reconnect after losing connection"
```

Use Conventional Commit PR titles: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:` or `revert:`, optionally with a scope. Use `!` or a `BREAKING CHANGE:` footer for incompatible changes. Feature PRs squash so the reviewed title becomes the commit used for version proposals.

After checks pass, run **Actions → Merge Gitflow PR → Run workflow** on `main`, entering the PR number. This action chooses squash for `feature/*` PRs and merge commits for releases, hotfixes and `main → develop`. It matches the reviewed head SHA and obeys required checks. It also explicitly dispatches subsequent workflows because a `GITHUB_TOKEN` merge does not automatically trigger ordinary push/closed-PR workflows.

```powershell
gh workflow run merge-pr.yml --ref main -f number=123
```

GitHub's native merge buttons can also be used: squash feature PRs and use **Create a merge commit** for release/hotfix/back-merge PRs. Rules restrict `main` to merge commits. `develop` allows squash and merge because GitHub cannot enforce different methods based on the source branch; the Merge Gitflow PR action selects correctly. Rebase merging is disabled. Automatic back-merges use `backmerge/<version>` branches based on `develop`, with `main` merged into them. This satisfies strict up-to-date checks without bringing unreleased features into `main`. If develop advances, update the back-merge branch before merging.

CI separates JavaScript checks/unit tests/builds, Windows Rust formatting/checks/Clippy/tests, and the Windows Tauri build/browser integration tests. Its aggregate gate rejects failed, cancelled, skipped or missing required jobs. Superseded PR runs cancel; dependencies are cached and browser failure artifacts retained. PR checks never receive signing secrets. Interactive overlay/P2P/update acceptance runs locally.
Release validation and unsigned production compilation run in parallel. Signing waits for both to succeed and restores only a same-run executable with matching source SHA, version and checksum. The signing job bundles that executable without compiling it again. Signature verification lives in a small standalone Rust crate, avoiding a second desktop test build. Windows jobs use separate cache namespaces and reduced debug information in CI; timing and build-environment artifacts help diagnose cache misses.

## Prepare and test a release

Feature merges never publish installers. When you are ready, run **Prepare release** on `main`, with `source=develop`:

```powershell
gh workflow run prepare-release.yml --ref main -f source=develop
```

The coordinator requires the last stable source to have been back-merged into `develop`. It reads commits since `.release/baseline.json`, proposes a version, creates `release/<version>`, synchronizes all app manifests/Cargo lock metadata, and opens a draft PR into `main`. The root and desktop npm manifests, Tauri configuration, and desktop Cargo package share one version. Internal packages are not independently released; pnpm importers have no version field and CI validates the frozen lockfile.

Before 1.0, features or breaking changes propose a minor bump; other changes propose a patch. At 1.0 and above, breaking changes propose a major bump. No new changes means no release. Release-management commits are omitted from proposals and notes. Public notes contain commit subjects, not private commit bodies or source links: review them before publication.

The candidate starts at, for example, `0.2.0-beta.1`. Before the first beta, you may adjust the proposal by updating `.release/candidate.json`'s `targetVersion` and synchronizing versions with the exported `setVersion` helper:

```powershell
git switch release/0.2.0
# Edit targetVersion in .release/candidate.json, then:
node --input-type=module -e "import { setVersion } from './scripts/release-files.mjs'; setVersion('0.3.0-beta.1');"
pnpm release:verify
git add .
git commit -m "chore(release): revise proposal to 0.3.0"
git push
```

Keep `candidate.branch` equal to the actual branch name. Publish beta regenerates notes for the revised version. Never change an already published version; fixes get a new numbered beta. Create stabilization changes on `feature/*` branches from the candidate and PR them back into the candidate branch.

Request a beta only when you want testers to receive one:

```powershell
gh workflow run beta.yml --ref main -f branch=release/0.2.0
```

The action allocates the first unused numbered beta, validates its exact source SHA, builds a signed installer, verifies its signature and tamper rejection, and publishes a GitHub prerelease. Uploads remain a draft until downloaded assets match their local bytes. Only then does `updates/beta.json` advance. Every candidate carries reviewed notes, source SHA, workflow run/attempt, package checksum and signed manifest. A beta never becomes stable latest.

Draft release PRs intentionally cannot pass the final stable branch-policy check while their version has a beta suffix. Beta publication uses a separately named candidate validation gate. After testing, finalize:

```powershell
gh workflow run finalize-release.yml --ref main -f branch=release/0.2.0
```

Finalization requires current `main` to be included, removes the beta suffix, refreshes notes and the next baseline, and marks the PR ready. Review the final version, notes and CI. Merge the release PR with a merge commit to approve stable publication. The exact merged source is validated again; signing follows successful checks. The source tag points to that merged private commit. Public tags belong to the separate downloads repository, so `release-metadata.json` is the source provenance record.

Stable publication builds the final version; it does not relabel a beta installer. The workflow uploads and verifies a draft, then publishes it and marks it stable latest when newer. It advances the beta feed to the stable version unless that feed already contains a newer candidate. It opens a `backmerge/<version> → develop` PR carrying main's history: merge that with a merge commit before preparing another release. **Back-merge main** can request this PR separately if needed. Closed release branches may be deleted once their source tags and merge history are retained.

## Hotfixes and recovery

For an urgent compatible fix, branch from `main`, commit the fix and prepare that existing branch:

```powershell
git switch main
git pull --ff-only
git switch -c hotfix/reconnect
# Fix and test.
git add .
git commit -m "fix: restore reconnect"
git push -u origin hotfix/reconnect
gh workflow run prepare-release.yml --ref main -f source=hotfix/reconnect
```

Hotfixes use the same beta/finalize/review/merge/publication steps and propose a patch. Features and breaking changes are rejected in hotfix preparation. Back-merge the result into `develop` and any active release branch before finalizing that release. The finalizer uses the updated main baseline so already released hotfixes are not repeated in its notes.

For a failed beta build/upload, use **Re-run failed jobs** on that workflow run to retain its exact version/SHA. A new Publish beta request after a published beta allocates the next number. Retry a failed stable release with its original merged SHA:

```powershell
gh workflow run release.yml --ref main -f ref=FULL_MERGED_COMMIT_SHA
```

Retries may complete an unpublished draft. A published version must match its recorded source SHA; its installer, signature and manifest are never overwritten. A feed retry uses the original published manifest, not a rebuilt signature. Feeds never move backwards. Concurrency serializes public publication; a failed upload leaves the previous feed intact. If publication succeeds but feed/back-merge work fails, rerun to complete it. Arbitrary feature source, prerelease stable source, non-merge stable source and inconsistent versions are rejected before signing.

The migration baseline is source `0f008872ed112fbb339ae37dd5f950891affb154` at `0.1.2`. Public `v0.1.2` is reserved; this migration does not publish or replace it. Subsequent baselines refer to private stable source tags. The initial beta feed points to the current stable release until a beta is requested.

## Updater channels and signing

**App updates → Update channel** selects stable or beta, persisted locally in `update-channel.json`. Stable is the default and retains the existing `/releases/latest/download/latest.json` endpoint for installed clients. Beta uses the public repository's `updates/beta.json` through HTTPS. Switching clears any pending candidate and makes no network request. Checks occur only on **Check for updates**, never on startup.

Both channels require the embedded public key and a newer version. Switching from a newer beta to stable waits for a newer stable release; it does not downgrade. Update installation is explicit and blocked while a document or embedded host is active. The overlay cannot administer updates. Preferences are retained; documents are temporary and must be copied before ending a session. Channel settings do not enter the shared document.

Existing private source Actions secrets remain:

- `RELEASES_TOKEN`: public `veil` Contents read/write only.
- `TAURI_SIGNING_PRIVATE_KEY`: encrypted updater private key.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.

Source branch/PR operations use the built-in `GITHUB_TOKEN`; Actions must be allowed to create PRs. No token is embedded in the app. Back up `%USERPROFILE%/.veil/release-signing` privately. Never log, share or commit the private key/password. Keep the application identifier and embedded public key stable. Updater signatures are distinct from Windows Authenticode; unknown-publisher/SmartScreen warnings may still appear.

For local packaging, `pnpm package:windows` builds the per-user x64 NSIS installer and signature. `node scripts/release-manifest.mjs <installer>` prepares the release assets. WebView2 downloads only if missing. Testers need no development toolchain.

## Verification boundaries

Run `pnpm check`, `pnpm test`, `pnpm test:release` and `pnpm test:e2e`. After Cargo tests, rebuild with `pnpm --filter @veil/desktop tauri build --debug --no-bundle`, then run `pnpm test:updates` for real WebView2 channel persistence and authorization. Other native overlay/host/P2P scripts remain separate from hosted CI.

The previous real HTTPS upgrade from 0.1.0 to 0.1.1 was verified locally. The new Gitflow pipeline and beta-to-stable upgrade need a real candidate release to verify end to end; unit/workflow checks alone do not establish that. Clean Windows VM/WebView2 bootstrap, SmartScreen, different-network peers and self-hosted TURN remain separate manual acceptance.
