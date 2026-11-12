import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ABOUT_RATING_ANCHOR, floorProgress } from '@/lib/leaderboard';
import { HowRatingsWork, SettledProgressBar } from './settled-progress';

/**
 * The bar to the floor (D-388, D-390): one helper and one component for the
 * leaderboard's card and the member profile.
 */

describe('floorProgress', () => {
  it('counts the settled picks against the floor it is given, never a typed one', () => {
    expect(floorProgress(0, 30)).toEqual({ count: 0, floor: 30, percent: 0 });
    expect(floorProgress(7, 30)).toEqual({ count: 7, floor: 30, percent: 23 });
    expect(floorProgress(12, 40)).toEqual({ count: 12, floor: 40, percent: 30 });
    expect(floorProgress(29, 30)?.percent).toBe(96);
    expect(floorProgress(-1, 30)?.count).toBe(0);
  });

  it('is drawn below the floor and not from it: no "34 of 30", no "100 of 30"', () => {
    expect(floorProgress(30, 30)).toBeNull();
    expect(floorProgress(34, 30)).toBeNull();
    expect(floorProgress(100, 30)).toBeNull();
    expect(floorProgress(30, 50)).not.toBeNull();
  });

  it('draws nothing without a floor rather than a full bar over "0 of"', () => {
    expect(floorProgress(0, 0)).toBeNull();
    expect(floorProgress(0, undefined as unknown as number)).toBeNull();
  });
});

describe('the bar', () => {
  const bar = (count: number, floor: number, locale = 'en', own = false) =>
    renderToStaticMarkup(
      <SettledProgressBar
        locale={locale}
        own={own}
        progress={floorProgress(count, floor)!}
        note="Under it"
      />,
    );

  it('says the count and the floor in words and fills from the inline start', () => {
    const html = bar(7, 30);
    expect(html).toContain('>Settled picks<');
    expect(html).toContain('>7 of 30<');
    expect(html).toContain('style="inline-size:23%"');
    expect(html).toContain('data-testid="settled-progress-note">Under it<');
    expect(bar(12, 40)).toContain('>12 of 40<');
    expect(bar(0, 30, 'en', true)).toContain('>Your settled picks<');
  });

  it('shows a guest the goal alone over a dashed outline, never a count', () => {
    const html = renderToStaticMarkup(<SettledProgressBar locale="en" own={false} goal={30} />);
    expect(html).toMatch(/data-testid="settled-progress-count">30</);
    expect(html).not.toContain(' of 30');
    expect(html).toContain('data-goal=""');
    expect(html).toContain('border-dashed');
    expect(html).not.toContain('settled-progress-fill');
    expect(html).not.toContain('settled-progress-note');
  });

  it('hides the picture from a screen reader: the words carry the number', () => {
    expect(bar(7, 30)).toMatch(/<span aria-hidden="true" class="block h-2 /);
  });

  it('is the community’s accent amber, never the model’s colour (rule 6)', () => {
    const html = bar(7, 30);
    expect(html).toContain('bg-accent');
    expect(html).not.toMatch(/\b(?:bg|text|border)-model\b/);
  });

  it('is in Persian with Persian digits', () => {
    expect(bar(7, 30, 'fa')).toContain('۷ از ۳۰');
    expect(bar(7, 30, 'fa')).toContain('پیش‌بینی‌های تسویه‌شده');
  });
});

describe('How ratings work', () => {
  it('leads to the About page’s rating step by its shared id', () => {
    const html = renderToStaticMarkup(<HowRatingsWork locale="fa" testId="x" />);
    expect(html).toContain(`href="/fa/about#${ABOUT_RATING_ANCHOR}"`);
    expect(html).toContain('امتیاز چگونه کار می‌کند');
    expect(html).toContain('min-h-touch');
  });
});

describe('the source', () => {
  it('uses logical properties only, no literal anchor and no client code', () => {
    const source = readFileSync(join(__dirname, 'settled-progress.tsx'), 'utf8');
    expect(source).not.toMatch(
      /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/,
    );
    expect(source).not.toMatch(/['"]use client['"]/);
    expect(source).not.toMatch(/\bwidth:/);
    expect(source).not.toContain('#about-rating');
  });
});
