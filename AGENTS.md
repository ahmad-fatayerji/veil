# Veil repository rules

- `ahmad-fatayerji/veil` is the canonical repository for source, issues, PRs, installers and update metadata. Verify that `origin` points to `https://github.com/ahmad-fatayerji/veil.git` (or its SSH equivalent) before fetching, creating task worktrees or pushing.

- Follow PROJECT_SPEC.md and keep each task focused on the user's requested scope. The former numbered milestone roadmap is retired; do not use it to promise features or infer release authorization.
- Keep Windows-first native code isolated from shared React packages.
- Participant capacity defaults to no application-level cap.
- Never expose a public unauthenticated service; the standalone development host listens on loopback only.
- Do not claim universal capture exclusion.
- Keep builds and tests passing. Document unverified native behavior honestly.

## Server impact and compatibility maintenance

- Every task must assess whether it changes the server contract: requests/responses,
  admission, authentication, signaling, invitation formats, peer negotiation, relay
  behavior or advertised capabilities. Record the assessment in the PR body.
- When required, inspect current `ahmad-fatayerji/veil-server` source and its
  `AGENTS.md`, implement a coordinated server PR into `develop`, and cross-link both
  PRs. Required server work is part of task completion, not an unspecified follow-up.
  Keep server work isolated and verify its canonical origin before fetching/pushing.
- Review `packages/protocol/src/compatibility.ts` and server
  `src/compatibility.rs` for every relevant change. Advertise only implemented
  generations; add a generation for incompatible wire changes, retain older ones
  only while their implementations work, and explicitly remove unsupported ones.
  App/server package versions are descriptive, not proof of wire compatibility.
  Pure UI changes do not require protocol-generation or application-version bumps.
- Update protocol documentation, compatibility regression cases, and the exact
  server source pinned in app integration CI when required. Preserve legacy behavior
  intentionally; do not advertise compatibility merely because version numbers match.
- Release preparation must review supported generations and server-before-client
  upgrade order. A coordinated PR never authorizes deployment or publication.

## Safe worktree cleanup

Inspect task worktrees at startup and after completion. Automatically remove a stale
worktree only when its task PR is merged, all work is published, its HEAD has no
subsequent unpublished commits, and no active task owns it. Verify PR state/head,
branch tracking, locks, tracked/untracked changes and valuable ignored files first.
Recognized disposable build artifacts may be removed only after that verification;
never discard credentials, documents or unknown ignored files.

Resolve the absolute target and verify it is a direct sibling of `Veil` inside
`D:\Codebase\veil project\Veil-app`. Run
`git worktree remove <verified-path>` from outside the target, without `--force`,
then `git worktree prune` for obsolete registrations. Do not delete protected or
remote branches as part of cleanup. Never remove the original checkout, stash/reset
work to clear it, or recursively delete an unchecked path.

Preserve dirty, locked, active, open-PR, closed-unmerged and uncertain worktrees.
An open task PR keeps its worktree for follow-up; merged status alone is insufficient
if subsequent work or valuable local files exist. Report skipped uncertain candidates.

## Required task workflow

These rules apply to every agent working in this repository. `develop` is the default branch for new checkouts and ordinary PRs; `main` holds approved release source. Use the existing Gitflow automation; a completed feature does not automatically authorize a release.

