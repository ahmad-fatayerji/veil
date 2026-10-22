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

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The release list is eventually consistent: a draft created moments ago can be
// missing from it. Tag-based gh commands resolve drafts through that list, so wait
// until the lookup returns the exact release we created before using them.
export function awaitRelease(find, id, { attempts = 8, delay = 1000, sleep = pause } = {}) {
  for (let attempt = 1; ; attempt++) {
    const release = find();
    if (release && release.id !== id)
      throw new Error('Release lookup returned a different release for this tag.');
    if (release) return release;
    if (attempt >= attempts)
      throw new Error('The new release draft did not become discoverable; retry publication.');
    sleep(delay * 2 ** (attempt - 1));
  }
}
