import { describe, expect, it } from 'vitest';
import type { ForecastListEntry, ScoreCard, ScoresResponse } from '@fmip/contracts';
import { homeForecasts, homeMatches, shortDay, tableCompetition } from './home';

/** T-526: the homepage keeps the reader's order and shows only what is real. */
const card = (
  id: string,
  status: ScoreCard['status'],
  kickoff: string,
  competition = 'pl',
): ScoreCard =>
  ({
    id,
    status,
    kickoff_at: kickoff,
    competition: { id: competition, name: competition, short_name: null, country_id: null },
    home: { id: `${id}h`, name: `${id} home`, short_name: null, code: null },
    away: { id: `${id}a`, name: `${id} away`, short_name: null, code: null },
  }) as unknown as ScoreCard;

const scores = (pinned: ScoreCard[], groups: ScoreCard[][]): ScoresResponse =>
  ({
    pinned,
    groups: groups.map((fixtures) => ({
      country: null,
      competition: fixtures[0]!.competition,
      fixtures,
    })),
  }) as unknown as ScoresResponse;

describe('the homepage', () => {
  it('lists favourites, then live matches, then the soonest upcoming, and nothing finished', () => {
    const fav = card('fav', 'scheduled', '2026-10-05T12:00:00Z');
    const later = card('later', 'scheduled', '2026-10-04T18:00:00Z', 'll');
    const soon = card('soon', 'scheduled', '2026-10-04T12:00:00Z');
    const live = card('live', 'live', '2026-10-03T12:00:00Z', 'll');
    const done = card('done', 'finished', '2026-10-03T10:00:00Z');
    const picked = homeMatches(
      scores(
        [fav],
        [
          [soon, done],
          [later, live],
        ],
      ),
    );
    expect(picked.map((c) => c.id)).toEqual(['fav', 'live', 'soon', 'later']);
    expect(homeMatches(scores([], [[soon, later]]), 1).map((c) => c.id)).toEqual(['soon']);
  });

  it('takes its table from the first competition in the reader’s order', () => {
    const a = card('a', 'scheduled', '2026-10-04T12:00:00Z', 'ucl');
    const b = card('b', 'scheduled', '2026-10-04T12:00:00Z', 'pl');
    expect(tableCompetition(scores([], [[a], [b]]))).toBe('ucl');
    expect(tableCompetition(scores([b], [[a]]))).toBe('pl');
    expect(tableCompetition(scores([], []))).toBeNull();
  });

  it('shows the model’s view only for upcoming matches that have an available forecast', () => {
    const one = card('one', 'scheduled', '2026-10-04T12:00:00Z');
    const two = card('two', 'scheduled', '2026-10-04T14:00:00Z');
    const entries = [
      {
        fixture_id: 'one',
        latest: {
          status: 'available',
          model_version: 'dixon-coles-elo@0.1.0',
          probabilities: { home: 0.4547, draw: 0.2913, away: 0.254 },
        },
      },
      { fixture_id: 'two', latest: { status: 'unavailable', probabilities: null } },
    ] as unknown as ForecastListEntry[];
    const view = homeForecasts([one, two], entries);
    expect(view.map((v) => v.card.id)).toEqual(['one']);
    expect(view[0]!.percent).toEqual({ home: 45.5, draw: 29.1, away: 25.4 });
    expect(view[0]!.modelVersion).toBe('dixon-coles-elo@0.1.0');
  });

  it('writes a kick-off day in the reader’s zone, not in UTC', () => {
    expect(shortDay('2026-10-04T22:30:00Z', 'UTC')).toBe('4 Oct');
    expect(shortDay('2026-10-04T22:30:00Z', 'Asia/Tehran')).toBe('5 Oct');
  });
});
