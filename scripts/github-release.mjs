// GitHub's release-by-tag route finds published releases. A new draft may
// only be discoverable through the authenticated, paginated release list.
export function findReleaseByTag(tag, getByTag, listPages) {
  const published = getByTag(tag);
  if (published) {
    if (published.tag_name !== tag) throw new Error('Release lookup returned another tag.');
    return published;
  }
  const matches = listPages()
    .flat()
    .filter((release) => release.tag_name === tag);
  if (matches.length > 1) throw new Error('Multiple releases use this tag; resolve explicitly.');
  return matches[0] ?? null;
}
