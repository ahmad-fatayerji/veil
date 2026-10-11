import test from 'node:test';
import assert from 'node:assert/strict';
import { findReleaseByTag } from './github-release.mjs';

test('published release lookup avoids the draft list and preserves identity', () => {
  const published = { id: 12, tag_name: 'v0.2.0', draft: false };
  assert.equal(
    findReleaseByTag(
      'v0.2.0',
      () => published,
      () => assert.fail('Do not list existing releases'),
    ),
    published,
  );
});

test('a draft missing from the tag endpoint is found on a later release-list page', () => {
  const draft = { id: 13, tag_name: 'v0.2.0', draft: true, assets: [] };
  assert.equal(
    findReleaseByTag(
      'v0.2.0',
      () => null,
      () => [[{ tag_name: 'v0.1.2' }], [draft]],
    ),
    draft,
  );
  assert.equal(
    findReleaseByTag(
      'v0.3.0',
      () => null,
      () => [[draft]],
    ),
    null,
  );
});

test('ambiguous or mismatched release lookup cannot select assets for replacement', () => {
  assert.throws(
    () =>
      findReleaseByTag(
        'v0.2.0',
        () => ({ tag_name: 'v0.1.2' }),
        () => [],
      ),
    /another tag/,
  );
  assert.throws(
    () =>
      findReleaseByTag(
        'v0.2.0',
        () => null,
        () => [[{ tag_name: 'v0.2.0' }, { tag_name: 'v0.2.0' }]],
      ),
    /Multiple releases/,
  );
});

test('authentication and service errors remain fatal rather than creating another release', () => {
  assert.throws(
    () =>
      findReleaseByTag(
        'v0.2.0',
        () => {
          throw new Error('HTTP 403');
        },
        () => [],
      ),
    /HTTP 403/,
  );
  assert.throws(
    () =>
      findReleaseByTag(
        'v0.2.0',
        () => null,
        () => {
          throw new Error('HTTP 500');
        },
      ),
    /HTTP 500/,
  );
});
