import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  assertPublishedIdentity,
  assertReleaseManifest,
  assertUploadedAssets,
} from './release-assets.mjs';

test('upload failure and incomplete drafts cannot pass publication verification', () => {
  const local = () => Buffer.from('installer');
  assert.throws(
    () =>
      assertUploadedAssets(['setup.exe', 'latest.json'], [{ name: 'setup.exe', size: 9 }], local),
    /Upload verification/,
  );
  assert.throws(
    () =>
      assertUploadedAssets(['setup.exe'], [{ name: 'setup.exe', size: 9 }], local, () =>
        Buffer.from('tampered!'),
      ),
    /Uploaded bytes differ/,
  );
  assertUploadedAssets(['setup.exe'], [{ name: 'setup.exe', size: 9 }], local, local);
});
test('published retry must reuse the same source, and another commit cannot reuse its version', () => {
  const metadata = { version: '0.2.0', sourceSha: 'a'.repeat(40) };
  assertPublishedIdentity(metadata, '0.2.0', 'a'.repeat(40));
  assert.throws(() => assertPublishedIdentity(metadata, '0.2.0', 'b'.repeat(40)));
  assert.throws(() => assertPublishedIdentity(metadata, '0.3.0', 'a'.repeat(40)));
});
test('release manifest binds the URL, package checksum, version, signature and source SHA', () => {
  const installer = Buffer.from('installer');
  const metadata = {
    version: '0.2.0',
    sourceSha: 'a'.repeat(40),
    installer: 'Veil_0.2.0_x64-setup.exe',
    sha256: createHash('sha256').update(installer).digest('hex'),
  };
  const manifest = {
    version: '0.2.0',
    platforms: {
      'windows-x86_64': {
        signature: 'signed',
        url: 'https://github.com/ahmad-fatayerji/veil/releases/download/v0.2.0/Veil_0.2.0_x64-setup.exe',
      },
    },
  };
  const check = (value) =>
    assertReleaseManifest(
      value,
      metadata,
      '0.2.0',
      'a'.repeat(40),
      metadata.installer,
      installer,
      'signed\n',
    );
  check(manifest);
  assert.throws(() => check({ ...manifest, version: '0.3.0' }));
  assert.throws(() =>
    check({
      ...manifest,
      platforms: { 'windows-x86_64': { signature: 'signed', url: 'http://other/setup.exe' } },
    }),
  );
});
