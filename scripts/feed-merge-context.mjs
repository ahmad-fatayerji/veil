export function matchingFeedRun(run, repository, branch, sha) {
  return (
    run.path === '.github/workflows/ci.yml' &&
    run.head_sha === sha &&
    run.head_branch === branch &&
    run.conclusion === 'success' &&
    run.head_repository?.full_name === repository
  );
}
