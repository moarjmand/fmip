import type { ScoreCard, ScoresResponse } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { type Snapshot, describeChange, scoresAnnouncements } from './announce';

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  id: 'f1',
  home: 'Alpha',
  away: 'Beta',
  status: 'live',
  score: { home: 0, away: 0 },
  redCards: { home: 0, away: 0 },
  ...over,
});

const NO_SCORES: ScoreCard['scores'] = {
  current: null,
  half_time: null,
  full_time: null,
  extra_time: null,
  penalties: null,
  aggregate: null,
};

const card = (over: Partial<ScoreCard> = {}): ScoreCard =>
  ({
    id: 'f1',
    kickoff_at: '2025-01-05T16:30:00.000Z',
    status: 'live',
    minute: 10,
    home: { id: 'a', name: 'Alpha', short_name: null, code: null },
    away: { id: 'b', name: 'Beta', short_name: null, code: null },
    scores: { ...NO_SCORES, current: { home: 0, away: 0 } },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    ...over,
  }) as ScoreCard;

const response = (cards: ScoreCard[]): ScoresResponse =>
  ({
    pinned: [],
    groups: [{ competition: { id: 'c', name: 'C' }, country: null, fixtures: cards }],
    total: cards.length,
  }) as unknown as ScoresResponse;

describe('describeChange', () => {
  it('says nothing for a first snapshot or an unchanged one', () => {
    expect(describeChange(undefined, snap())).toEqual([]);
    expect(describeChange(snap(), snap())).toEqual([]);
  });

  it('announces a goal for the side whose total rose', () => {
    expect(describeChange(snap(), snap({ score: { home: 1, away: 0 } }))).toEqual([
      'Goal for Alpha: Alpha 1, Beta 0.',
    ]);
    expect(
      describeChange(snap({ score: { home: 1, away: 0 } }), snap({ score: { home: 1, away: 1 } })),
    ).toEqual(['Goal for Beta: Alpha 1, Beta 1.']);
  });

  it('announces kick-off, full time and a correction, and red cards', () => {
    expect(describeChange(snap({ status: 'scheduled', score: null }), snap())).toEqual([
      'Kick-off: Alpha 0, Beta 0.',
    ]);
    expect(
      describeChange(
        snap({ score: { home: 2, away: 1 } }),
        snap({ status: 'finished', score: { home: 2, away: 1 } }),
      ),
    ).toEqual(['Full time: Alpha 2, Beta 1.']);
    expect(
      describeChange(snap({ score: { home: 2, away: 0 } }), snap({ score: { home: 1, away: 0 } })),
    ).toEqual(['Score corrected: Alpha 1, Beta 0.']);
    expect(describeChange(snap(), snap({ redCards: { home: 0, away: 1 } }))).toEqual([
      'Red card for Beta.',
    ]);
  });
});

describe('scoresAnnouncements', () => {
  it('matches cards by id across snapshots and keeps list order', () => {
    const gamma = { id: 'c', name: 'Gamma', short_name: null, code: null } as ScoreCard['home'];
    const before = response([card(), card({ id: 'f2', home: gamma })]);
    const after = response([
      card({ scores: { ...NO_SCORES, current: { home: 1, away: 0 } } }),
      card({ id: 'f2', status: 'finished', home: gamma }),
    ]);
    expect(scoresAnnouncements(before, after)).toEqual([
      'Goal for Alpha: Alpha 1, Beta 0.',
      'Full time: Gamma 0, Beta 0.',
    ]);
  });
});
