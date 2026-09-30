import { describe, expect, it } from 'vitest';
import type {
  ForecastListEntry,
  MatchViewing,
  PanelLatest,
  ScoreCard,
  ScoresResponse,
} from '@fmip/contracts';
import {
  featuredNotes,
  homeForecasts,
  homeMatches,
  homePanels,
  homeViewing,
  shortDay,
  tableCompetition,
  todayFixtureIds,
} from './home';

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

  it('lists featured matches after the favourites and before the rest (T-1161)', () => {
    const fav = card('fav', 'scheduled', '2026-10-05T12:00:00Z');
    const soon = card('soon', 'scheduled', '2026-10-03T12:00:00Z');
    const later = card('later', 'scheduled', '2026-10-04T12:00:00Z');
    const live = card('live', 'live', '2026-10-03T12:00:00Z');
    const done = card('done', 'finished', '2026-10-03T10:00:00Z');
    const list = scores([fav], [[soon, later, live, done]]);
    const ids = (featured: string[]) => homeMatches(list, 8, new Set(featured)).map((c) => c.id);
    expect(ids(['later'])).toEqual(['fav', 'later', 'live', 'soon']);
    // A favourite stays where it is; a finished or absent match is not listed.
    expect(ids(['fav', 'done', 'elsewhere'])).toEqual(['fav', 'live', 'soon', 'later']);
    expect(ids(['later', 'live'])).toEqual(['fav', 'live', 'later', 'soon']);
    // Nothing featured: the list is exactly as before.
    expect(ids([])).toEqual(homeMatches(list).map((c) => c.id));
    // The model's view follows the same order.
    const entry = (id: string) => ({
      fixture_id: id,
      latest: {
        status: 'available',
        model_version: 'dixon-coles-elo@0.1.0',
        probabilities: { home: 0.4, draw: 0.3, away: 0.3 },
      },
    });
    const forecasts = homeForecasts(
      homeMatches(list, 8, new Set(['later'])),
      ['soon', 'later', 'fav'].map(entry) as unknown as ForecastListEntry[],
    );
    expect(forecasts.map((f) => f.card.id)).toEqual(['fav', 'later', 'soon']);
  });

  it('reads the editor’s notes, and an unreachable answer as nothing featured', () => {
    expect(featuredNotes([{ fixture_id: 'a', note: 'Derby.' }]).get('a')).toBe('Derby.');
    expect(featuredNotes(null).size).toBe(0);
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
    expect(shortDay('en', '2026-10-04T22:30:00Z', 'UTC')).toBe('4 Oct');
    expect(shortDay('en', '2026-10-04T22:30:00Z', 'Asia/Tehran')).toBe('5 Oct');
    expect(shortDay('fa', '2026-10-04T22:30:00Z', 'Asia/Tehran')).toBe('۱۳ مهر');
  });
});

describe("the member's homepage (T-942)", () => {
  it("takes today's matches in the reader's zone, pinned first, once each", () => {
    const pinned = card('fav', 'scheduled', '2026-10-04T20:00:00Z');
    const late = card('late', 'scheduled', '2026-10-04T23:30:00Z');
    const tomorrow = card('tomorrow', 'scheduled', '2026-10-05T12:00:00Z');
    const done = card('done', 'finished', '2026-10-04T10:00:00Z');
    const data = scores([pinned], [[done, pinned, late, tomorrow]]);
    // 23:30 UTC is already the 5th in Tehran, so it is not "today" there.
    expect(todayFixtureIds(data, '2026-10-04', 'UTC')).toEqual(['fav', 'done', 'late']);
    expect(todayFixtureIds(data, '2026-10-04', 'Asia/Tehran')).toEqual(['fav', 'done']);
  });

  it('lists only panels with a post, the most recently written-on first', () => {
    const panel = (id: string, at: string | null): PanelLatest =>
      ({
        fixture_id: id,
        state: 'open',
        total: at === null ? 0 : 1,
        posts: at === null ? [] : [{ id: `${id}p`, created_at: at }],
      }) as unknown as PanelLatest;
    const chosen = homePanels([
      panel('quiet', null),
      panel('older', '2026-10-04T10:00:00Z'),
      panel('newer', '2026-10-04T12:00:00Z'),
    ]);
    expect(chosen.map((p) => p.fixture_id)).toEqual(['newer', 'older']);
  });

  it('asks for a territory once, not on every line', () => {
    const cards = [
      card('a', 'scheduled', '2026-10-04T12:00:00Z'),
      card('b', 'live', '2026-10-04T10:00:00Z'),
    ];
    const unchosen = (id: string) =>
      ({ fixture_id: id, territory: { state: 'not_chosen' } }) as unknown as MatchViewing;
    expect(homeViewing(cards, [unchosen('a'), unchosen('b')])).toEqual({ state: 'ask' });
    expect(homeViewing(cards, null)).toEqual({ state: 'unreachable' });

    const listed = {
      fixture_id: 'a',
      territory: { state: 'chosen', territory: { code: 'GB', name: 'United Kingdom' } },
      options: { coverage: 'available', data: [{}], last_updated_at: null },
      highlights: { coverage: 'not_supplied', data: null, last_updated_at: null },
    } as unknown as MatchViewing;
    const lines = homeViewing(cards, [listed]);
    expect(lines.state).toBe('lines');
    if (lines.state === 'lines') {
      expect(lines.byFixture.get('a')).toMatchObject({ state: 'listed', count: 1 });
      // A match the answer left out is said to be unreachable, not guessed.
      expect(lines.byFixture.get('b')).toEqual({ state: 'unreachable' });
    }
  });
});
