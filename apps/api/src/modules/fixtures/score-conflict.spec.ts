import type { ScoreCardIncident } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { scoreConflictOf, withheld } from './internal/score-conflict';
import { toRow } from './internal/scores-store';

const line = (home: number, away: number) => ({ home, away });
const scores = (
  over: Partial<Record<'current' | 'full_time' | 'extra_time', ReturnType<typeof line>>>,
) => ({ current: null, full_time: null, extra_time: null, ...over });

describe('scoreConflictOf (T-1819, D-414)', () => {
  it('is null when the stored scores reconcile', () => {
    expect(
      scoreConflictOf('finished', scores({ current: line(2, 1), full_time: line(2, 1) })),
    ).toBeNull();
    // 1-1 after ninety, 1-0 in extra time, 2-1 after play.
    expect(
      scoreConflictOf(
        'finished',
        scores({ current: line(2, 1), full_time: line(1, 1), extra_time: line(1, 0) }),
      ),
    ).toBeNull();
  });

  it('names both invariants for "2–0 · 90′ 4–0" (Pafos v Hajduk, Los Garres v Manises)', () => {
    const s = scores({ current: line(2, 0), full_time: line(4, 0), extra_time: line(0, 0) });
    expect(scoreConflictOf('finished', s)).toEqual({
      coverage: 'limited',
      reasons: ['ninety_exceeds_final', 'extra_time_sum'],
    });
  });

  it('flags ninety minutes above the final score with no extra time (R7)', () => {
    expect(
      scoreConflictOf('finished', scores({ current: line(1, 1), full_time: line(1, 2) })),
    ).toEqual({
      coverage: 'limited',
      reasons: ['ninety_exceeds_final'],
    });
  });

  it('flags an extra-time line that does not add up (R1)', () => {
    // 1-1 at ninety, 1-0 in extra time, yet 3-1 after play.
    const s = scores({ current: line(3, 1), full_time: line(1, 1), extra_time: line(1, 0) });
    expect(scoreConflictOf('finished', s)).toEqual({
      coverage: 'limited',
      reasons: ['extra_time_sum'],
    });
  });

  it('judges only finished matches with both lines on record', () => {
    const s = scores({ current: line(2, 0), full_time: line(4, 0), extra_time: line(0, 0) });
    expect(scoreConflictOf('live', s)).toBeNull();
    expect(scoreConflictOf('awarded', s)).toBeNull();
    expect(scoreConflictOf('finished', scores({ current: line(2, 0) }))).toBeNull();
    expect(scoreConflictOf('finished', scores({ full_time: line(4, 0) }))).toBeNull();
  });

  it('withholds the three lines in conflict, never one of them, and keeps the others', () => {
    const all = {
      current: line(2, 0),
      half_time: line(1, 0),
      full_time: line(4, 0),
      extra_time: line(0, 0),
      penalties: line(4, 3),
      aggregate: line(5, 1),
    };
    const conflict = scoreConflictOf('finished', all);
    expect(withheld(all, conflict)).toEqual({
      current: null,
      half_time: line(1, 0),
      full_time: null,
      extra_time: null,
      penalties: line(4, 3),
      aggregate: line(5, 1),
    });
    expect(withheld(all, null)).toBe(all);
  });
});

describe('the scores list card (T-1819, D-414)', () => {
  const row = (
    scores: Record<string, { home: number; away: number }>,
    incidents: ScoreCardIncident[] = [],
  ) =>
    toRow({
      id: '00000000-0000-4000-8000-000000000001',
      kickoff_at: new Date('2026-07-24T17:00:00Z'),
      status: 'finished',
      minute: null,
      competition_id: '00000000-0000-4000-8000-000000000002',
      competition_name: 'UEFA Europa Conference League',
      competition_short_name: null,
      competition_order: null,
      country_id: null,
      country_name: null,
      country_code: null,
      season_id: '00000000-0000-4000-8000-000000000003',
      season_label: '2025/26',
      stage_id: null,
      stage_name: null,
      stage_kind: null,
      round: null,
      leg: null,
      venue_id: null,
      venue_name: null,
      venue_city: null,
      scores_coverage: 'available',
      home_id: '00000000-0000-4000-8000-000000000004',
      home_name: 'Pafos',
      home_short_name: null,
      home_code: null,
      away_id: '00000000-0000-4000-8000-000000000005',
      away_name: 'Hajduk Split',
      away_short_name: null,
      away_code: null,
      scores,
      incidents,
      last_updated_at: new Date('2026-07-24T19:30:00Z'),
      live_answered_at: null,
    }).card;

  it('carries no number, a limited coverage and the reasons, and no goals dispute', () => {
    const goal = (minute: number): ScoreCardIncident => ({
      kind: 'goal',
      side: 'home',
      minute,
      added_time: null,
      player: null,
    });
    const card = row({ current: line(2, 0), full_time: line(4, 0), extra_time: line(0, 0) }, [
      goal(5),
      goal(30),
      goal(60),
      goal(88),
    ]);
    expect(card.scores.current).toBeNull();
    expect(card.scores.full_time).toBeNull();
    expect(card.scores.extra_time).toBeNull();
    expect(card.coverage).toBe('limited');
    expect(card.score_conflict).toEqual({
      coverage: 'limited',
      reasons: ['ninety_exceeds_final', 'extra_time_sum'],
    });
    expect(card.score_dispute).toBeNull();
    expect(JSON.stringify(card.scores)).not.toMatch(/"home":[24]/);
  });

  it('leaves a reconciled match as it was', () => {
    const card = row({ current: line(2, 1), full_time: line(2, 1) });
    expect(card.scores.current).toEqual(line(2, 1));
    expect(card.coverage).toBe('available');
    expect(card.score_conflict).toBeNull();
  });
});
