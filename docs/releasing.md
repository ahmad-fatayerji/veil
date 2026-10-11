# Gitflow and Windows releases (M6)

The authorized consolidation moves audited MIT source, installers, signed update packages, release notes and tester instructions into [ahmad-fatayerji/veil](https://github.com/ahmad-fatayerji/veil). GitHub distributes the app; it does not handle peer signaling. No purchased domain is needed.

## Everyday work and merges

`main` contains approved release source; `develop` integrates the next release and is the repository's default branch for new checkouts and PRs. Agents follow the task procedure in [AGENTS.md](../AGENTS.md). Both branches require PRs, a successful **CI gate**, resolved conversations and an up-to-date branch. Direct pushes, force pushes and deletion are blocked, with no administrator bypass. External approvals are zero while there is one contributor. Select `main` when manually running the Gitflow management Actions, even though the default branch is `develop`.

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

GitHub may hold the ordinary PR run for execution approval when a bot creates or updates a PR. Explicitly dispatched validation still runs, but it does not satisfy a pending check on GitHub's PR merge commit. Before merging, inspect the current PR head and workflow changes, then approve that specific PR run with the authenticated maintainer account and wait for its **CI gate**. Approval permits the checks to execute; it does not bypass the protected merge requirements.

```powershell
gh run list --repo ahmad-fatayerji/veil --branch release/0.2.0
# Use the current PR run marked action_required, after inspecting its source:
gh api --method POST repos/ahmad-fatayerji/veil/actions/runs/RUN_ID/approve
```

GitHub's native merge buttons can also be used: squash feature PRs and use **Create a merge commit** for release/hotfix/back-merge PRs. Rules restrict `main` to merge commits. `develop` allows squash and merge because GitHub cannot enforce different methods based on the source branch; the Merge Gitflow PR action selects correctly. Rebase merging is disabled. Automatic back-merges use `backmerge/<version>` branches based on `develop`, with `main` merged into them. This satisfies strict up-to-date checks without bringing unreleased features into `main`. If develop advances, update the back-merge branch before merging.

CI selects checks from the complete PR diff against its base. Documentation runs formatting and branch policy; application code adds JavaScript lint/types/unit tests and relevant browser integration on Linux. Collaboration/protocol changes also run direct/relay smoke tests with UDP and TCP. Native Rust changes add Windows formatting/Clippy/tests and a separate Tauri build; updater/verifier changes also select release-tool tests. Workflow, dependency, configuration and unknown paths conservatively select all checks. Each run explains its selection in the Actions summary.

The required **CI gate** accepts a skipped job only when the successful selector explicitly marked it unnecessary. Missing outputs/jobs, failures, cancellations and unexpected skips fail the gate. PR metadata edits can reuse a successful gate from the identical merge commit in this repository's CI workflow; branch/title policy still runs again. If prior validation cannot be confirmed, selected checks run normally. Changing the base never uses metadata reuse.

Full validation runs for PRs into `main`, protected branch pushes, explicit dispatches, release workflow calls and the nightly schedule (02:23 UTC on the default branch). It includes both transports and the extended six-peer handover, recovery, capacity and signaling outage suite. Draft release PRs still cannot satisfy stable merge policy until finalized; beta publication uses **Candidate validation**. Browser tests compile the embedded host separately before starting Playwright, avoiding compilation within its startup deadline. PR Rust caches restore but do not upload; protected branch/full runs maintain the shared caches. Superseded runs cancel and browser failure artifacts are retained. PR checks never receive signing secrets. Interactive overlay/P2P/update acceptance remains separate.

## Build performance and release gates

Beta and stable releases select one exact source SHA, then run candidate validation and unsigned production compilation concurrently. Publication requires both to succeed. The unsigned build receives no release/signing secrets and uploads only `veil-desktop.exe` and `native-build.json`, with source SHA, version, platform, SHA-256 checksum, run ID and attempt. Publication downloads that named artifact from its own workflow run, checks provenance against the checkout, performs release preflight, and runs `tauri bundle --bundles nsis` to package/sign the existing executable. No frontend or desktop compilation runs in publication. Earlier successful build attempts from the same run may be reused when failed publication jobs are retried; artifacts from another run, another SHA/version, or a future attempt are rejected.

Installer signature/version/tamper verification lives in the lightweight `veil-release-verifier` workspace crate. Publication runs `cargo test -p veil-release-verifier --test signature --locked --timings -- --ignored` with `VEIL_TEST_INSTALLER` pointing to the packaged installer. It uses an isolated `target/verifier` compiler directory, avoiding the desktop dependency tree. Feed advancement, draft upload verification, published-version protection and serialized publication remain mandatory.

Windows Rust caches use explicit purpose-specific namespaces: `windows-rust-checks-v1`, `windows-desktop-debug-v1`, `windows-desktop-release-v1` (shared by beta and stable), and `windows-release-verifier-v1`. Cache keys retain toolchain, Cargo manifests/lockfile and compiler-environment invalidation. Dependency caches exclude workspace executables and incremental artifacts; the executable handoff uses a same-run artifact instead. Cold runs after this cache migration still need to populate their new namespaces.

Windows CI sets `CARGO_PROFILE_DEV_DEBUG=1` and `CARGO_PROFILE_TEST_DEBUG=1`, retaining line diagnostics with smaller debug artifacts. Local development defaults and production optimization are unchanged. Tauri's existing build hook builds web and desktop assets once; Windows Rust checks and JavaScript validation still build the frontend where needed. The `pnpm ... exec -- tauri ... -- --locked --timings` form preserves Cargo arguments through pnpm's command-line parser.

Linux jobs pin `ubuntu-24.04` rather than following `ubuntu-latest` image migrations. JavaScript Actions use Node 24-compatible releases; the application toolchain remains Node 22 and pnpm 10 as declared in the repository. Node setup runs before pnpm installation, and pnpm's setup Action owns dependency caching. Workflow maintenance follows feature/stabilization PRs; management Actions running on `main` adopt those changes when the reviewed release merges.

Each Windows job uploads Cargo HTML timing reports and `build-diagnostics/environment.json`, including cache-hit status, source SHA, toolchain and runner details. An exact cache miss can still restore a compatible fallback cache. Use the GitHub step durations to compare cache restore/save overhead as well as compilation; timing artifacts are retained for seven days.

Baseline: [the last legacy release run](https://github.com/ahmad-fatayerji/veil/actions/runs/37902133850) took 29m 27s, including 11m 31s of optimized Rust compilation and 3m 24s saving a 1.11 GB compressed Rust cache. Its Rust cache restore reported no cache found. The new workflow's cold/warm hosted durations and end-to-end GitHub publication remain pending until actual runs; no new version is published solely for benchmarking.

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

The action allocates the first unused numbered beta, validates its exact source SHA, builds a signed installer, verifies its signature and tamper rejection, and publishes a GitHub prerelease. Uploads remain a draft until downloaded assets match their local bytes. Only then is a checked `automation/update-feed-*` PR proposed for `updates/beta.json`. Its CI explicitly dispatches the trusted `main` feed merger, which waits for exact-head completed CI and protected merge readiness. A held bot PR run still requires maintainer execution approval. The workflow-run trigger is a secondary path; token-triggered CI must not depend on it. Every candidate carries reviewed notes, source SHA, workflow run/attempt, package checksum and signed manifest. A beta never becomes stable latest.

Draft release PRs intentionally cannot pass the final stable branch-policy check while their version has a beta suffix. Beta publication uses a separately named candidate validation gate. After testing, finalize:

```powershell
gh workflow run finalize-release.yml --ref main -f branch=release/0.2.0
```

Finalization merges current `main` into the candidate when checked feed updates advanced it (conflicts stop without pushing), removes the beta suffix, refreshes notes and the next baseline, and marks the PR ready. Review the final version, notes and CI. Merge the release PR with a merge commit to approve stable publication. The exact merged source is validated again; signing follows successful checks. New release tags point to the exact merged source commit in the unified repository. Historical distribution tags remain unchanged; imported source tags use `legacy-source/v*`. `release-metadata.json` remains the source provenance record.

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

The release-by-tag API can return 404 for a newly created draft. Publication falls back to the authenticated paginated release list and uses the draft's numeric release ID to verify uploads. It checks that the release is still a draft before replacing draft assets or proceeding to publication; authentication failures and ambiguous tag matches remain fatal.

The migration baseline is source `0f008872ed112fbb339ae37dd5f950891affb154` at `0.1.2`. Public `v0.1.2` is reserved; this migration does not publish or replace it. Subsequent baselines refer to legacy source tags. The initial beta feed points to the current stable release until a beta is requested.

## Updater channels and signing

**App updates → Update channel** selects stable or beta, persisted locally in `update-channel.json`. Stable is the default and retains the existing `/releases/latest/download/latest.json` endpoint for installed clients. Beta uses the public repository's `updates/beta.json` through HTTPS. Switching clears any pending candidate and makes no network request. Checks occur only on **Check for updates**, never on startup.

Both channels require the embedded public key and a newer version. Switching from a newer beta to stable waits for a newer stable release; it does not downgrade. Update installation is explicit and blocked while a document or embedded host is active. The overlay cannot administer updates. Preferences are retained; documents are temporary and must be copied before ending a session. Channel settings do not enter the shared document.

Downloads show transferred bytes and a percentage when the response includes `Content-Length`; unknown sizes use an indeterminate progress bar. These are full installers, not delta patches. Size reporting needs no GitHub REST API request. Downloads have a 30-second connection timeout and a 120-second idle timeout, with no total duration limit while bytes keep arriving. Interrupted transfers and HTTP 5xx failures retry at most three times, restarting at byte zero after two and four seconds. Cancel remains available through download/retry/verification, ending before preferences are saved and the installer starts. Returned failures release the native session gate. Packages are limited to 512 MiB in memory and must pass minisign verification and exact signed-semver matching before installer handoff; failed verification clears the candidate and requires another check.

Download throttling uses `Retry-After` (seconds or HTTP date), and `x-ratelimit-reset` when the remaining budget is zero, to disable checks/install attempts until the deadline. A 429 without usable timing headers waits at least a minute. Cooldowns are local to the running app. Tauri still performs manifest checks with a 60-second request timeout. An HTTP 429 from a manifest check starts a conservative one-minute manual cooldown; the plugin does not expose those response headers, so this cannot use the server's precise retry deadline. Checks never retry automatically. No token, additional API request or background GitHub polling is added.

Before launching the passive Windows installer, Veil atomically saves `update-receipt.json` containing the previous and intended versions. On the next launch it compares the running version to the intended version: an exact match shows a success notice above the collapsed update panel; any other version shows an incomplete-update notice. Feedback remains until dismissed, including across restarts. An installer launch error removes the pending receipt and keeps the control panel available. This confirms the version that actually launched; it does not monitor an installer after Veil exits, provide automatic rollback, or recover documents. If installation fails without relaunching, the notice appears when Veil can next be opened.

The unified repository uses its scoped `GITHUB_TOKEN` for repository and release operations. The old cross-repository `RELEASES_TOKEN` is not used by the new publisher. Signing secrets remain:

- `TAURI_SIGNING_PRIVATE_KEY`: encrypted updater private key.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.

Source branch/PR operations use the built-in `GITHUB_TOKEN`; Actions must be allowed to create PRs. No token is embedded in the app. Back up `%USERPROFILE%/.veil/release-signing` privately. Never log, share or commit the private key/password. Keep the application identifier and embedded public key stable. Updater signatures are distinct from Windows Authenticode; unknown-publisher/SmartScreen warnings may still appear.

For local packaging, `pnpm package:windows` builds the per-user x64 NSIS installer and signature. `node scripts/release-manifest.mjs <installer>` prepares the release assets. WebView2 downloads only if missing. Testers need no development toolchain.

## Verification boundaries

Run `pnpm check`, `pnpm test`, `pnpm test:release` and `pnpm test:e2e`. After Cargo tests, rebuild with `pnpm --filter @veil/desktop tauri build --debug --no-bundle`, then run `pnpm test:updates` for real WebView2 channel persistence and authorization. Other native overlay/host/P2P scripts remain separate from hosted CI.

The previous real HTTPS upgrade from 0.1.0 to 0.1.1 was verified locally. The new Gitflow pipeline and beta-to-stable upgrade need a real candidate release to verify end to end; unit/workflow checks alone do not establish that. Clean Windows VM/WebView2 bootstrap, SmartScreen, different-network peers and self-hosted TURN remain separate manual acceptance.

## Consolidation and publication controls

See [repository consolidation](repository-consolidation.md) for the audit and cutover record. Publication is disabled unless the repository is `ahmad-fatayerji/veil` and its Actions variable `RELEASE_PUBLICATION_ENABLED` is `true`. Disable the private publisher before enabling this variable publicly. Migration does not change an application version or publish a package. Existing public tags and assets are immutable.

Beta-feed advancement creates an `automation/update-feed-<version>` PR into protected `main`, never a direct push. CI requires exactly one modified file, `updates/beta.json`, strict version advancement, the exact published manifest, installer SHA-256, signature-file equality, and matching canonical source tag. The publisher has already cryptographically verified the installer before publication. A successful exact-head CI gate triggers **Merge verified update feed**, which uses Gitflow merge without bypassing protection and never invokes stable publication. Failed checks leave the previous feed intact; rerunning publication resumes the same proposal. If `main` advances, merge it into the feed branch without force-pushing and rerun CI before merging.

The sole `migration/source-import` route into `main` preserves a merge commit, requires the pinned approved source ancestor, unchanged application source and beta feed, and a `legacy-source/v0.3.0` baseline. It cannot be used after the initial import because its baseline/source pin no longer matches future release state. Ordinary features continue to target `develop`; only `release/*` or `hotfix/*` merges can dispatch stable publication. Fork feature PRs run unsigned CI; management PRs must originate in the unified repository.
