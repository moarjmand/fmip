import { describe, expect, it } from 'vitest';
import { checkGrounding, vocabularyOf } from './grounding';
import { FACTS_VERSION, type MatchFacts } from './match-facts';

/**
 * The grounding gate (T-411) against summaries written to pass and to fail:
 * a name the record lacks, a number the record lacks, a minute with added
 * time, a season's year, a sentence-initial word that is not a name. The
 * gate is a heuristic and the tests say what it does, not what it means.
 */
const FACTS: MatchFacts = {
  facts_version: FACTS_VERSION,
  match: {
    id: 'f',
    competition: 'Premier League',
    season: '2025/26',
    stage: 'Regular season',
    round: 'Matchweek 7',
    kickoff_at: '2026-09-12T15:00:00Z',
    status: 'finished',
    venue: 'Anfield',
    city: 'Liverpool',
    neutral_venue: false,
    referee: 'Anthony Taylor',
    attendance: 60000,
  },
  home: { id: 'h', name: 'Liverpool', formation: '4-3-3', coach: 'Arne Slot' },
  away: { id: 'a', name: 'Manchester United', formation: null, coach: null },
  score: {
    current: { home: 2, away: 2 },
    half_time: { home: 1, away: 0 },
    full_time: { home: 2, away: 2 },
    extra_time: null,
    penalties: null,
    aggregate: null,
  },
  timeline: {
    coverage: 'available',
    incidents: [
      {
        minute: 23,
        added_time: null,
        kind: 'goal',
        side: 'home',
        player: 'Mohamed Salah',
        related_player: null,
        detail: null,
      },
      {
        minute: 45,
        added_time: 2,
        kind: 'yellow_card',
        side: 'away',
        player: 'Bruno Fernandes',
        related_player: null,
        detail: null,
      },
    ],
  },
  statistics: { coverage: 'available', rows: [{ metric: 'possession_pct', home: 58, away: 42 }] },
  lineups: { coverage: 'not_supplied', home: [], away: [] },
  form: { coverage: 'not_supplied', home: [], away: [] },
  head_to_head: { coverage: 'not_supplied', entries: [] },
  forecast: {
    coverage: 'available',
    probabilities: { home: 51.4, draw: 24.1, away: 24.5 },
    model_version: 'baseline@3',
    computed_at: '2026-09-12T09:00:00Z',
  },
  consensus: { coverage: 'not_supplied', sample: null, crowd: null },
};

describe('vocabularyOf', () => {
  it('collects every name and number the record holds, including minutes with added time and the season as years', () => {
    const { names, numbers } = vocabularyOf(FACTS);
    expect(names).toEqual(
      expect.arrayContaining([
        'Premier League',
        'Anfield',
        'Anthony Taylor',
        'Liverpool',
        'Manchester United',
        'Arne Slot',
        'Mohamed Salah',
        'Bruno Fernandes',
      ]),
    );
    for (const n of [
      '2',
      '1',
      '0',
      '23',
      '45',
      '45+2',
      '58',
      '42',
      '60000',
      '2025',
      '26',
      '2026',
      '51.4',
      '51',
    ]) {
      expect(numbers.has(n), n).toBe(true);
    }
    expect(numbers.has('3')).toBe(true); // small counts are said either way
    expect(numbers.has('77')).toBe(false);
  });
});

describe('checkGrounding', () => {
  it('passes a summary that names and counts only what the record holds', () => {
    const text =
      'Liverpool and Manchester United drew 2-2 at Anfield. Mohamed Salah scored after 23 minutes and Bruno Fernandes was booked in first-half added time (45+2). Liverpool had 58 percent of the ball. The model had given Liverpool a 51.4 percent chance.';
    expect(checkGrounding(text, FACTS)).toEqual({ ok: true });
  });

  it('refuses a person the record does not hold, even a plausible one', () => {
    const text = 'Liverpool drew 2-2. Late on, Darwin Nunez hit the bar.';
    expect(checkGrounding(text, FACTS)).toEqual({
      ok: false,
      reason: 'name not in the record: Darwin Nunez',
    });
  });

  it('refuses a number the record does not hold', () => {
    const text = 'Liverpool drew 2-2 in front of 61000 people.';
    expect(checkGrounding(text, FACTS)).toEqual({
      ok: false,
      reason: 'number not in the record: 61000',
    });
    expect(checkGrounding('Liverpool had 12 shots.', FACTS)).toMatchObject({ ok: false });
  });

  it("reads a digit inside a name as the name's, not as a number the text asserts", () => {
    const facts: MatchFacts = { ...FACTS, away: { ...FACTS.away, name: 'Schalke 04' } };
    expect(checkGrounding('Liverpool beat Schalke 04 by 2-1 at Anfield.', facts)).toEqual({
      ok: true,
    });
  });

  it('does not read a sentence-initial word or an ordinary capitalised word as a name', () => {
    expect(
      checkGrounding(
        'Late pressure told. Both sides finished with eleven men. VAR checked the second goal.',
        FACTS,
      ),
    ).toEqual({ ok: true });
  });
});
