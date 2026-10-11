import type { Prediction, PredictionHistoryItem, ScoreCard, ScoresResponse } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { PREDICTION_DAYS, dayKind, ownPredictions, predictionDays } from './predictions-days';

/**
 * The Predictions page's list by day (T-1383, D-201): today first, then the
 * next days, each grouped by competition in the scores answer's order, a
 * competition filter, and a cap that is counted, never silent.
 */

const PRO = { id: '00000000-0000-4000-8000-000000000101', name: 'Persian Gulf Pro League' };
const UCL = { id: '00000000-0000-4000-8000-000000000102', name: 'UEFA Champions League' };

let n = 0;
function card(competition: { id: string; name: string }, kickoff: string): ScoreCard {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    kickoff_at: kickoff,
    competition: { ...competition, short_name: null, country_id: null },
    home: { id: `h${n}`, name: `Home ${n}` },
    away: { id: `a${n}`, name: `Away ${n}` },
  } as unknown as ScoreCard;
}

function scores(groups: { competition: typeof PRO; fixtures: ScoreCard[] }[]): ScoresResponse {
  return {
    pinned: [],
    groups: groups.map((g) => ({
      country: null,
      competition: { ...g.competition, short_name: null },
      fixtures: g.fixtures,
    })),
  } as unknown as ScoresResponse;
}

// Tehran is UTC+3:30: 21:00 UTC on the 8th is the 9th there.
const lateThursday = card(PRO, '2026-10-08T21:00:00Z');
const proToday = card(PRO, '2026-10-08T13:30:00Z');
const proEarly = card(PRO, '2026-10-08T12:30:00Z');
const uclToday = card(UCL, '2026-10-08T16:00:00Z');
const proSaturday = card(PRO, '2026-10-10T14:00:00Z');
const answer = scores([
  { competition: PRO, fixtures: [proEarly, proToday, lateThursday, proSaturday] },
  { competition: UCL, fixtures: [uclToday] },
]);

describe('predictionDays', () => {
  it('lists today, then the next days, each grouped by competition in the answer’s order', () => {
    const list = predictionDays(answer, {
      from: '2026-10-08',
      timeZone: 'Asia/Tehran',
      competition: null,
      limit: 50,
    });
    expect(list.days.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
    const [today, friday] = list.days;
    expect(today?.competitions.map((c) => c.name)).toEqual([PRO.name, UCL.name]);
    expect(today?.competitions[0]?.fixtures.map((f) => f.id)).toEqual([proEarly.id, proToday.id]);
    expect(today?.count).toBe(3);
    // The day is the reader's: 21:00 UTC is Friday in Tehran.
    expect(friday?.competitions[0]?.fixtures.map((f) => f.id)).toEqual([lateThursday.id]);
    expect(list.shown.map((f) => f.id)).toEqual([
      proEarly.id,
      proToday.id,
      uclToday.id,
      lateThursday.id,
      proSaturday.id,
    ]);
    expect(list.omitted).toBe(0);
    expect(list.competitions).toEqual([PRO, UCL]);
  });

  it('reads the day in UTC as UTC', () => {
    const list = predictionDays(answer, {
      from: '2026-10-08',
      timeZone: 'UTC',
      competition: null,
      limit: 50,
    });
    expect(list.days.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-10']);
  });

  it('keeps one competition, and still offers every competition in the window', () => {
    const list = predictionDays(answer, {
      from: '2026-10-08',
      timeZone: 'UTC',
      competition: UCL.id,
      limit: 50,
    });
    expect(list.shown.map((f) => f.id)).toEqual([uclToday.id]);
    expect(list.competitions).toEqual([PRO, UCL]);
  });

  it('caps the list in page order and counts what it left out', () => {
    const list = predictionDays(answer, {
      from: '2026-10-08',
      timeZone: 'UTC',
      competition: null,
      limit: 2,
    });
    expect(list.shown.map((f) => f.id)).toEqual([proEarly.id, proToday.id]);
    expect(list.omitted).toBe(3);
    // A day the cap emptied is not drawn as an empty day.
    expect(list.days.map((d) => d.date)).toEqual(['2026-10-08']);
  });

  it('leaves out a day with no match rather than drawing it empty', () => {
    const list = predictionDays(scores([]), {
      from: '2026-10-08',
      timeZone: 'UTC',
      competition: null,
      limit: 50,
    });
    expect(list.days).toEqual([]);
    expect(list.competitions).toEqual([]);
    expect(PREDICTION_DAYS).toBe(3);
  });
});

describe('dayKind', () => {
  it('names today and tomorrow, and leaves the rest to the weekday', () => {
    expect(dayKind('2026-10-08', '2026-10-08')).toBe('today');
    expect(dayKind('2026-10-09', '2026-10-08')).toBe('tomorrow');
    expect(dayKind('2026-10-10', '2026-10-08')).toBe('other');
    expect(dayKind('2026-10-07', '2026-10-08')).toBe('other');
  });
});

describe('ownPredictions', () => {
  const item = (fixtureId: string, kickoff: string): PredictionHistoryItem =>
    ({
      fixture: { id: fixtureId, kickoff_at: kickoff },
      prediction: { fixture_id: fixtureId } as Prediction,
    }) as unknown as PredictionHistoryItem;

  it('answers from one page when the page holds the whole history', () => {
    const { found, missing } = ownPredictions([item(proToday.id, proToday.kickoff_at)], false, [
      proToday,
      uclToday,
    ]);
    expect([...found.keys()]).toEqual([proToday.id]);
    // Not on a page that was not full: simply not predicted.
    expect(missing).toEqual([]);
  });

  it('asks again only for a match older than a full page reaches', () => {
    const { missing } = ownPredictions([item(proSaturday.id, proSaturday.kickoff_at)], true, [
      proEarly,
      proSaturday,
      lateThursday,
    ]);
    expect(missing).toEqual([proEarly.id, lateThursday.id]);
  });
});
