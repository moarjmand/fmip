import { describe, expect, it } from 'vitest';
import { DETAIL_BACKLOG_BATCH, MAX_BACKLOG_BATCH, backlogBatch } from './ingestion-jobs.service';

/** T-501: the post-match backlog's pace is the deployment's to raise, within reason. */
describe('the backlog batch', () => {
  it('is twenty unless the deployment says otherwise', () => {
    expect(DETAIL_BACKLOG_BATCH).toBe(20);
    expect(backlogBatch(undefined)).toBe(20);
    expect(backlogBatch('')).toBe(20);
    expect(backlogBatch(' 60 ')).toBe(60);
  });

  it('ignores what is not a sensible number rather than guessing at one', () => {
    for (const raw of ['0', '-5', '7.5', 'many', String(MAX_BACKLOG_BATCH + 1)]) {
      expect(backlogBatch(raw)).toBe(DETAIL_BACKLOG_BATCH);
    }
    expect(backlogBatch(String(MAX_BACKLOG_BATCH))).toBe(MAX_BACKLOG_BATCH);
  });
});