1. Read this file and `PROJECT_SPEC.md`. Inspect `git status --short`, the current branch, and any existing task PR before editing. Preserve other contributors' changes, including uncommitted work. Inspect `git worktree list` to identify existing task worktrees. Continue an existing task branch only in its dedicated worktree when resuming the same task.
2. For a new ordinary task (including fixes, documentation and CI), fetch origin and create `feature/<short-task-name>` from current `origin/develop`. Do not implement tasks directly on `main`, `develop`, or an unrelated agent's branch. Every AI task must use its own separate Git worktree, even when the original checkout is clean and no other task is active. This applies to fixes, documentation, CI, release stabilization and hotfixes; use the starting branch specified below for each route. Create the task branch and worktree together with `git worktree add -b <task-branch> <task-worktree-path> <starting-ref>` before editing, and run all edits, builds, tests, commits and pushes from that worktree. Keep task worktrees outside the original checkout, as direct siblings of `Veil` inside the `Veil-app` folder. On this machine the required worktree parent is `D:\Codebase\veil project\Veil-app`; use a task folder such as `Veil-reconnect` under it. Resolve and verify the destination parent before creating a worktree; do not place task worktrees directly under `CodeBase` or elsewhere. This location rule applies to every agent and task route. Never reuse a worktree belonging to a different task or implement changes in the original checkout. Do not stash, reset, or move other work to clear a checkout.
3. Keep the branch focused on the requested task. Stage only its files. Use Conventional Commit messages and PR titles: `feat:`, `fix:`, `docs:`, `ci:`, `test:`, `build:`, `refactor:`, `perf:`, `style:`, `chore:` or `revert:`, optionally with a scope. Use `!` in the title for breaking changes, for example `feat(protocol)!: change handshake format`. The squash PR title determines the release proposal.
4. For ordinary bug and feature tasks, the user performs testing. Do not run local test suites or `pnpm check` unless the user explicitly requests validation. Documentation-only changes need lightweight formatting validation. When validation is requested, use checks appropriate to the change and consult `docs/testing.md` for native acceptance; rebuild the debug executable after Cargo tests before running native scripts. State what was actually verified and what remains unverified; never claim skipped tests passed.
5. Push the task branch and open a PR into `develop`, with a Conventional Commit title, a concise behavior/change description and validation results. Use a draft if work remains. Do not open ordinary feature PRs into `main`. When a task has a GitHub issue, include `Closes #<issue-number>` in the PR body for each issue fully resolved by that PR; use `Refs #<issue-number>` for partial work so it does not promise closure. Use a qualified `owner/repository#<issue-number>` reference for another repository. Pass the issue number and URL to any delegated agent, and require that agent to include the reference in its PR. After creation or a PR body update, verify the issue reference in the published body and GitHub's linked issues (`gh pr view <number> --repo ahmad-fatayerji/veil --json body,closingIssuesReferences`); correct missing or incorrect references before handoff. Closing references resolve issues when GitHub's default-branch merge rules apply; do not close issues manually just because a PR was opened.
6. For ordinary task handoff, do not wait for CI to finish or repeatedly poll checks. Report the current PR status once, including pending or failed checks, and leave testing to the user. If the user explicitly requests CI fixes or authorizes merging, inspect the PR's **CI gate**, address failures and conversations, and wait for required checks before merging. Before merging any PR, fetch origin and verify that the PR branch includes the latest target branch (`origin/develop` for ordinary PRs; the actual target branch for release, hotfix and other PR routes). Use `git merge-base --is-ancestor origin/<target-branch> HEAD` from the task worktree to verify ancestry. If behind, merge the updated target into the task branch, resolve conflicts, push, and wait for required checks on the updated head. Do not bypass protections or force-push to make a check appear current.
7. When the task authorizes merging, fetch origin and recheck target-branch ancestry immediately before invoking **Merge Gitflow PR** on `main` with the PR number. If the target advanced, repeat the update and required checks in step 6 before invoking the workflow. It selects the correct merge method and dispatches follow-up automation. Otherwise hand off the PR and its status for review; do not treat task completion as permission to publish a release.

For a bot-created PR, GitHub may require execution approval for its ordinary PR run even if explicitly dispatched validation passed. If merging is authorized, inspect the exact current PR head and workflow changes, approve that specific pending run using the authenticated maintainer account, and wait for its **CI gate**. See `docs/releasing.md` for the command. Never approve unrelated runs or disable protections to unblock a merge; report missing maintainer access if it prevents approval.

Ordinary task commands (start in the original `Veil` checkout inside `Veil-app`; replace the example name, title and file paths):

```powershell
# From Veil-app/Veil, ../Veil-reconnect resolves inside Veil-app.
git fetch origin
git worktree add -b feature/reconnect ../Veil-reconnect origin/develop
Set-Location ../Veil-reconnect
# Implement and validate the task.
git add path/to/changed-file
git commit -m "fix: reconnect after losing connection"
git push -u origin feature/reconnect
gh pr create --repo ahmad-fatayerji/veil --base develop --title "fix: reconnect after losing connection" --body-file pr-body.md
# Only when merging is authorized and the required checks pass:
gh workflow run merge-pr.yml --repo ahmad-fatayerji/veil --ref main -f number=123
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
- Repository consolidation is complete. Public `ahmad-fatayerji/veil` contains audited MIT source and distribution assets. Never publish unaudited private material or signing credentials, reuse a published version, or replace published assets. Do not request or print token/key values; use the existing Actions secrets.
- `automation/update-feed-*` PRs into `main` change only `updates/beta.json`, require verified published assets and the CI gate, and merge with a merge commit. They never publish installers. The one-time `migration/source-import` route joins approved source and distribution history without publication.
- Read `docs/releasing.md` before changing CI, release tooling, updater behavior or branch policy. In the handoff, include the branch/PR, validation results, and any remaining work; explicitly state if an authorized action published a release.
