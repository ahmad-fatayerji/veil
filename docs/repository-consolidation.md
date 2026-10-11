# Repository consolidation

The authorized destination is public `ahmad-fatayerji/veil`, under MIT. Keep historical releases, asset URLs, distribution tags, updater endpoints, `dev.veil.desktop`, per-user NSIS installation, and the embedded updater public key unchanged. No version changes or publication occur during import.

## Audit and backup

Before public pushes, fetch source branches/tags and record the exact imported refs. Run a checksum-verified Gitleaks binary over all reachable history and commit/tag metadata with full redaction. Inspect historical filenames for private files and classify every finding. Scanner results alone do not prove that no private material exists. Keep backups and detailed scan reports outside all checkouts, privately.

The initial scan used Gitleaks 8.30.1 and found three generic-key matches: `packages/protocol/src/signaling.test.ts` in `0294180`, and two keys in `packages/protocol/fixtures/signaling-v2.json` in `22ff32d`. These are deterministic test vectors. The fixture root is repeated hexadecimal `c`; all three fixture keys reproduce using the documented HKDF inputs and domains. They are not operator credentials or signing keys. Do not add broad secret-scan exclusions.

Record both repositories' heads, annotated tag objects and peeled commits, releases, downloaded asset SHA-256 checksums, Actions settings/rulesets, and exact feed bytes. Store a private source Git bundle and a distribution backup before cutover. Re-scan the final migration and develop refs immediately before public push. Resolve any real secret or private-material finding before importing history; do not publish a redacted report containing sensitive values.

The initial private snapshot covers 92 reachable source commits, both Git bundles, all eight public releases with downloaded asset SHA-256 checksums, and exact beta-feed bytes. The commit/tag metadata scan reported no secrets. Source `develop` was `0ad5022b55b8f968c6fe0c44706e921142821758`; approved source `main` was `7d74ec6259c68c86ad78039c5dae55d200444461`. Revalidate heads and run status at cutover.

## Import procedure

1. Finish the private `feature/repository-consolidation` PR into `develop` with its CI gate. Pause merges and release operations during cutover, and ensure no publication run remains active.
2. In a dedicated migration worktree, start from approved source `main` (`7d74ec6259c68c86ad78039c5dae55d200444461`). Apply only reviewed migration tooling/documentation/license changes, preserving the approved application tree. Use the updated tooling CI/tests consistently without importing unreleased application features.
3. Fetch public distribution history without importing its tags over private source tags. Merge public `main` with `--allow-unrelated-histories`, preserving its `updates/beta.json` bytes. Resolve README overlap in favor of the source README with existing download links retained.
4. Add `.release/migration.json` recording `sourceMain` and the exact `publicBase`. Set the baseline to version `0.3.0`, source ref `refs/tags/legacy-source/v0.3.0`. Push audited source tags explicitly as `legacy-source/v*`; never mirror-push or force-push tags.
5. Push `migration/source-import` and open its one-time PR into public `main`. Require exact-head successful CI, up-to-date base and resolved conversations, then merge with a merge commit. The pinned migration policy rejects application changes and feed changes; migration cannot publish an installer.
6. In a separate task worktree, import audited source `develop` and merge the migrated public `main`, preserving unreleased application changes and the migrated baseline. Create public `develop`; configure its default-branch status and the existing no-bypass Gitflow protections on both branches.
7. Configure existing signing secrets securely without logging values. Keep `RELEASE_PUBLICATION_ENABLED` unset/false until private publication workflows are disabled and public validation is green. Disable the private stable/beta/prepare/finalize/publish workflows before enabling the public publisher; do not disable ordinary CI.

## Acceptance and retirement

Run `pnpm check`, relevant tests, `pnpm test:release`, and an unsigned Windows production build. Compare the application tree and all old assets/feeds to the private snapshot. Preserve the signing identity; no key generation or rotation is part of migration.

After migration, Prepare release proposes a new version. Publish beta, test a real installed stable-to-beta upgrade, finalize and review the stable release, and test beta-to-stable and stable-to-stable upgrades. Verify preference retention, active-document update refusal and tamper rejection. Run installer acceptance in a clean Windows test account/VM; the existing script intentionally refuses to replace an unrelated user installation. Record native and clean-VM results separately and never infer successful native behavior from hosted CI.

Keep `Veil-source` private and unarchived until actual upgrade acceptance succeeds. Failed validation stops publication; existing assets are never overwritten, and feeds never move backwards. After a public release, recovery means completing/retrying that immutable release or preparing a newer repair release, not rolling feeds back or re-enabling two publishers.
