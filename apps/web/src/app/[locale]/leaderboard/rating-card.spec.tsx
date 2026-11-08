import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rating, RatingResponse } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ABOUT_RATING_ANCHOR,
  type LeaderboardPageQuery,
  type RatingCardViewer,
  activeFilterCount,
  boardNarrowed,
  ratingCardViewer,
  ratingProgress,
  ratingSteps,
} from '@/lib/leaderboard';
import { RatingCard } from './rating-card';

/**
 * "How a rating is earned" and the folded filters (T-1783, T-1784, D-388;
 * boards P7-2 and P7-3): the card says only what is true of whoever looks,
 * its threshold is the API's floor, and the filters fold into one line.
 */

const RATING: Rating = {
  username: 'ana',
  rating: 61.4,
  tier: 'gold',
  provisional: false,
  established: false,
  settled_count: 34,
  components: { result: 0.6, exact_score: 0.2, consistency: 0.7, confidence: 0.5 },
  formula_version: 'performance-rating@1.0.0',
  computed_at: '2026-11-08T10:00:00.000Z',
};
const withCount = (settled_count: number): RatingResponse => ({
  username: 'ana',
  rating: { ...RATING, settled_count, provisional: settled_count < 30 },
});
const VERIFIED = { email_verified: true };

const DEFAULT: LeaderboardPageQuery = {
  min: null,
  page: 1,
  scope: 'everyone',
  period: 'all',
  month: null,
  season: null,
  competition: null,
  language: null,
};

const render = (viewer: RatingCardViewer, locale = 'en', floor = 30): string =>
  renderToStaticMarkup(<RatingCard locale={locale} floor={floor} viewer={viewer} />);

describe('who is looking (T-1784)', () => {
  it('reads nothing about a guest, or a member whose rating could not be read', () => {
    expect(ratingCardViewer(null, null, 30)).toEqual({ kind: 'guest' });
    expect(ratingCardViewer(VERIFIED, null, 30)).toEqual({ kind: 'guest' });
  });

  it("counts a member's own settled picks, 0 while the rating is null", () => {
    expect(ratingCardViewer(VERIFIED, { username: 'ana', rating: null }, 30)).toEqual({
      kind: 'member',
      settled: 0,
    });
    expect(ratingCardViewer(VERIFIED, withCount(7), 30)).toEqual({ kind: 'member', settled: 7 });
  });

  it('puts a member whose e-mail is not confirmed apart, rated or not', () => {
    expect(ratingCardViewer({ email_verified: false }, withCount(0), 30)).toEqual({
      kind: 'unconfirmed',
      settled: 0,
    });
    expect(ratingCardViewer({ email_verified: false }, withCount(40), 30).kind).toBe('unconfirmed');
  });

  it('is on the board from the floor, whatever the floor is', () => {
    expect(ratingCardViewer(VERIFIED, withCount(30), 30).kind).toBe('rated');
    expect(ratingCardViewer(VERIFIED, withCount(30), 50).kind).toBe('member');
  });

  it('marks the steps from what is known, and fills the bar to the floor', () => {
    expect(ratingSteps({ kind: 'guest' })).toEqual(['current', 'todo', 'todo']);
    expect(ratingSteps({ kind: 'member', settled: 0 })).toEqual(['current', 'todo', 'todo']);
    expect(ratingSteps({ kind: 'member', settled: 7 })).toEqual(['done', 'done', 'current']);
    expect(ratingSteps({ kind: 'rated', username: 'ana', rating: RATING })).toEqual([
      'done',
      'done',
      'done',
    ]);
    expect(ratingProgress(0, 30)).toBe(0);
    expect(ratingProgress(7, 30)).toBe(23);
    expect(ratingProgress(45, 30)).toBe(100);
  });
});

