import { describe, expect, it } from 'vitest';
import type { AdapterError, AdapterResult } from '@fmip/ingestion';
import { lineupAnswer } from './ingestion-jobs.service';

const failed = (error: AdapterError): AdapterResult<unknown> => ({ ok: false, error, requests: 1 });

/** T-1376: a line-up not announced yet is the provider's answer, not a refusal. */
describe('what a line-up ask came back with', () => {
  it('is a line-up when the provider sent one', () => {
    expect(
      lineupAnswer({ ok: true, data: {}, requests: 1, fetchedAt: '2026-10-10T12:00:00Z' }),
    ).toBe('lineup');
  });

  it('is waiting when the provider answered with no line-up yet', () => {
    expect(
      lineupAnswer(
        failed({ kind: 'unsupported', message: 'no lineup for fixture 1', unpublished: true }),
      ),
    ).toBe('waiting');
  });

  it('is refused when the provider would not answer at all', () => {
    // A plan that cannot ask, or a 403: unsupported, but not an answer.
    expect(lineupAnswer(failed({ kind: 'unsupported', message: 'plan: no access' }))).toBe(
      'refused',
    );
    expect(lineupAnswer(failed({ kind: 'http', message: '500', status: 500 }))).toBe('refused');
    expect(lineupAnswer(failed({ kind: 'transport', message: 'timeout' }))).toBe('refused');
    expect(lineupAnswer(failed({ kind: 'quota', message: 'requests' }))).toBe('refused');
    expect(lineupAnswer(failed({ kind: 'malformed', message: 'not an envelope' }))).toBe('refused');
  });
});
