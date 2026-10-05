import { describe, expect, it } from 'vitest';
import {
  GNEWS_DEFAULT_DAILY_BUDGET,
  GNEWS_DEFAULT_INTERVAL_MINUTES,
  gnewsConfig,
  redact,
} from './gnews-ingestion.service';

/** GNews from the environment (T-1367, D-185): off and harmless without a key. */
describe('gnewsConfig', () => {
  it('is off while the key is empty or absent, whatever else is set', () => {
    expect(gnewsConfig({})).toEqual({ on: false, reason: 'GNEWS_API_KEY is empty' });
    expect(gnewsConfig({ GNEWS_API_KEY: '  ', GNEWS_DAILY_BUDGET: '90' })).toMatchObject({
      on: false,
    });
  });

  it('is on with a key, at 90 a day every 30 minutes unless told otherwise', () => {
    expect(gnewsConfig({ GNEWS_API_KEY: 'k' })).toEqual({
      on: true,
      apiKey: 'k',
      dailyBudget: GNEWS_DEFAULT_DAILY_BUDGET,
      intervalMinutes: GNEWS_DEFAULT_INTERVAL_MINUTES,
    });
    expect(GNEWS_DEFAULT_DAILY_BUDGET).toBeLessThan(100);
    expect((24 * 60) / GNEWS_DEFAULT_INTERVAL_MINUTES).toBeLessThanOrEqual(
      GNEWS_DEFAULT_DAILY_BUDGET,
    );
    expect(
      gnewsConfig({ GNEWS_API_KEY: 'k', GNEWS_DAILY_BUDGET: '50', GNEWS_INTERVAL_MINUTES: '60' }),
    ).toMatchObject({ on: true, dailyBudget: 50, intervalMinutes: 60 });
  });

  it('refuses a limit that is not a positive whole number rather than guessing one', () => {
    for (const bad of ['0', '-1', '1.5', 'lots']) {
      expect(gnewsConfig({ GNEWS_API_KEY: 'k', GNEWS_DAILY_BUDGET: bad })).toMatchObject({
        on: false,
        reason: expect.stringContaining('GNEWS_DAILY_BUDGET'),
      });
      expect(gnewsConfig({ GNEWS_API_KEY: 'k', GNEWS_INTERVAL_MINUTES: bad })).toMatchObject({
        on: false,
        reason: expect.stringContaining('GNEWS_INTERVAL_MINUTES'),
      });
    }
  });
});

describe('redact', () => {
  it('removes every occurrence of the key', () => {
    expect(redact('GET https://gnews.io/x?apikey=s3cret failed (s3cret)', 's3cret')).toBe(
      'GET https://gnews.io/x?apikey=[key] failed ([key])',
    );
  });
});