describe('the card', () => {
  it('shows a guest the goal and the rule, never a count of their own', () => {
    const html = render({ kind: 'guest' });
    expect(html).toContain('data-viewer="guest"');
    expect(html).toContain('How a rating is earned');
    expect(html).toContain('Pick before kick-off');
    expect(html).toContain('Reach 30 settled picks and you join the board');
    expect(html).toContain('Settled picks');
    expect(html).toMatch(/data-testid="rating-count">30</);
    expect(html).not.toContain(' of 30');
    expect(html).toContain('data-goal=""');
    expect(html).toContain('border-dashed');
    expect(html).toContain(
      'Below 30 your rating is provisional. It can always be recomputed from your picks and the results alone.',
    );
    expect(html).toContain('data-testid="leaderboard-picks-cta"');
    expect(html).toContain(`href="/en/about#${ABOUT_RATING_ANCHOR}"`);
    expect(html).toContain('How ratings work');
  });

  it('takes its threshold from the floor, not from a catalogue string', () => {
    const html = render({ kind: 'member', settled: 4 }, 'en', 25);
    expect(html).toContain('Reach 25 settled picks and you join the board');
    expect(html).toContain('4 of 25');
    expect(html).toContain('Your rating is provisional until 25');
    expect(html).not.toContain('30');
  });

  it('shows a member their own count, and only what is true of it', () => {
    const none = render({ kind: 'member', settled: 0 });
    expect(none).toContain('Your settled picks');
    expect(none).toContain('0 of 30');
    expect(none).toContain('Nothing settled yet. The count starts with your first settled pick.');
    expect(none).toContain('style="inline-size:0%"');
    const some = render({ kind: 'member', settled: 7 });
    expect(some).toContain('7 of 30');
    expect(some).toContain('style="inline-size:23%"');
    expect(some).toContain('can always be recomputed from your picks and the results alone');
    // No count of picks waiting for results: it could not be stated truly.
    expect(some).not.toMatch(/waiting/i);
  });

  it('tells a member whose e-mail is not confirmed the D-361 rule, with no button', () => {
    const html = render({ kind: 'unconfirmed', settled: 0 });
    expect(html).toContain(
      'Picks made before you confirm your e-mail count only if you confirm it before kick-off.',
    );
    expect(html).not.toContain('leaderboard-picks-cta');
    expect(html).not.toMatch(/pending/i);
    expect(html).toContain('How ratings work');
  });

  it('gives a member on the board a one-line result and folds the card', () => {
    const html = render({ kind: 'rated', username: 'ana', rating: RATING });
    expect(html).toContain('data-viewer="rated"');
    expect(html).toContain('61.4');
    expect(html).toContain('Your rating');
    expect(html).toContain('Gold · 34 settled · Building');
    expect(html).toContain('href="/en/u/ana"');
    expect(html).toMatch(
      /<details class="group[^"]*" data-testid="rating-fold"><summary class="[^"]*min-h-12/,
    );
    expect(html).not.toContain('<details open');
    expect(html).not.toContain('data-testid="rating-progress"');
  });

  it('marks each step by fill and a tick, never colour alone', () => {
    const html = render({ kind: 'member', settled: 7 });
    expect(html.match(/data-state="done"/g)).toHaveLength(2);
    expect(html).toContain('aria-current="step"');
    expect(html.match(/<span class="sr-only">done<\/span>/g)).toHaveLength(2);
    expect(html).toContain('bg-accent text-on-accent');
    expect(html).toMatch(/<path d="m5 12.5 4.5 4.5L19 7.5"/);
  });

  it("is the community's: amber, never the model's colour (rule 6)", () => {
    for (const viewer of [
      { kind: 'guest' },
      { kind: 'member', settled: 7 },
      { kind: 'rated', username: 'ana', rating: RATING },
    ] as RatingCardViewer[]) {
      const html = render(viewer);
      expect(html).not.toMatch(/-model\b|model-/);
      expect(html).not.toMatch(/\b(left|right)-|\b[mp][lr]-\d|text-(left|right)/);
    }
  });

  it('is Persian in Persian, digits and all', () => {
    const html = render({ kind: 'member', settled: 7 }, 'fa');
    expect(html).toContain('امتیاز چگونه به دست می‌آید');
    expect(html).toContain('۷ از ۳۰');
    expect(html).toContain('به ۳۰ پیش‌بینی تسویه‌شده برسید تا وارد جدول شوید');
    expect(html).toContain('href="/fa/about#about-rating"');
    expect(html).not.toContain('lang="en"');
    const guest = render({ kind: 'guest' }, 'fa');
    expect(guest).toContain('زیر ۳۰ پیش‌بینی، امتیاز موقت است.');
    expect(guest).not.toContain('lang="en"');
  });
});

describe('the folded filters (T-1783)', () => {
  it('counts the filters that narrow the board', () => {
    expect(activeFilterCount(DEFAULT, 30)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT, min: 30 }, 30)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT, min: 50 }, 30)).toBe(1);
    expect(activeFilterCount({ ...DEFAULT, min: 30 }, null)).toBe(1);
    expect(
      activeFilterCount(
        { ...DEFAULT, scope: 'friends', period: 'month', language: 'fa', competition: 'x' },
        30,
      ),
    ).toBe(4);
  });

  it('keeps the explainer outside the line whenever the board is narrowed', () => {
    const board = {
      scope: 'everyone' as const,
      period: { kind: 'all' as const },
      competition: null,
      language: null,
    };
    expect(boardNarrowed(board)).toBe(false);
    expect(boardNarrowed({ ...board, scope: 'friends' })).toBe(true);
    expect(boardNarrowed({ ...board, language: 'fa' })).toBe(true);
    expect(boardNarrowed({ ...board, competition: { id: 'x', name: 'Cup' } })).toBe(true);
  });

  const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
  const css = readFileSync(join(__dirname, '..', '..', 'globals.css'), 'utf8');

  it('is one native details, standing open only from 640px once the board has rows', () => {
    expect(page).toContain('data-testid="leaderboard-filters"');
    expect(page).not.toMatch(/<details[^>]*\bopen\b/);
    expect(page).toContain('const standOpen = result.ok && result.data.entries.length > 0;');
    expect(page).toContain("board-filters group${standOpen ? ' board-filters--stand' : ''}");
    expect(page).toContain('min-h-12');
    expect(css).toMatch(
      /@media \(width >= 40rem\) \{\s*@supports selector\(::details-content\) \{\s*\.board-filters--stand,/,
    );
    expect(css).toMatch(/\.board-filters--stand > summary \{\s*display: none;/);
  });

  it('opens with the card, and drops the pager under an empty board', () => {
    expect(page.indexOf('<RatingCard')).toBeLessThan(
      page.indexOf('data-testid="leaderboard-filters"'),
    );
    expect(page).toContain('(result.data.entries.length > 0 || q.page > 1) && (');
    expect(page).toContain('fetchMyRating(cookie)');
  });
});
