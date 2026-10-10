export interface UpdateProgress {
  stage: string;
  downloaded: number;
  total: number | null;
  attempt: number;
  retryAt: number | null;
}

export const bytesLabel = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function progressLabel(progress: UpdateProgress, now: number) {
  switch (progress.stage) {
    case 'checking':
      return 'Checking releases…';
    case 'downloading': {
      const size = progress.total
        ? `${bytesLabel(progress.downloaded)} of ${bytesLabel(progress.total)} — ${Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))}%`
        : `${bytesLabel(progress.downloaded)} downloaded`;
      return `Downloading update: ${size}${progress.attempt > 1 ? ` (attempt ${progress.attempt} of 3)` : ''}.`;
    }
    case 'retrying':
      return `Connection interrupted. Retrying the full download in ${Math.max(0, (progress.retryAt ?? now) - now)} seconds (attempt ${progress.attempt + 1} of 3).`;
    case 'verifying':
      return 'Verifying the update signature and version…';
    case 'saving':
      return 'Saving preferences and preparing installation…';
    case 'launching':
      return 'Starting the Windows installer. Follow its progress window; Veil will restart after installation.';
    default:
      return '';
  }
}
