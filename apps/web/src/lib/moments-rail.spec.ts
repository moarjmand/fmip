import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Moment, MomentForecast, MomentsResponse, ScoreCard } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { scoresWords } from './words-server';
import {
  LATE_START_MS,
  MOMENTS_IDLE_MS,
  MOMENTS_RETRY_MS,
  cardsThatFit,
  fitThreshold,
  isLiveMoment,
  modelPick,
  momentEyebrow,
  momentSentence,
  momentWhen,
  momentsAskIn,
  moreVariants,
  panelSentence,
  wholeShares,
  winnerOf,
} from './moments-rail';

/**
 * The moments rail's rules (T-1642, D-300): the eyebrow and the sentence
 * per kind, with and without a forecast, the time at the eyebrow's end
 * (stale included), when the rail asks again, and the desktop row's "fits /
 * N more" arithmetic, held to the stylesheet that draws it.
 */

const NOW = Date.parse('2026-10-24T18:00:00.000Z');
const minutes = (n: number) => new Date(NOW + n * 60_000).toISOString();

function card(over: Partial<ScoreCard> = {}): ScoreCard {
  return {
    id: '00000000-0000-4000-8000-000000016420',
    kickoff_at: minutes(120),
    status: 'scheduled',
    minute: null,
    competition: { id: 'c-epl', name: 'Premier League', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: 'Regular Season - 9',
    leg: null,
    home: { id: 't-ars', name: 'Arsenal', short_name: null, code: 'ARS' },
    away: { id: 't-che', name: 'Chelsea', short_name: null, code: 'CHE' },
    scores: {
      current: null,
      half_time: null,
      full_time: null,
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: null,
    coverage: 'available',
    last_updated_at: minutes(-1),
    live_answered_at: null,
    freshness: null,
    pinned: false,
    ...over,
  };
}

const FORECAST: MomentForecast = {
  home: 0.4637,
  draw: 0.2964,
  away: 0.2399,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-23T09:30:00.000Z',
};

function moment(over: Partial<Moment> = {}): Moment {
  return {
    kind: 'big_one',
    followed: false,
    fixture: card(),
    forecast: FORECAST,
    side: null,
    minutes_left: null,
    ...over,
  };
}

const line = (home: number, away: number) => ({
  ...card().scores,
  current: { home, away },
});

const live = (minute: number, home: number, away: number, over: Partial<ScoreCard> = {}) =>
  card({
    status: 'live',
    minute,
    kickoff_at: minutes(-minute - 15),
    scores: line(home, away),
    last_updated_at: minutes(-0.5),
    live_answered_at: minutes(-0.2),
    freshness: 'current',
    ...over,
  });

const LONDON = 'Europe/London';
const en = (m: Moment) => momentEyebrow(m, 'en', LONDON, NOW).text;
const said = (m: Moment, lang: 'en' | 'fa' = 'en') => momentSentence(m, lang)?.text ?? null;

describe('the eyebrow, per kind', () => {
  it('names each kind in the reader’s words', () => {
    expect(en(moment({ kind: 'against_forecast', fixture: live(80, 0, 1) }))).toBe(
      'Against the model',
    );
    expect(en(moment({ kind: 'favourite_held', fixture: live(55, 0, 0) }))).toBe('Favourite held');
    expect(en(moment({ kind: 'closest_call' }))).toBe('Closest call');
    expect(en(moment({ kind: 'upset' }))).toBe('Upset');
    expect(en(moment({ kind: 'followed', followed: true }))).toBe('Your team');
  });

  it('counts the minutes left in a level match, and says added time at none', () => {
    expect(en(moment({ kind: 'level_late', fixture: live(78, 1, 1), minutes_left: 12 }))).toBe(
      'Level, 12 min to go',
    );
    expect(en(moment({ kind: 'level_late', fixture: live(90, 1, 1), minutes_left: 0 }))).toBe(
      'Level in added time',
    );
    // Persian words and digits.
    expect(
      momentEyebrow(
        moment({ kind: 'level_late', fixture: live(78, 1, 1), minutes_left: 12 }),
        'fa',
        'Asia/Tehran',
        NOW,
      ).text,
    ).toBe('مساوی، ۱۲ دقیقه مانده');
  });

  it('calls the big one tonight from the evening in the reader’s zone, else today', () => {
    // 19:00 UTC is 20:00 in London, 22:30 in Tehran; 12:00 UTC is 13:00 in London.
    const evening = moment({ fixture: card({ kickoff_at: '2026-10-24T19:00:00.000Z' }) });
    const noon = moment({ fixture: card({ kickoff_at: '2026-10-24T12:00:00.000Z' }) });
    expect(en(evening)).toBe('Big one tonight');
    expect(en(noon)).toBe('Big one today');
    expect(momentEyebrow(noon, 'en', 'Asia/Tokyo', NOW).text).toBe('Big one tonight');
  });

  it('counts down to a kick-off, and says it is due once the time has passed', () => {
    const soon = moment({ kind: 'starting_soon', fixture: card({ kickoff_at: minutes(17.5) }) });
    expect(en(soon)).toBe('Starts in 18 min');
    const due = moment({ kind: 'starting_soon', fixture: card({ kickoff_at: minutes(-1) }) });
    expect(en(due)).toBe('Kick-off due');
  });

  it('names the weekday of a match coming up on another day, in the reader’s zone', () => {
    const today = moment({ kind: 'coming_up', fixture: card({ kickoff_at: minutes(180) }) });
    // Sunday 25 October, 14:00 UTC.
    const sunday = moment({
      kind: 'coming_up',
      fixture: card({ kickoff_at: '2026-10-25T14:00:00.000Z' }),
    });
    expect(en(today)).toBe('Coming up');
    expect(en(sunday)).toBe('Coming up Sun');
    expect(momentEyebrow(sunday, 'fa', 'Asia/Tehran', NOW).text).toBe('به‌زودی، یکشنبه');
  });

  it('is in saffron only while the match is being played', () => {
    expect(isLiveMoment(moment({ fixture: live(80, 0, 1) }))).toBe(true);
    expect(isLiveMoment(moment())).toBe(false);
    expect(isLiveMoment(moment({ fixture: card({ status: 'finished' }) }))).toBe(false);
  });
});

describe('the time at the eyebrow’s end', () => {
  const words = scoresWords('en').m;

  it('is the minute in play, with the word that replaces it once the answer ages', () => {
    expect(momentWhen(live(80, 0, 1), 'en', LONDON, NOW, words)).toEqual({
      text: '80′',
      behind: 'Behind',
    });
  });

  it('is "Behind" itself when the match’s own data has stopped (rule 4, D-045)', () => {
    const stale = live(80, 0, 1, { freshness: 'stale' });
    expect(momentWhen(stale, 'en', LONDON, NOW, words)).toEqual({ text: 'Behind' });
    const quiet = live(80, 0, 1, { last_updated_at: minutes(-10), live_answered_at: null });
    expect(momentWhen(quiet, 'en', LONDON, NOW, words)).toEqual({ text: 'Behind' });
  });

  it('is the kick-off in the reader’s zone and digits, or the result’s word', () => {
    const later = card({ kickoff_at: '2026-10-24T19:00:00.000Z' });
    expect(momentWhen(later, 'en', LONDON, NOW, words).text).toBe('20:00');
    expect(momentWhen(later, 'fa', 'Asia/Tehran', NOW, scoresWords('fa').m).text).toBe('۲۲:۳۰');
    const over = card({
      status: 'finished',
      scores: { ...line(2, 1), full_time: { home: 2, away: 1 } },
    });
    expect(momentWhen(over, 'en', LONDON, NOW, words).text).toBe('FT');
  });
});

describe('the model line, per kind (whole percentages totalling 100)', () => {
  it('sums the three shares to exactly 100', () => {
    expect(wholeShares(FORECAST)).toEqual({ home: 46, draw: 30, away: 24 });
    const odd = wholeShares({ ...FORECAST, home: 0.335, draw: 0.335, away: 0.33 });
    expect(odd.home + odd.draw + odd.away).toBe(100);
  });

  it('against the forecast: the leader, and what the model gave them', () => {
    const m = moment({ kind: 'against_forecast', fixture: live(80, 0, 1), side: 'away' });
    expect(said(m)).toBe('Chelsea lead; before kick-off the model gave them 24%.');
    expect(said(m, 'fa')).toBe('Chelsea جلو است؛ مدل پیش از شروع بازی به آن ۲۴٪ شانس داده بود.');
  });

  it('level late: the model’s pick and the draw, or the draw as the pick', () => {
    const m = moment({ kind: 'level_late', fixture: live(78, 1, 1), minutes_left: 12 });
    expect(said(m)).toBe('Arsenal were the model’s pick at 46%; the draw had 30%.');
    const drawn = moment({
      kind: 'level_late',
      fixture: live(78, 1, 1),
      forecast: { ...FORECAST, home: 0.3, draw: 0.4, away: 0.3 },
    });
    expect(said(drawn)).toBe('The draw was the model’s pick at 40%.');
    expect(modelPick({ home: 0.3, draw: 0.3, away: 0.4 })).toBe('away');
  });

  it('favourite held: level or behind, and the favourite’s share', () => {
    const fav = { ...FORECAST, home: 0.7, draw: 0.18, away: 0.12 };
    const level = moment({
      kind: 'favourite_held',
      fixture: live(55, 0, 0),
      forecast: fav,
      side: 'home',
    });
    const behind = moment({
      kind: 'favourite_held',
      fixture: live(70, 0, 1),
      forecast: fav,
      side: 'home',
    });
    expect(said(level)).toBe('Arsenal are level; the model gave them 70%.');
    expect(said(behind)).toBe('Arsenal are behind; the model gave them 70%.');
  });

  it('upset: the winner on the full-time score, and their share', () => {
    const over = card({
      status: 'finished',
      scores: { ...line(0, 2), full_time: { home: 0, away: 2 } },
    });
    expect(winnerOf(over)).toBe('away');
    expect(said(moment({ kind: 'upset', fixture: over, side: 'away' }))).toBe(
      'Chelsea won; the model gave them 24%.',
    );
    // With no side given, the winner is read from the score.
    expect(said(moment({ kind: 'upset', fixture: over }))).toBe(
      'Chelsea won; the model gave them 24%.',
    );
  });

  it('closest call: the three numbers and why', () => {
    const even = { ...FORECAST, home: 0.34, draw: 0.33, away: 0.33 };
    expect(said(moment({ kind: 'closest_call', forecast: even }))).toBe(
      '34% · 33% · 33%: the most even match still to start.',
    );
  });

  it('the rest: both teams and the draw', () => {
    const three = 'Arsenal 46%, the draw 30%, Chelsea 24%.';
    for (const kind of ['big_one', 'starting_soon', 'followed', 'coming_up'] as const) {
      expect(said(moment({ kind }))).toBe(three);
    }
    expect(said(moment(), 'fa')).toBe('Arsenal ۴۶٪، مساوی ۳۰٪، Chelsea ۲۴٪.');
  });

  it('is never drawn without a forecast (rule 3), whatever the kind', () => {
    for (const kind of [
      'level_late',
      'big_one',
      'starting_soon',
      'followed',
      'coming_up',
    ] as const) {
      expect(momentSentence(moment({ kind, forecast: null }), 'en')).toBeNull();
    }
    expect(panelSentence(moment({ forecast: null }), 'en')).toBeNull();
  });

  it('says the hover card’s sentence with the same numbers', () => {
    expect(panelSentence(moment(), 'en')?.text).toBe(
      'Before kick-off the model gave Arsenal 46%, the draw 30%, Chelsea 24%.',
    );
  });
});

describe('when the rail asks again', () => {
  const answer = (moments: Moment[], live_count = 0): MomentsResponse => ({
    generated_at: minutes(0),
    timezone: LONDON,
    live_count,
    today_count: 12,
    moments,
  });

  it('every half-minute while anything is being played, on the rail or not', () => {
    expect(momentsAskIn(answer([moment({ fixture: live(80, 0, 1) })], 1), NOW)).toBe(0);
    expect(momentsAskIn(answer([moment()], 3), NOW)).toBe(0);
    // A kick-off that has passed without the match starting yet.
    const late = moment({ fixture: card({ kickoff_at: minutes(-10) }) });
    expect(momentsAskIn(answer([late]), NOW)).toBe(0);
    const long = moment({
      fixture: card({ kickoff_at: new Date(NOW - LATE_START_MS).toISOString() }),
    });
    expect(momentsAskIn(answer([long]), NOW)).toBe(MOMENTS_IDLE_MS);
  });

  it('at the next kick-off, or within the idle wait, when nothing is played', () => {
    const soon = moment({ fixture: card({ kickoff_at: minutes(4) }) });
    expect(momentsAskIn(answer([soon, moment()]), NOW)).toBe(4 * 60_000);
    expect(momentsAskIn(answer([moment()]), NOW)).toBe(MOMENTS_IDLE_MS);
    expect(momentsAskIn(answer([]), NOW)).toBe(MOMENTS_IDLE_MS);
  });

  it('again in a few minutes when there was no answer', () => {
    expect(momentsAskIn(null, NOW)).toBe(MOMENTS_RETRY_MS);
  });
});

describe('the desktop row: the cards that fit, and N more', () => {
  it('fits k cards from k × 15.75rem + 3.5rem', () => {
    expect([1, 2, 3, 4, 8].map(fitThreshold)).toEqual([19.25, 35, 50.75, 66.5, 129.5]);
  });

  it('shows two cards at 768px, three at 1024px and four in the 1280px frame', () => {
    // The row is the frame less its gutters (2rem each side), the lead (7.5rem) and a 1rem gap.
    const row = (viewport: number) => Math.min(viewport, 1280) / 16 - 4 - 7.5 - 1;
    expect(cardsThatFit(row(768), 8)).toBe(2);
    expect(cardsThatFit(row(1024), 8)).toBe(3);
    expect(cardsThatFit(row(1280), 8)).toBe(4);
    expect(cardsThatFit(row(1920), 8)).toBe(4);
    // Never more than there are, never fewer than one.
    expect(cardsThatFit(row(1280), 2)).toBe(2);
    expect(cardsThatFit(10, 8)).toBe(1);
  });

  it('carries one "N more" per width, each counting the cards left out', () => {
    expect(moreVariants(6)).toEqual([
      { shown: 1, more: 5 },
      { shown: 2, more: 4 },
      { shown: 3, more: 3 },
      { shown: 4, more: 2 },
      { shown: 5, more: 1 },
    ]);
    expect(moreVariants(1)).toEqual([]);
    expect(moreVariants(8)).toHaveLength(7);
  });

  it('is what the stylesheet draws: its container queries are these thresholds', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    const ranges = [
      ...css.matchAll(
        /@container moments \(([^)]*)\)\s*\{\s*\.moments-cards \{\s*--moments-fit: (\d);/g,
      ),
    ].map(([, range, fit]) => ({ range: range ?? '', fit: Number(fit) }));
    expect(ranges.map((r) => r.fit)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const { range, fit } of ranges) {
      const bounds = [...range.matchAll(/([\d.]+)rem/g)].map(([, n]) => Number(n));
      const expected = [
        fit > 1 ? fitThreshold(fit) : null,
        fit < 8 ? fitThreshold(fit + 1) : null,
      ].filter((n): n is number => n !== null);
      expect(bounds, range).toEqual(expected);
      if (fit < 8) {
        expect(css).toContain(`.moments-cards > :nth-child(n + ${fit + 1})`);
        expect(css).toContain(`.moments-more[data-shown='${fit}']`);
      }
    }
    // The card's least width, the gap and the "N more" slot are the same numbers.
    expect(css).toMatch(/\.moments-more-slot \{\s*@apply flex w-14 /);
    expect(css).toMatch(/\.moments-row \{\s*@apply flex min-w-0 flex-1 gap-3;/);
  });
});
