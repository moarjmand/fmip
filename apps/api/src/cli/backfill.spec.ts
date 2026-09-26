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
    ).toEqual({ by: 'admin@example.org', reason: 'six new leagues' });
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

  it('keeps the reason to what the audit log holds from the page', () => {
    const long = 'x'.repeat(MAX_REASON + 50);
    const parsed = parseBackfillArgs(['--by', 'a@b.c', '--reason', long]);
    expect('reason' in parsed && parsed.reason.length).toBe(MAX_REASON);
  });
});
