# Repository consolidation

The authorized destination is public `ahmad-fatayerji/veil`, under MIT. Keep historical releases, asset URLs, distribution tags, updater endpoints, `dev.veil.desktop`, per-user NSIS installation, and the embedded updater public key unchanged. No version changes or publication occur during import.

## Audit and backup

Before public pushes, fetch source branches/tags and record the exact imported refs. Run a checksum-verified Gitleaks binary over all reachable history and commit/tag metadata with full redaction. Inspect historical filenames for private files and classify every finding. Scanner results alone do not prove that no private material exists. Keep backups and detailed scan reports outside all checkouts, privately.

The initial scan used Gitleaks 8.30.1 and found three generic-key matches: `packages/protocol/src/signaling.test.ts` in `0294180`, and two keys in `packages/protocol/fixtures/signaling-v2.json` in `22ff32d`. These are deterministic test vectors. The fixture root is repeated hexadecimal `c`; all three fixture keys reproduce using the documented HKDF inputs and domains. They are not operator credentials or signing keys. Do not add broad secret-scan exclusions.

Record both repositories' heads, annotated tag objects and peeled commits, releases, downloaded asset SHA-256 checksums, Actions settings/rulesets, and exact feed bytes. Store a source Git bundle privately and a distribution backup before cutover. Re-scan the final migration and develop refs immediately before public push. Resolve any real secret or private-material finding before importing history; do not publish a redacted report containing sensitive values.

The initial private snapshot covers 92 reachable source commits, both Git bundles, all eight public releases with downloaded asset SHA-256 checksums, and exact beta-feed bytes. The commit/tag metadata scan reported no secrets. Source `develop` was `0ad5022b55b8f968c6fe0c44706e921142821758`; approved source `main` was `7d74ec6259c68c86ad78039c5dae55d200444461`. Revalidate heads and run status at cutover.

## Import procedure

1. Finish the private `feature/repository-consolidation` PR into `develop` with its CI gate. Pause merges and release operations during cutover, and ensure no publication run remains active.
2. In a dedicated migration worktree, start from approved source `main` (`7d74ec6259c68c86ad78039c5dae55d200444461`). Apply only reviewed migration tooling/documentation/license changes, preserving the approved application tree. Use the updated tooling CI/tests consistently without importing unreleased application features.
3. Fetch public distribution history without importing its tags over legacy source tags. Merge public `main` with `--allow-unrelated-histories`, preserving its `updates/beta.json` bytes. Resolve README overlap in favor of the source README with existing download links retained.
4. Add `.release/migration.json` recording `sourceMain` and the exact `publicBase`. Set the baseline to version `0.3.0`, source ref `refs/tags/legacy-source/v0.3.0`. Push audited source tags explicitly as `legacy-source/v*`; never mirror-push or force-push tags.
5. Push `migration/source-import` and open its one-time PR into public `main`. Require exact-head successful CI, up-to-date base and resolved conversations, then merge with a merge commit. The pinned migration policy rejects application changes and feed changes; migration cannot publish an installer.
6. In a separate task worktree, import audited source `develop` and merge the migrated public `main`, preserving unreleased application changes and the migrated baseline. Create public `develop`; configure its default-branch status and the existing no-bypass Gitflow protections on both branches.
7. Configure existing signing secrets securely without logging values. Keep `RELEASE_PUBLICATION_ENABLED` unset/false until private publication workflows are disabled and public validation is green. Disable the private stable/beta/prepare/finalize/publish workflows before enabling the public publisher; do not disable ordinary CI.

## Acceptance and retirement

Run `pnpm check`, relevant tests, `pnpm test:release`, and an unsigned Windows production build. Compare the application tree and all old assets/feeds to the private snapshot. Preserve the signing identity; no key generation or rotation is part of migration.

After migration, Prepare release proposes a new version. Publish beta, test a real installed stable-to-beta upgrade, finalize and review the stable release, and test beta-to-stable and stable-to-stable upgrades. Verify preference retention, active-document update refusal and tamper rejection. Run installer acceptance in a clean Windows test account/VM; the existing script intentionally refuses to replace an unrelated user installation. Record native and clean-VM results separately and never infer successful native behavior from hosted CI.

Migration and installed upgrade acceptance are complete; all development and publication use `ahmad-fatayerji/veil`. Failed validation stops publication; existing assets are never overwritten, and feeds never move backwards. After a public release, recovery means completing/retrying that immutable release or preparing a newer repair release, not rolling feeds back or re-enabling two publishers.

For the existing per-user test installation, run `node scripts/test-release-upgrade.mjs beta <beta-version>` and then `node scripts/test-release-upgrade.mjs stable <stable-version>`. This uses the real public feed and signed installer, refuses to start while any Veil process is active, backs up preferences privately, checks the active-document gate and preference retention, and restores the prior update channel. It upgrades the existing installation; it does not uninstall it or replace a clean-VM acceptance run.

## Completed cutover (2026-10-11)

