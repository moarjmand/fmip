import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THRESHOLDS_V1, parseRequest, sameValues, valuesOf } from './internal/thresholds';

/** Rating thresholds as versioned rows (T-1160, D-152, D-164): the request and version 1's row. */
describe('version 1', () => {
  it('is the row the migration writes', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../../../packages/db/migrations/1765200000000_rating-threshold-version.sql',
      ),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const t = THRESHOLDS_V1;
    expect(sql).toContain(
      `(1, ${t.provisionalBelow}, ${t.establishedAt}, ${t.contributorMinRating}, ${t.contributorMinSettled}, ${t.conductWindowDays}, ${t.flagPeriodDays}, '1970-01-01T00:00:00Z', NULL,`,
    );
  });
});

describe('parseRequest', () => {
  const body = { ...valuesOf(THRESHOLDS_V1), contributor_min_rating: 72.5, reason: 'Review' };

  it('refuses a body without a reason for that alone', () => {
    const { reason: _, ...without } = body;
    expect(parseRequest(without)).toMatchObject({ ok: false, fields: { reason: 'Say why.' } });
    expect(parseRequest({ ...body, reason: '  ' })).toMatchObject({ ok: false });
  });

  it('takes six values, a reason and an optional start', () => {
    expect(parseRequest(body)).toEqual({
      ok: true,
      values: { ...valuesOf(THRESHOLDS_V1), contributor_min_rating: 72.5 },
      effectiveFrom: null,
      reason: 'Review',
    });
    expect(parseRequest({ ...body, effective_from: '2026-10-01T00:00Z' })).toMatchObject({
      ok: true,
      effectiveFrom: '2026-10-01T00:00Z',
    });
  });

  it('names every bad value at once', () => {
    const parsed = parseRequest({
      ...body,
      provisional_below: 30.5,
      contributor_min_rating: 70.25,
      contributor_min_settled: 0,
      flag_period_days: '30',
      effective_from: '2026-10-01 00:00',
    });
    expect(parsed.ok).toBe(false);
    expect(Object.keys(parsed.ok ? {} : parsed.fields).sort()).toEqual([
      'contributor_min_rating',
      'contributor_min_settled',
      'effective_from',
      'flag_period_days',
      'provisional_below',
    ]);
  });

  it('refuses an established count below the provisional one', () => {
    expect(parseRequest({ ...body, provisional_below: 40, established_at: 35 })).toMatchObject({
      ok: false,
      fields: { established_at: expect.stringContaining('provisional') },
    });
  });

  it('compares versions by their six values', () => {
    const v1 = valuesOf(THRESHOLDS_V1);
    expect(sameValues(v1, { ...v1 })).toBe(true);
    expect(sameValues(v1, { ...v1, flag_period_days: 31 })).toBe(false);
  });
});
