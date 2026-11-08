import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FirstStep } from '@/lib/first-steps';
import { floorProgress } from '@/lib/leaderboard';
import { FirstStepsCard, ProfileStateRow } from './first-steps';

/** A new member's profile (T-1787, D-390; board P7-6): the card, the bar and the state rows. */

const HREFS = {
  pick: '/en/scores?unpicked=1',
  follow: '/en/welcome?step=teams&next=%2Fen%2Fu%2Fnew_member',
  bio: '/en/settings',
};
const NONE_DONE: readonly FirstStep[] = [
  { id: 'pick', done: false },
  { id: 'follow', done: false },
  { id: 'bio', done: false },
];

const card = (locale: 'en' | 'fa', steps = NONE_DONE, progress = floorProgress(0, 30)) =>
  renderToStaticMarkup(
    <FirstStepsCard locale={locale} steps={steps} progress={progress} hrefs={HREFS} />,
  );

describe('Your first steps', () => {
  it('lists the three steps, each with its link, then the bar to the floor and how ratings work', () => {
    const html = card('en');
    expect(html).toContain('>Your first steps<');
    for (const words of ['Make your first pick', 'Follow a team', 'Add a short bio']) {
      expect(html).toContain(`>${words}<`);
    }
    const links = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [
      m[1]!.replace(/&amp;/g, '&'),
      m[2],
    ]);
    expect(links).toEqual([
      [HREFS.pick, 'Matches'],
      [HREFS.follow, 'Find a team'],
      [HREFS.bio, 'Settings'],
      ['/en/about#about-rating', 'How ratings work'],
    ]);
    expect(html).toContain('>Your settled picks<');
    expect(html).toContain('>0 of 30<');
    expect(html).toContain(
      'A rating can always be recomputed from your picks and the results alone.',
    );
  });

  it('gives each step a 48px row and each link a 44px target', () => {
    const html = card('en');
    expect(html.match(/<li class="flex min-h-12 /g)).toHaveLength(3);
    expect(html.match(/class="inline-flex min-h-touch[^"]*"/g)).toHaveLength(4);
  });

  it('ticks a done step with a mark and a word, never by colour alone', () => {
    const html = card('en', [
      { id: 'pick', done: true },
      { id: 'follow', done: false },
      { id: 'bio', done: false },
    ]);
    const pick = /<li[^>]*data-testid="first-step-pick"[\s\S]*?<\/li>/.exec(html)![0];
    const follow = /<li[^>]*data-testid="first-step-follow"[\s\S]*?<\/li>/.exec(html)![0];
    expect(pick).toContain('data-done=""');
    expect(pick).toContain('<path d="M3 7.5');
    expect(pick).toContain('<span class="sr-only"> · Done</span>');
    expect(follow).not.toContain('data-done');
    expect(follow).not.toContain('<path');
    expect(follow).not.toContain('Done');
  });

  it('leaves the bar out when the rating could not be read, rather than drawing an invented 0', () => {
    const html = renderToStaticMarkup(
      <FirstStepsCard locale="en" steps={NONE_DONE} progress={null} hrefs={HREFS} />,
    );
    expect(html).not.toContain('settled-progress');
    expect(html).toContain('How ratings work');
  });

  it('is in Persian on /fa, with the reader’s digits', () => {
    const html = card('fa', NONE_DONE, floorProgress(7, 30));
    for (const words of [
      'گام‌های نخست شما',
      'نخستین انتخاب خود را ثبت کنید',
      'تیمی را دنبال کنید',
      'یافتن تیم',
      'یک زندگی‌نامه‌ی کوتاه بنویسید',
      'پیش‌بینی‌های تسویه‌شده‌ی شما',
      '۷ از ۳۰',
      'امتیاز چگونه کار می‌کند',
    ]) {
      expect(html).toContain(words);
    }
  });
});

describe('an empty section', () => {
  it('is one folded 48px line with its heading and its state word on it, the reason behind it', () => {
    const html = renderToStaticMarkup(
      <ProfileStateRow
        locale="en"
        id="profile-rating"
        heading="profile.rating.heading"
        word="profile.state.notRated"
        testId="rating-none"
      >
        Why
      </ProfileStateRow>,
    );
    expect(html).toContain('data-folded=""');
    expect(html).toContain('data-testid="rating-none"');
    expect(html).toContain('aria-labelledby="profile-rating"');
    const summary = /<summary[\s\S]*?<\/summary>/.exec(html)![0];
    expect(summary).toContain(
      '<h2 id="profile-rating" class="text-base font-semibold">Performance Rating</h2>',
    );
    expect(summary).toContain('Not rated yet');
    expect(summary).not.toContain('Why');
    expect(html).toContain('Why');
  });

  it('says "None yet" in Persian too', () => {
    const html = renderToStaticMarkup(
      <ProfileStateRow
        locale="fa"
        id="profile-achievements"
        heading="achievements.title"
        word="profile.state.none"
        testId="achievements-none"
      >
        x
      </ProfileStateRow>,
    );
    expect(html).toContain('هنوز نیست');
    expect(html).toContain('دستاوردها');
  });
});

describe('the source', () => {
  it('uses logical properties only and adds no client code (rule 7, budgets)', () => {
    const source = readFileSync(join(__dirname, 'first-steps.tsx'), 'utf8');
    expect(source).not.toMatch(
      /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/,
    );
    expect(source).not.toMatch(/['"]use client['"]/);
    expect(source).not.toMatch(/\bwidth:/);
  });
});
