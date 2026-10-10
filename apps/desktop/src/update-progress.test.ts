import { describe, expect, it } from 'vitest';
import { progressLabel, type UpdateProgress } from './update-progress';

const progress: UpdateProgress = {
  stage: 'downloading',
  downloaded: 5 * 1024 * 1024,
  total: 10 * 1024 * 1024,
  attempt: 1,
  retryAt: null,
};
describe('update feedback', () => {
  it('shows measured progress and handles unknown or zero totals', () => {
    expect(progressLabel(progress, 100)).toContain('5.0 MB of 10.0 MB — 50%');
    expect(progressLabel({ ...progress, total: null }, 100)).toContain('5.0 MB downloaded');
    expect(progressLabel({ ...progress, total: 0 }, 100)).not.toContain('NaN');
  });
  it('explains retries and separates verification from installation', () => {
    expect(progressLabel({ ...progress, stage: 'retrying', retryAt: 102 }, 100)).toContain(
      'in 2 seconds (attempt 2 of 3)',
    );
    expect(progressLabel({ ...progress, stage: 'verifying' }, 100)).toContain(
      'signature and version',
    );
    expect(progressLabel({ ...progress, stage: 'launching' }, 100)).toContain('Windows installer');
  });
});
