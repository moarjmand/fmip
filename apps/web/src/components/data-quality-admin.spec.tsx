import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DataQualityFinding, DataQualityReport } from '@fmip/contracts';
import { DATA_QUALITY_CHECKS } from '@fmip/contracts';

vi.mock('@/lib/data-quality-actions', () => ({
  reviewFindingAction: vi.fn(),
  reviewBatchAction: vi.fn(),
  refetchAction: vi.fn(),
}));
const { CHECK_LABEL, DataQualityAdmin } = await import('./data-quality-admin');

/** The data-quality page (T-821): open findings by check and competition, linked, reviewable. */
const HERE = __dirname;
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'data-quality-actions.ts'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'data-quality', 'page.tsx'),
  'utf8',
);
const ADMIN = readFileSync(join(HERE, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');

const NOW = '2026-09-28T12:00:00.000Z';
const PL = { id: 'c-1', name: 'Premier League' };
const finding = (over: Partial<DataQualityFinding>): DataQualityFinding => ({
  id: 1,
  check: 'goals_disagree',
  detail: 'the timeline has 1-1, the score is 2-1',
  competition: PL,
  season: { id: 's-1', label: '2026-27' },
  fixture: {
    id: 'f-1',
    home: 'Liverpool',
    away: 'Manchester United',
    kickoff_at: '2026-09-28T11:30:00.000Z',
    status: 'live',
  },
  related_fixture: null,
  team: null,
  first_seen_at: NOW,
  last_seen_at: NOW,
  reviewed: null,
  asked_again: null,
  ...over,
});
const report = (over: Partial<DataQualityReport> = {}): DataQualityReport => ({
  generated_at: NOW,
  checks: DATA_QUALITY_CHECKS.map((check) => ({
    check,
    checked_at: NOW,
    freshness: 'current' as const,
    open: 0,
  })),
  counts: [
    {
      competition: PL,
      season: { id: 's-1', label: '2026-27' },
      check: 'goals_disagree',
      open: 2,
      reviewed: 1,
    },
    {
      competition: PL,
      season: { id: 's-1', label: '2026-27' },
      check: 'lineup_not_eleven',
      open: 3,
      reviewed: 3,
    },
  ],
  findings: [
    finding({}),
    finding({
      id: 2,
      check: 'lineup_not_eleven',
      detail: 'the away line-up has 10 starters',
      team: { id: 't-9', name: 'Manchester United' },
      reviewed: { at: NOW, by: 'root', reason: 'Asked the provider.' },
    }),
  ],
  open_total: 2,
  resolved_last_day: 4,
  refetch: { pending: 3, fetched_today: 7 },
  ...over,
});
const html = (r: DataQualityReport | null) =>
  renderToStaticMarkup(<DataQualityAdmin locale="en" report={r} />);

describe('the data-quality page', () => {
  it('names every check in words', () => {
    for (const check of DATA_QUALITY_CHECKS) expect(CHECK_LABEL[check]).not.toBe('');
  });

  it('lists findings by check with links to the match and the team, and counts by competition', () => {
    const out = html(report());
    expect(out).toContain('href="/en/match/f-1"');
    expect(out).toContain('href="/en/team/t-9"');
    expect(out).toContain('href="/en/competition/c-1"');
    expect(out).toContain('the timeline has 1-1, the score is 2-1');
    expect(out).toContain('Goals in the timeline disagree with the score (1)');
    expect(out).toContain('2 open, 1 reviewed');
    expect(out).toContain('4 resolved in the last day');
  });

  it('offers a review with a reason only where none was made, and shows the one made', () => {
    const out = html(report());
    expect(out).toContain('data-testid="finding-review-1"');
    expect(out).not.toContain('data-testid="finding-review-2"');
    expect(out).toContain('Reviewed by root');
    expect(out).toContain('Asked the provider.');
    expect(ACTIONS).toContain('/review`');
    expect(ACTIONS).toContain("reason === ''");
  });

  it('offers a batch review per check and season only where some are still waiting', () => {
    const out = html(report());
    expect(out).toContain('Premier League 2026-27 · Goals in the timeline disagree with the score');
    expect(out).toContain('data-testid="batch-review-goals_disagree-s-1"');
    expect(out).toContain('Review all 1 with one reason');
    // Every lineup finding of that season is reviewed already: nothing to batch.
    expect(out).not.toContain('data-testid="batch-review-lineup_not_eleven-s-1"');
    expect(ACTIONS).toContain("'/admin/data-quality/review-batch'");
    expect(ACTIONS).toContain('season_id: seasonId');
  });

  it('asks the feed again for a match or a class, and says what the last ask found', () => {
    const out = html(
      report({
        findings: [
          finding({}),
          finding({
            id: 3,
            asked_again: {
              requested_at: '2026-09-28T10:00:00.000Z',
              fetched_at: '2026-09-28T10:30:00.000Z',
              changed: false,
            },
          }),
          finding({
            id: 4,
            asked_again: { requested_at: NOW, fetched_at: null, changed: null },
          }),
        ],
      }),
    );
    expect(out).toContain('data-testid="finding-refetch-1"');
    expect(out).toContain('Asked again on <time');
    expect(out).toContain('2026-09-28 10:30 UTC</time>, unchanged.');
    expect(out).toContain('waiting for the feed.');
    // Not offered twice while an ask is waiting.
    expect(out).not.toContain('data-testid="finding-refetch-4"');
    expect(out).toContain('data-testid="batch-refetch-goals_disagree-s-1"');
    expect(out).toContain('3 matches waiting to be');
    expect(out).toContain('7 asked since 00:00 UTC');
    expect(ACTIONS).toContain("'/admin/data-quality/refetch'");
  });

  it('says a check not run lately, rather than showing no findings as a clean bill', () => {
    const stale = report({
      checks: report().checks.map((c) =>
        c.check === 'live_overrun'
          ? { ...c, freshness: 'stale' as const, checked_at: '2026-09-28T09:00:00.000Z' }
          : c,
      ),
      findings: [],
      counts: [],
      open_total: 0,
    });
    const out = html(stale);
    expect(out).toContain('data-testid="data-quality-not-current"');
    expect(out).toContain('Still live long after kick-off (last run 2026-09-28 09:00 UTC)');
    expect(html(report())).not.toContain('data-quality-not-current');
  });

  it('says an outage and a refusal, never an empty list for either', () => {
    expect(html(null)).toContain('data-testid="data-quality-unreachable"');
    expect(PAGE).toContain('data-testid="data-quality-forbidden"');
    expect(PAGE).not.toMatch(/hasRole/);
  });

  it('is linked from the administration area, and uses logical properties only', () => {
    expect(ADMIN).toContain('/admin/data-quality`');
    const system = readFileSync(
      join(HERE, '..', 'app', '[locale]', 'admin', 'system', 'page.tsx'),
      'utf8',
    );
    expect(system).toContain('/admin/data-quality`');
    const view = readFileSync(join(HERE, 'data-quality-admin.tsx'), 'utf8');
    expect(view).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});
