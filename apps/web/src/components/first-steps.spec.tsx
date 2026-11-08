import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type FirstStep, settledProgress } from '@/lib/first-steps';
import { FirstStepsCard, ProfileStateRow, SettledProgressBar } from './first-steps';

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

const card = (locale: 'en' | 'fa', steps = NONE_DONE, progress = settledProgress(0, 30)) =>
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
    const html = card('fa', NONE_DONE, settledProgress(7, 30));
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

describe('the bar to the floor', () => {
  const bar = (count: number, floor: number, locale: 'en' | 'fa' = 'en') =>
    renderToStaticMarkup(
      <SettledProgressBar
        locale={locale}
        progress={settledProgress(count, floor)}
        label="profile.progress.visitor"
        note="profile.progress.provisional"
      />,
    );

  it('says the count and the floor it was given in words, and fills from the inline start', () => {
    const html = bar(7, 30);
    expect(html).toContain('>Settled picks<');
    expect(html).toContain('>7 of 30<');
    expect(html).toContain('style="inline-size:23%"');
    expect(html).toContain('Provisional until 30 settled picks. It joins the leaderboard from 30.');
    // Another floor is another number: nothing here is typed.
    expect(bar(12, 40)).toContain('>12 of 40<');
    expect(bar(12, 40)).toContain('Provisional until 40 settled picks.');
  });

  it('hides the picture from a screen reader: the words carry the number', () => {
    expect(bar(7, 30)).toMatch(/<span aria-hidden="true" class="block h-2 /);
  });

  it('is the community’s amber, never the model’s colour (rule 6)', () => {
    const html = bar(7, 30);
    expect(html).toContain('bg-brand');
    expect(html).not.toMatch(/\b(?:bg|text|border)-model\b/);
  });

  it('is in Persian with Persian digits', () => {
    const html = bar(7, 30, 'fa');
    expect(html).toContain('۷ از ۳۰');
    expect(html).toContain('تا ۳۰ پیش‌بینی تسویه‌شده موقت است.');
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
