import type { ScoreCard, ScoresGroup } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import type { CountedEvaluation } from '../../forecast/evaluation.service';
import { composeResultsPost, pendingCount, selectResults } from './results-post';

const ORIGIN = 'https://fmip.example';
const DAY = '2026-10-18';

let next = 0;
const id = (): string => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;

function card(overrides: Partial<ScoreCard> = {}): ScoreCard {
  return {
    id: id(),
    kickoff_at: '2026-10-18T14:00:00.000Z',
    status: 'finished',
    minute: null,
    competition: { id: 'c', name: 'Premier League', short_name: null, country_id: 'e' },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'Arsenal', short_name: null, code: null },
    away: { id: 'a', name: 'Chelsea', short_name: null, code: null },
    scores: {
      current: { home: 2, away: 1 },
      half_time: null,
      full_time: { home: 2, away: 1 },
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: null,
    coverage: 'available',
    last_updated_at: '2026-10-18T16:00:00.000Z',
    freshness: null,
    pinned: false,
    ...overrides,
  };
}

function group(name: string, country: string | null, fixtures: ScoreCard[]): ScoresGroup {
  return {
    country: country === null ? null : { id: country, name: country, code: 'XXX' },
    competition: { id: name, name, short_name: null },
    fixtures,
  };
}

function scored(
  fixtureId: string,
  probabilities: { home: number; draw: number; away: number },
  correct: boolean,
  actual = { home: 2, away: 1 },
  modelVersion = 'dixon-coles@1.0.0',
): CountedEvaluation {
  return {
    hasForecast: true,
    evaluation: {
      id: `e-${fixtureId}`,
      forecast_id: `f-${fixtureId}`,
      fixture_id: fixtureId,
      version_number: 2,
      kind: 'lineups_confirmed',
      model_version: modelVersion,
      computed_at: '2026-10-18T13:00:00.000Z',
      evaluated_at: '2026-10-18T16:10:00.000Z',
      pre_kickoff: true,
      actual,
      outcome: 'home',
      p_outcome: probabilities.home,
      log_loss: 0.7,
      brier: 0.4,
      rps: 0.15,
      correct,
      scoreline_hit: false,
      probabilities,
    },
  };
}

describe('selectResults', () => {
  it("keeps the day's finished matches in the product's order, each with its counted evaluation", () => {
    const right = card();
    const wrong = card({ home: { id: 'l', name: 'Liverpool', short_name: null, code: null } });
    const notForecast = card();
    const pending = card();
    const live = card({ status: 'live' });
    const postponed = card({ status: 'postponed' });
    const unsupplied = card({ coverage: 'not_supplied' });
    const noScore = card({
      scores: { ...card().scores, current: null, full_time: null },
    });
    const counted = new Map<string, CountedEvaluation>([
      [right.id, scored(right.id, { home: 0.5, draw: 0.3, away: 0.2 }, true)],
      [wrong.id, scored(wrong.id, { home: 0.2, draw: 0.3, away: 0.5 }, false)],
      [notForecast.id, { hasForecast: false, evaluation: null }],
      [pending.id, { hasForecast: true, evaluation: null }],
    ]);
    const competitions = selectResults(
      [
        group('Premier League', 'England', [right, wrong, live, postponed, noScore]),
        group('Ligue 1', 'France', [notForecast, pending, unsupplied]),
        group('Friendlies', null, [live]),
      ],
      counted,
    );
    expect(competitions.map((c) => c.title)).toEqual([
      'England · Premier League',
      'France · Ligue 1',
    ]);
    expect(competitions[0]?.matches.map((m) => m.fixtureId)).toEqual([right.id, wrong.id]);
    expect(competitions[0]?.matches[0]?.verdict).toEqual({
      kind: 'scored',
      percentages: { home: 50, draw: 30, away: 20 },
      pick: ['home'],
      correct: true,
      modelVersion: 'dixon-coles@1.0.0',
    });
    expect(competitions[0]?.matches[1]?.verdict).toMatchObject({ pick: ['away'], correct: false });
    expect(competitions[1]?.matches.map((m) => m.verdict.kind)).toEqual(['none', 'pending']);
    expect(pendingCount(competitions)).toBe(1);
  });

  it('shows the score the forecast was scored against, and names both outcomes of a tie', () => {
    const corrected = card();
    const competitions = selectResults(
      [group('Premier League', 'England', [corrected])],
      new Map([
        [
          corrected.id,
          scored(corrected.id, { home: 0.4, draw: 0.2, away: 0.4 }, true, { home: 3, away: 0 }),
        ],
      ]),
    );
    const match = competitions[0]?.matches[0];
    expect(match?.score).toEqual({ home: 3, away: 0 });
    expect(match?.verdict).toMatchObject({ pick: ['home', 'away'] });
  });
});

