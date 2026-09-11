import type { Prediction, PredictionHistoryFixture, PredictionVersion } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_PAGE_SIZE,
  fixtureLabel,
  formatSubmitted,
  historyPageCount,
  historyQuery,
  readHistoryPage,
  settlementLabel,
  versionLabel,
} from './prediction-history';

const version = (over: Partial<PredictionVersion> = {}): PredictionVersion => ({
  id: 'v1',
  version_number: 1,
  outcome: 'home',
  score: null,
  confidence: 3,
  reason_tags: [],
  explanation: null,
  submitted_at: '2025-01-05T16:28:00.000Z',
  ...over,
});

const prediction = (over: Partial<Prediction> = {}): Prediction => ({
  id: 'p1',
  fixture_id: 'f1',
  locks_at: '2025-01-05T16:30:00.000Z',
  locked: true,
  latest: version(),
  versions: [version()],
  settlement: null,
  ...over,
});

const settlement = (over: Partial<NonNullable<Prediction['settlement']>> = {}) => ({
  id: 's1',
  status: 'settled' as const,
  void_reason: null,
  actual: { home: 2, away: 1 },
  outcome_correct: true,
  score_predicted: false,
  score_correct: null,
  confidence: 3,
  settled_at: '2025-01-05T18:30:00.000Z',
  version_number: 1,
  ...over,
});

const fixture = (over: Partial<PredictionHistoryFixture> = {}): PredictionHistoryFixture => ({
  id: 'f1',
  kickoff_at: '2025-01-05T16:30:00.000Z',
  status: 'finished',
  competition: { id: 'c1', name: 'Premier League' },
  home: { id: 'h', name: 'Test Home', short_name: null },
  away: { id: 'a', name: 'Test Away', short_name: 'AWY' },
  score: { home: 2, away: 1 },
  ...over,
});

describe('paging', () => {
  it('reads the page, defaulting to one', () => {
    expect(readHistoryPage({})).toBe(1);
    expect(readHistoryPage({ page: '3' })).toBe(3);
    expect(readHistoryPage({ page: ['2', '5'] })).toBe(2);
    expect(readHistoryPage({ page: '0' })).toBe(1);
    expect(readHistoryPage({ page: 'x' })).toBe(1);
  });

  it('turns a page into the API query and counts pages', () => {
    expect(historyQuery(1)).toBe(`limit=${HISTORY_PAGE_SIZE}&offset=0`);
    expect(historyQuery(3)).toBe(`limit=${HISTORY_PAGE_SIZE}&offset=${2 * HISTORY_PAGE_SIZE}`);
    expect(historyPageCount(0)).toBe(1);
    expect(historyPageCount(HISTORY_PAGE_SIZE + 1)).toBe(2);
  });
});

describe('labels', () => {
  it('reads a version as submitted', () => {
    expect(versionLabel(version())).toBe('Home win · confidence 3/5');
    expect(
      versionLabel(version({ outcome: 'away', score: { home: 0, away: 2 }, confidence: 5 })),
    ).toBe('Away win 0–2 · confidence 5/5');
  });

  it('formats the submission time in the viewer zone', () => {
    expect(formatSubmitted('2025-01-05T16:28:00.000Z', 'Asia/Tehran')).toBe('05 Jan 2025, 19:58');
  });

  it('says how the prediction stands', () => {
    expect(settlementLabel(prediction({ locked: false }))).toEqual({
      text: 'Open until kick-off',
      tone: 'open',
    });
    expect(settlementLabel(prediction())).toEqual({ text: 'Awaiting result', tone: 'pending' });
    expect(settlementLabel(prediction({ settlement: settlement() }))).toEqual({
      text: 'Correct outcome',
      tone: 'correct',
    });
    expect(
      settlementLabel(
        prediction({ settlement: settlement({ score_predicted: true, score_correct: true }) }),
      ),
    ).toEqual({ text: 'Exact score', tone: 'correct' });
    expect(
      settlementLabel(prediction({ settlement: settlement({ outcome_correct: false }) })),
    ).toEqual({ text: 'Wrong outcome', tone: 'wrong' });
    expect(
      settlementLabel(
        prediction({
          settlement: settlement({
            status: 'void',
            void_reason: 'postponed',
            actual: null,
            outcome_correct: null,
          }),
        }),
      ),
    ).toEqual({ text: 'Void — match postponed', tone: 'void' });
  });

  it('names the fixture with the score once there is one', () => {
    expect(fixtureLabel(fixture())).toBe('Test Home 2–1 AWY');
    expect(fixtureLabel(fixture({ score: null, status: 'scheduled' }))).toBe('Test Home v AWY');
  });
});
