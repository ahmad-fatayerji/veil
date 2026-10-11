import { createHash } from 'node:crypto';

export function assertPublishedIdentity(metadata, version, sha) {
  if (!metadata || metadata.sourceSha !== sha || metadata.version !== version)
    throw new Error('Published version belongs to another source commit.');
}
export function assertUploadedAssets(expected, assets, localBytes, uploadedBytes) {
  for (const name of expected) {
    const bytes = localBytes(name);
    const asset = assets.find((item) => item.name === name);
    if (!asset || asset.size !== bytes.length)
      throw new Error(`Upload verification failed: ${name}`);
    if (uploadedBytes && !uploadedBytes(name).equals(bytes))
      throw new Error(`Uploaded bytes differ: ${name}`);
  }
}
export function assertReleaseManifest(
  manifest,
  metadata,
  version,
  sha,
  installerName,
  installer,
  signature,
) {
  assertPublishedIdentity(metadata, version, sha);
  const platform = manifest.platforms?.['windows-x86_64'];
  if (
    manifest.version !== version ||
    platform?.signature !== signature.trim() ||
    metadata.installer !== installerName ||
    metadata.sha256 !== createHash('sha256').update(installer).digest('hex')
  )
    throw new Error('Asset provenance mismatch.');
  const expectedUrl = `https://github.com/ahmad-fatayerji/veil/releases/download/v${version}/${encodeURIComponent(installerName)}`;
  if (platform.url !== expectedUrl) throw new Error('Installer URL does not match this release.');
}
