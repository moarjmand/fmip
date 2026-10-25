import type { AccuracyPoint, PublicModelAccuracyResponse } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { accuracyUrl, addDays, composeWeeklyPost, previousWeekStart } from './weekly-post';

const ORIGIN = 'https://fmip.example';
const WEEK = '2026-10-12';

function point(periodStart: string, matches: number, accuracy = 0.55): AccuracyPoint {
  return {
    period: '2026-W42',
    period_start: periodStart,
    forecasts: matches + 3,
    matches,
    coverage: matches === 0 ? 'not_supplied' : matches < 30 ? 'limited' : 'available',
    log_loss: matches === 0 ? null : 0.98,
    brier: matches === 0 ? null : 0.58,
    rps: matches === 0 ? null : 0.1984,
    accuracy: matches === 0 ? null : accuracy,
    uniform_rps: matches === 0 ? null : 0.2261,
  };
}

function answer(
  points: AccuracyPoint[],
  competitions: { name: string; points: AccuracyPoint[] }[] = [],
): PublicModelAccuracyResponse {
  return {
    period: 'week',
    minimum_matches: 30,
    reference: { uniform_log_loss: 1.0986, uniform_brier: 0.6667, uniform_accuracy: 1 / 3 },
    overall: {
      competition: null,
      model_versions: ['dixon-coles@1.2.0'],
      total: point(WEEK, 400),
      points,
    },
    competitions: competitions.map((c) => ({
      competition: { id: c.name, name: c.name },
      model_versions: ['dixon-coles@1.2.0'],
      total: point(WEEK, 40),
      points: c.points,
    })),
    last_updated_at: '2026-10-19T03:00:00.000Z',
  };
}

describe('the week', () => {
  it('is the ISO week before the one the day falls in, Monday to Sunday, UTC', () => {
    expect(previousWeekStart('2026-10-19')).toBe('2026-10-12'); // a Monday
    expect(previousWeekStart('2026-10-25')).toBe('2026-10-12'); // the Sunday after
    expect(previousWeekStart('2026-10-26')).toBe('2026-10-19');
    expect(previousWeekStart('2027-01-04')).toBe('2026-12-28');
    expect(addDays('2026-12-28', 6)).toBe('2027-01-03');
  });

  it("links to the public page's week view", () => {
    expect(accuracyUrl('https://fmip.example/')).toBe(
      'https://fmip.example/en/model-accuracy?period=week',
    );
  });
});

describe('composeWeeklyPost', () => {
  it("carries the site's weekly figures, labelled as the model's, with the uniform guess beside them", () => {
    const post = composeWeeklyPost(
      WEEK,
      answer(
        [point('2026-10-05', 50), point(WEEK, 87, 48 / 87)],
        [
          { name: 'Premier League', points: [point(WEEK, 10, 0.6)] },
          { name: 'Serie A', points: [point('2026-10-05', 10)] },
          { name: 'Ligue 1', points: [] },
        ],
      ),
      ORIGIN,
    );
    expect(post).toMatchObject({
      day: WEEK,
      fixtures: 87,
      forecasts: 87,
      modelVersions: ['dixon-coles@1.2.0'],
    });
    expect(post?.messages).toHaveLength(1);
    const text = post?.messages[0] ?? '';
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      "Stadiomind · The statistical model's accuracy · Week of Monday 12 October 2026",
    );
    expect(lines[1]).toBe(
      "How the statistical model's published forecasts (dixon-coles@1.2.0) did on the matches played from Monday 12 October 2026 to Sunday 18 October 2026 (UTC), each match counted once, by its last forecast before kick-off.",
    );
    expect(lines[2]).toBe(`Full figures: ${ORIGIN}/en/model-accuracy?period=week`);
    expect(text).toContain(
      [
        'All competitions',
        '',
        'Matches scored: 87',
        'Most likely outcome happened: 48 of 87 (55.2%; a uniform guess gets one in three)',
        'Ranked probability score: 0.198 (a uniform guess scores 0.226 on the same matches; lower is better)',
      ].join('\n'),
    );
    expect(text).toContain(
      'Premier League\n\n10 matches · most likely outcome 6 of 10 · RPS 0.198 (uniform 0.226) · limited sample',
    );
    // A competition with nothing scored that week is not listed.
    expect(text).not.toContain('Serie A');
    expect(text).not.toContain('Ligue 1');
    expect(text).not.toMatch(/founder|community|consensus/i);
  });

  it('says a small sample is limited', () => {
    const post = composeWeeklyPost(WEEK, answer([point(WEEK, 12)]), ORIGIN);
    expect(post?.messages[0]).toContain('Matches scored: 12 (a limited sample: fewer than 30)');
  });

  it('posts nothing for a week with no scored match', () => {
    expect(composeWeeklyPost(WEEK, answer([point('2026-10-05', 50)]), ORIGIN)).toBeNull();
    expect(composeWeeklyPost(WEEK, answer([point(WEEK, 0)]), ORIGIN)).toBeNull();
  });

  it('splits a long week under the limit between competitions', () => {
    const competitions = Array.from({ length: 60 }, (_, i) => ({
      name: `Competition number ${i}`,
      points: [point(WEEK, 5)],
    }));
    const post = composeWeeklyPost(WEEK, answer([point(WEEK, 300)], competitions), ORIGIN, 1500);
    const messages = post?.messages ?? [];
    expect(messages.length).toBeGreaterThan(1);
    messages.forEach((text, i) => {
      expect(text.length).toBeLessThanOrEqual(1500);
      expect(text.split('\n')[0]).toContain(`(${i + 1}/${messages.length})`);
      expect(text).toContain('/en/model-accuracy?period=week');
    });
    for (const c of competitions) {
      expect(messages.filter((m) => m.includes(`${c.name}\n`))).toHaveLength(1);
    }
  });
});
