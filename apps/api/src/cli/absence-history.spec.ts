import { describe, expect, it } from 'vitest';
import { MAX_REASON, parseAbsenceHistoryArgs } from './absence-history';

/**
 * T-1650: the absence history from the server's terminal names an
 * administrator and a reason before anything runs, as the backfill does, and
 * may be narrowed to one season or one competition.
 */
describe('the absence history command', () => {
  it('reads the administrator and the reason, every past season by default', () => {
    expect(
      parseAbsenceHistoryArgs(['--by', ' Admin@Example.org ', '--reason', ' model factors ']),
    ).toEqual({
      by: 'admin@example.org',
      reason: 'model factors',
      seasonLabel: null,
      competitionExternalId: null,
    });
  });

  it('narrows to a season by its label and a competition by the provider id', () => {
    expect(
      parseAbsenceHistoryArgs([
        '--season',
        '2023/24',
        '--by',
        'a@b.c',
        '--competition',
        '39',
        '--reason',
        'why',
      ]),
    ).toEqual({ by: 'a@b.c', reason: 'why', seasonLabel: '2023/24', competitionExternalId: '39' });
    // A calendar season is a year alone.
    expect(
      parseAbsenceHistoryArgs(['--by', 'a@b.c', '--reason', 'why', '--season', '2024']),
    ).toMatchObject({ seasonLabel: '2024' });
  });

  it('refuses a season or a competition it cannot read', () => {
    expect(
      parseAbsenceHistoryArgs(['--by', 'a@b.c', '--reason', 'why', '--season', '23/24']),
    ).toMatchObject({ error: expect.stringContaining('2023/24') });
    expect(
      parseAbsenceHistoryArgs(['--by', 'a@b.c', '--reason', 'why', '--competition', 'Premier']),
    ).toMatchObject({ error: expect.stringContaining('provider') });
    expect(parseAbsenceHistoryArgs(['--by', 'a@b.c', '--reason', 'why', '--season'])).toEqual({
      error: '--season needs a value.',
    });
  });

  it('refuses to run without the administrator or the reason, or with anything else', () => {
    expect(parseAbsenceHistoryArgs(['--reason', 'why'])).toMatchObject({
      error: expect.stringContaining('--by'),
    });
    expect(parseAbsenceHistoryArgs(['--by', 'a@b.c'])).toMatchObject({
      error: expect.stringContaining('--reason'),
    });
    expect(parseAbsenceHistoryArgs(['--by', '--reason', 'why'])).toEqual({
      error: '--by needs a value.',
    });
    expect(parseAbsenceHistoryArgs(['--by', 'a@b.c', '--reason', 'why', '--force', 'x'])).toEqual({
      error: 'Unknown argument: --force',
    });
  });

  it('keeps the reason to what the audit log holds from the page', () => {
    const parsed = parseAbsenceHistoryArgs([
      '--by',
      'a@b.c',
      '--reason',
      'x'.repeat(MAX_REASON + 9),
    ]);
    expect('reason' in parsed && parsed.reason.length).toBe(MAX_REASON);
  });
});
