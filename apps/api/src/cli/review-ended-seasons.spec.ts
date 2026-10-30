import { describe, expect, it } from 'vitest';
import { MAX_REASON, describeClass, parseReviewEndedArgs } from './review-ended-seasons';

/**
 * T-1662: ended seasons' findings are reviewed from the server's terminal
 * only with an administrator and a reason, every check or one, and a dry run
 * marks nothing.
 */
describe('the ended seasons review command', () => {
  it('reads the administrator and the reason, every check by default', () => {
    expect(
      parseReviewEndedArgs(['--by', ' Admin@Example.org ', '--reason', ' past seasons ']),
    ).toEqual({ by: 'admin@example.org', reason: 'past seasons', check: null, dryRun: false });
  });

  it('narrows to one check, and a dry run may stand anywhere', () => {
    expect(
      parseReviewEndedArgs([
        '--dry-run',
        '--by',
        'a@b.c',
        '--check',
        'lineup_not_eleven',
        '--reason',
        'why',
      ]),
    ).toEqual({ by: 'a@b.c', reason: 'why', check: 'lineup_not_eleven', dryRun: true });
  });

  it('refuses a check it does not know and a reason too long to record', () => {
    expect(
      parseReviewEndedArgs(['--by', 'a@b.c', '--reason', 'why', '--check', 'everything']),
    ).toMatchObject({ error: expect.stringContaining('goals_disagree') });
    expect(
      parseReviewEndedArgs(['--by', 'a@b.c', '--reason', 'x'.repeat(MAX_REASON + 1)]),
    ).toMatchObject({ error: expect.stringContaining(String(MAX_REASON)) });
  });

  it('refuses to run without the administrator or the reason, or with anything else', () => {
    expect(parseReviewEndedArgs(['--reason', 'why'])).toMatchObject({
      error: expect.stringContaining('--by'),
    });
    expect(parseReviewEndedArgs(['--by', 'a@b.c'])).toMatchObject({
      error: expect.stringContaining('--reason'),
    });
    expect(parseReviewEndedArgs(['--by', '--reason', 'why'])).toEqual({
      error: '--by needs a value.',
    });
    expect(parseReviewEndedArgs(['--by', 'a@b.c', '--reason', 'why', '--all'])).toEqual({
      error: 'Unknown argument: --all',
    });
  });

  it('names a batch by competition, season, check and count', () => {
    expect(
      describeClass({
        check: 'goals_disagree',
        seasonId: 's',
        seasonLabel: '2021/22',
        competitionName: 'Premier League',
        open: 12,
      }),
    ).toBe('Premier League 2021/22: goals_disagree, 12 open');
  });
});
