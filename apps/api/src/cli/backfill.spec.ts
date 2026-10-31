import { describe, expect, it } from 'vitest';
import { MAX_REASON, parseBackfillArgs } from './backfill';

/**
 * T-502: the season backfill from the server's terminal names an administrator
 * and a reason, exactly as the admin page asks for them, before anything runs.
 */
describe('the backfill command', () => {
  it('reads the administrator and the reason', () => {
    expect(
      parseBackfillArgs(['--by', ' Admin@Example.org ', '--reason', ' six new leagues ']),
    ).toEqual({
      by: 'admin@example.org',
      reason: 'six new leagues',
      season: null,
      standings: false,
      competition: null,
    });
  });

  it('reads a past season by its label, and refuses anything that is not one', () => {
    expect(
      parseBackfillArgs(['--by', 'a@b.c', '--reason', 'history', '--season', '2025/26']),
    ).toEqual({
      by: 'a@b.c',
      reason: 'history',
      season: '2025/26',
      standings: false,
      competition: null,
    });
    expect(
      parseBackfillArgs(['--by', 'a@b.c', '--reason', 'history', '--season', '2025']),
    ).toMatchObject({ error: expect.stringContaining('2025/26') });
    expect(parseBackfillArgs(['--by', 'a@b.c', '--reason', 'why', '--season'])).toMatchObject({
      error: '--season needs a value.',
    });
  });

  it('refuses to run without either, or with anything else', () => {
    expect(parseBackfillArgs(['--reason', 'why'])).toMatchObject({
      error: expect.stringContaining('--by'),
    });
    expect(parseBackfillArgs(['--by', 'a@b.c'])).toMatchObject({
      error: expect.stringContaining('--reason'),
    });
    expect(parseBackfillArgs(['--by', '--reason', 'why'])).toMatchObject({
      error: '--by needs a value.',
    });
    expect(parseBackfillArgs(['--by', 'a@b.c', '--reason', 'why', '--force'])).toMatchObject({
      error: 'Unknown argument: --force',
    });
  });

  it('runs the standings of a past season, for one competition when named (T-1677)', () => {
    const id = '9458f030-491b-4d73-83c3-d301292de62e';
    const base = ['--by', 'a@b.c', '--reason', 'conferences', '--season', '2025/26'];
    expect(parseBackfillArgs([...base, '--standings', '--competition', id])).toEqual({
      by: 'a@b.c',
      reason: 'conferences',
      season: '2025/26',
      standings: true,
      competition: id,
    });
    expect(parseBackfillArgs([...base, '--standings'])).toMatchObject({
      standings: true,
      competition: null,
    });
    // The current seasons run every hour; a competition alone is not a job.
    expect(parseBackfillArgs(['--by', 'a@b.c', '--reason', 'x', '--standings'])).toMatchObject({
      error: expect.stringContaining('--season'),
    });
    expect(parseBackfillArgs([...base, '--competition', id])).toMatchObject({
      error: '--competition is for --standings only.',
    });
    expect(parseBackfillArgs([...base, '--standings', '--competition', 'MLS'])).toMatchObject({
      error: expect.stringContaining('competition id'),
    });
  });

  it('keeps the reason to what the audit log holds from the page', () => {
    const long = 'x'.repeat(MAX_REASON + 50);
    const parsed = parseBackfillArgs(['--by', 'a@b.c', '--reason', long]);
    expect('reason' in parsed && parsed.reason.length).toBe(MAX_REASON);
  });
});