describe('composeResultsPost', () => {
  it('labels the post as the model’s, counts the right picks and links every match', () => {
    const right = card();
    const wrong = card({
      away: { id: 'm', name: 'Manchester United', short_name: null, code: null },
    });
    const none = card();
    const competitions = selectResults(
      [group('Premier League', 'England', [right, wrong, none])],
      new Map([
        [right.id, scored(right.id, { home: 0.5, draw: 0.3, away: 0.2 }, true)],
        [wrong.id, scored(wrong.id, { home: 0.2, draw: 0.3, away: 0.5 }, false)],
      ]),
    );
    const post = composeResultsPost(DAY, competitions, ORIGIN);
    expect(post).not.toBeNull();
    expect(post?.messages).toHaveLength(1);
    expect(post).toMatchObject({
      day: DAY,
      fixtures: 3,
      forecasts: 2,
      modelVersions: ['dixon-coles@1.0.0'],
    });
    const text = post?.messages[0] ?? '';
    const lines = text.split('\n');
    expect(lines[0]).toBe("Stadiomind · The statistical model's results · Sunday 18 October 2026");
    expect(lines[1]).toBe(
      "The day's finished matches against the statistical model's last forecast before kick-off (dixon-coles@1.0.0). Full-time scores; the day is the UTC day.",
    );
    expect(lines[2]).toBe("The model's most likely outcome happened in 1 of 2 matches.");
    expect(text).toContain(
      [
        'Arsenal 2-1 Chelsea',
        'Model: Arsenal 50% · Draw 30% · Chelsea 20%',
        "Model's pick: Arsenal · right",
        `${ORIGIN}/en/match/${right.id}`,
      ].join('\n'),
    );
    expect(text).toContain("Model's pick: Manchester United · wrong");
    expect(text).toContain(
      `Arsenal 2-1 Chelsea\nNo forecast from the statistical model before kick-off\n${ORIGIN}/en/match/${none.id}`,
    );
    // Rule 6: nothing but the model is named.
    expect(text).not.toMatch(/founder|community|consensus/i);
  });

  it('names each version when more than one scored the day', () => {
    const a = card();
    const b = card();
    const post = composeResultsPost(
      DAY,
      selectResults(
        [group('Premier League', 'England', [a, b])],
        new Map([
          [a.id, scored(a.id, { home: 0.5, draw: 0.3, away: 0.2 }, true)],
          [
            b.id,
            scored(b.id, { home: 0.5, draw: 0.3, away: 0.2 }, true, undefined, 'dixon-coles@2.0.0'),
          ],
        ]),
      ),
      ORIGIN,
    );
    expect(post?.modelVersions).toEqual(['dixon-coles@1.0.0', 'dixon-coles@2.0.0']);
    expect(post?.messages[0]).toContain(
      '(dixon-coles@1.0.0, dixon-coles@2.0.0; each line names its version)',
    );
    expect(post?.messages[0]).toContain('Chelsea 20% · dixon-coles@2.0.0');
  });

  it('posts nothing with no finished match, or none the model forecast', () => {
    expect(composeResultsPost(DAY, [], ORIGIN)).toBeNull();
    const none = card();
    expect(
      composeResultsPost(
        DAY,
        selectResults([group('Premier League', 'England', [none])], new Map()),
        ORIGIN,
      ),
    ).toBeNull();
  });

  it('says how many are not scored yet and leaves them out of the count', () => {
    const pending = card();
    const post = composeResultsPost(
      DAY,
      selectResults(
        [group('Premier League', 'England', [pending])],
        new Map([[pending.id, { hasForecast: true, evaluation: null }]]),
      ),
      ORIGIN,
    );
    expect(post?.forecasts).toBe(0);
    expect(post?.messages[0]).toContain(
      "None of the model's forecasts is scored yet. 1 more is not scored yet and not counted.",
    );
  });

  it('splits under the limit at competition boundaries, every part carrying the header and the count', () => {
    const groups: ScoresGroup[] = [];
    const counted = new Map<string, CountedEvaluation>();
    for (let c = 0; c < 12; c += 1) {
      const cards = Array.from({ length: 6 }, () => card());
      for (const x of cards)
        counted.set(x.id, scored(x.id, { home: 0.5, draw: 0.3, away: 0.2 }, true));
      groups.push(group(`League ${c}`, `Country ${c}`, cards));
    }
    const post = composeResultsPost(DAY, selectResults(groups, counted), ORIGIN, 2000);
    expect(post).not.toBeNull();
    const messages = post?.messages ?? [];
    expect(messages.length).toBeGreaterThan(1);
    messages.forEach((text, i) => {
      expect(text.length).toBeLessThanOrEqual(2000);
      expect(text.split('\n')[0]).toBe(
        `Stadiomind · The statistical model's results · Sunday 18 October 2026 (${i + 1}/${messages.length})`,
      );
      expect(text).toContain("The model's most likely outcome happened in 72 of 72 matches.");
    });
    // No competition is cut in two: each title appears in exactly one message.
    for (let c = 0; c < 12; c += 1) {
      expect(messages.filter((m) => m.includes(`Country ${c} · League ${c}\n`))).toHaveLength(1);
    }
  });
});
