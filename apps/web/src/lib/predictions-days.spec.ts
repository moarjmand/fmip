import type { Prediction, PredictionHistoryItem, ScoreCard } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { ownPredictions } from './predictions-days';

/**
 * The member's own picks from one page of their history (D-201), as the
 * matches page reads them (T-1496): a per-match read only where that page
 * cannot answer.
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

const lateThursday = card(PRO, '2026-10-08T21:00:00Z');
const proToday = card(PRO, '2026-10-08T13:30:00Z');
const proEarly = card(PRO, '2026-10-08T12:30:00Z');
const uclToday = card(UCL, '2026-10-08T16:00:00Z');
const proSaturday = card(PRO, '2026-10-10T14:00:00Z');

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
