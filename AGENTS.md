# Veil repository rules

- Follow PROJECT_SPEC.md and implement one milestone at a time. Current milestone: M6 (installer, updater, release), advanced at the user's request for P2P testing.
- Keep Windows-first native code isolated from shared React packages.
- Participant capacity defaults to no application-level cap.
- Never expose a public unauthenticated service; M0 listens on loopback only.
- Do not claim universal capture exclusion.
- Keep builds and tests passing. Document unverified native behavior honestly.

## Required task workflow

These rules apply to every agent working in this repository. `develop` is the default branch for new checkouts and ordinary PRs; `main` holds approved release source. Use the existing Gitflow automation; a completed feature does not automatically authorize a release.

1. Read this file and `PROJECT_SPEC.md`. Inspect `git status --short`, the current branch, and any existing task PR before editing. Preserve other contributors' changes, including uncommitted work. Continue an existing task branch when applicable.
2. For a new ordinary task (including fixes, documentation and CI), fetch origin and create `feature/<short-task-name>` from current `origin/develop`. Do not implement tasks directly on `main`, `develop`, or an unrelated agent's branch. If the checkout contains other work or is shared with another active task, use a separate Git worktree; do not stash, reset, or move that work to clear the checkout.
3. Keep the branch focused on the requested task. Stage only its files. Use Conventional Commit messages and PR titles: `feat:`, `fix:`, `docs:`, `ci:`, `test:`, `build:`, `refactor:`, `perf:`, `style:`, `chore:` or `revert:`, optionally with a scope. Use `!` in the title for breaking changes, for example `feat(protocol)!: change handshake format`. The squash PR title determines the release proposal.
4. Run checks appropriate to the change. For code changes, use `pnpm check` and relevant unit/integration tests; release tooling changes also require `pnpm test:release`. Documentation-only changes need formatting validation. Consult `docs/testing.md` for native acceptance; rebuild the debug executable after Cargo tests before running native scripts. State what was actually verified and what remains unverified.
5. Push the task branch and open a PR into `develop`, with a Conventional Commit title, a concise behavior/change description and validation results. Use a draft if work remains. Do not open ordinary feature PRs into `main`.
6. Check the PR's **CI gate**, fix failures, and resolve conversations. If the target branch advanced, merge the updated target into the task branch, push, and wait for fresh checks. Do not bypass protections or force-push to make a check appear current.
7. When the task authorizes merging, use **Merge Gitflow PR** on `main` with the PR number. It selects the correct merge method and dispatches follow-up automation. Otherwise hand off the PR and its status for review; do not treat task completion as permission to publish a release.

Ordinary task commands (replace the example name, title and file paths):

```powershell
git fetch origin
git switch -c feature/reconnect origin/develop
# Implement and validate the task.
git add path/to/changed-file
git commit -m "fix: reconnect after losing connection"
git push -u origin feature/reconnect
gh pr create --repo ahmad-fatayerji/Veil-source --base develop --title "fix: reconnect after losing connection" --body-file pr-body.md
# Only when merging is authorized and the required checks pass:
gh workflow run merge-pr.yml --repo ahmad-fatayerji/Veil-source --ref main -f number=123
```

Write the PR body to a temporary file outside the checkout; `pr-body.md` above stands for that file's path. Do not commit temporary PR text or credentials.

## Branch routes and release boundaries

| Task                            | Start from                             | Working branch                                 | PR target                                        | Merge method |
| ------------------------------- | -------------------------------------- | ---------------------------------------------- | ------------------------------------------------ | ------------ |
| Ordinary task                   | `origin/develop`                       | `feature/*`                                    | `develop`                                        | Squash       |
| Requested release stabilization | Named `release/*` or `hotfix/*` branch | `feature/*`                                    | That named candidate branch                      | Squash       |
| Explicit urgent stable hotfix   | `origin/main`                          | `hotfix/*`                                     | `main`, through release preparation/finalization | Merge commit |
| Reviewed release                | `develop`, through Prepare release     | `release/<version>`                            | `main`, after finalization                       | Merge commit |
| Bring released changes back     | `develop`, with `main` merged in       | `backmerge/<version>`, through Back-merge main | `develop`                                        | Merge commit |

- `main` and `develop` require PRs, an up-to-date branch, resolved conversations and a successful **CI gate**. There is no administrator bypass. Never push directly, force-push, delete protected branches, disable checks, or merge unreleased `develop` work into `main` merely to resolve a back-merge.
- Feature merges do not publish installers. Do not manually bump application versions, create release tags, edit updater feeds, or publish assets during ordinary tasks. The release coordinator owns synchronized versions and release metadata.
- Only perform release actions when requested. Follow [docs/releasing.md](docs/releasing.md): **Prepare release** proposes a draft; **Publish beta** explicitly requests a candidate; **Finalize release** removes the beta suffix and opens final review; merging the finalized release PR into `main` triggers stable publication. Draft candidates intentionally fail the stable merge policy until finalized.
- Use **Back-merge main** and merge its PR with a merge commit after a stable release. Resolve conflicts while preserving both the released fixes and unreleased development work.
- Source is private in `ahmad-fatayerji/Veil-source`. Public `ahmad-fatayerji/veil` contains distribution assets and update metadata only. Never copy private source or signing credentials there, reuse a published version, or replace published assets. Do not request or print token/key values; use the existing Actions secrets.
- Read `docs/releasing.md` before changing CI, release tooling, updater behavior or branch policy. In the handoff, include the branch/PR, validation results, and any remaining work; explicitly state if an authorized action published a release.