Legacy preparation PR [Veil-source #27](https://github.com/ahmad-fatayerji/Veil-source/pull/27) passed its CI gate and merged. Public import PR [veil #1](https://github.com/ahmad-fatayerji/veil/pull/1) passed its CI gate and merged at `63984f216e01d1f14fa2ab0cb440c3a6116893bf`. The application tree in that import matches approved source `7d74ec6259c68c86ad78039c5dae55d200444461`; unreleased application features were excluded.

Public `develop` was created at `db9d42669750d0b1a5d2df6ba410a3d55d2a9a41`, preserving the audited source development application tree and incorporating the reviewed public migration history. It is the default branch. Both protected branches require the CI gate, up-to-date PRs and resolved conversations, with no bypass actors. [Full public development validation](https://github.com/ahmad-fatayerji/veil/actions/runs/38114489243) passed before publication was enabled.

The final history scan included merge resolutions (`--all --full-history -m`); every reported key was an independently reproduced deterministic protocol fixture. Commit/tag metadata scans were clean. All eight original release records and canonical tag objects were preserved; all 45 historical assets were re-downloaded from their original URLs after cutover and matched the private pre-migration SHA-256 inventory. The beta feed remained byte-for-byte unchanged during import. Conflicting source tags were retained as `legacy-source/v*`, with the release baseline pinned to `legacy-source/v0.3.0`.

The existing signing identity was copied securely to the unified publisher. Private publication workflows were disabled before public publication was enabled. Signing credentials remain limited to publication jobs, and unsigned PR/build validation receives none. Private Git bundles, asset copies, inventories, preferences and native evidence remain outside all checkouts.

At the user's request, installed upgrade acceptance uses this Windows machine; no Windows VM is used. Clean-install and direct stable-to-stable acceptance remain unverified. Hosted CI and an unsigned production build do not establish those results.

### Installed beta acceptance

[Beta publication](https://github.com/ahmad-fatayerji/veil/actions/runs/38114918915) produced `0.4.0-beta.1` from `e032f09a882bf6a61fde58c9fc0ab885f725f9cf`. An initial draft-discovery delay stopped upload safely; retrying the failed job reused the successful unsigned build. A further publication retry preserved all six published asset IDs, sizes, SHA-256 digests and download URLs. Feed PR [#4](https://github.com/ahmad-fatayerji/veil/pull/4) passed its gate and merged through Gitflow; it did not trigger app publication.

On this Windows machine, the registered per-user `0.3.0` installation upgraded through the unchanged public beta endpoint to signed `0.4.0-beta.1`, relaunched and confirmed successful completion. Opacity, font size, always-on-top, click-through and capture-exclusion preferences were retained. Installation was rejected while a document was active. Preferences and screenshot evidence were backed up privately. The publisher's packaged-installer verifier also passed valid-package verification and tamper rejection.

### Stable acceptance

Finalized release PR [#2](https://github.com/ahmad-fatayerji/veil/pull/2) passed its protected CI gate and merged at `86b842f3b72d8a389cbd71a70347ba75838fb580`. [Stable publication](https://github.com/ahmad-fatayerji/veil/actions/runs/38116982042) validated that exact source, compiled the final production executable, and published signed `0.4.0`. Its initial new-draft discovery also required a failed-job retry; the original build and reserved source/version were retained. Published package verification and tamper rejection passed.

The existing `0.4.0-beta.1` installation upgraded through the unchanged stable `releases/latest/download/latest.json` endpoint to `0.4.0`, relaunched and confirmed completion, retained the checked overlay preferences, and again refused installation during an active document. The test first refused to launch while the user had Veil running; it resumed only after the user confirmed quitting. No user document was interrupted. Original releases, tag objects and asset identities/checksums still matched the migration snapshot after stable publication.

A feed PR browser run timed out on the reconnect test's expected text prefix. The trace showed `offline-B` had been inserted before the seed despite the test's `Control+End` shortcut; both replicas converged to the same content. The same code passed the independent exact-head run and final release validation. The acceptance test now uses its existing focused DOM append helper for both offline edits, preserving the deletion, convergence, offline-content and late-join assertions while removing reliance on cross-window keyboard focus.

### Feed and development completion

Stable feed PR [#6](https://github.com/ahmad-fatayerji/veil/pull/6) passed on a failed-job retry after the keyboard-focus test failure. The [explicitly dispatched trusted merger](https://github.com/ahmad-fatayerji/veil/actions/runs/38117594892) waited while the PR gate was blocked, then merged it at `f2a4baba19ee784ac06bb1536b6f13a4d6286a54` once protected merge readiness was clean. Both unchanged updater endpoints now offer `0.4.0`. Neither feed merge caused an app publication.

Back-merge PR [#7](https://github.com/ahmad-fatayerji/veil/pull/7) passed its gate and merged with a merge commit at `1fe722465674881c13a889af02af77960338cf8f`, carrying the released source, baseline and feed-merge fix into public `develop`. No unreleased development work was merged into `main` to perform the back-merge. The remaining clean-install and direct stable-to-stable acceptance are explicitly unverified; no Windows VM was used.

The legacy source repository was archived on 2026-10-11 after the real installed beta and stable upgrade checks succeeded, public feed automation completed, and the release back-merge passed. A final all-refs source bundle was saved privately immediately before archiving. All ordinary development and release operations now use public `ahmad-fatayerji/veil`.
