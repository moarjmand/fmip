import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rules page in numbered sections (T-1789, D-410): the 1.0.0 text from
 * its migration, under eight headings with anchors and an "On this page"
 * index, English and left to right on every page; a version nobody checked
 * is plain blocks, as before. Rendered whole with the API mocked.
 */

const api = vi.hoisted(() => ({
  fetchPlatformRules: vi.fn(),
  fetchSession: vi.fn(),
}));
vi.mock('@/lib/api', () => api);
vi.mock('@/lib/session', () => ({ sessionCookieHeader: async () => undefined }));
vi.mock('@/lib/reader-time-zone-server', () => ({
  pageTimeZone: async () => ({ timeZone: 'Europe/London', chosen: false }),
}));
vi.mock('@/lib/rules-actions', () => ({ acceptRulesAction: async () => undefined }));

const { default: RulesPage, generateMetadata } = await import('./page');

const V1 = /\$rules\$([\s\S]*?)\$rules\$/.exec(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'migrations',
      '1765300000000_platform-rules-version.sql',
    ),
    'utf8',
  ),
)![1]!;

const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const draw = async (locale: string) =>
  renderToStaticMarkup(
    await RulesPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({}),
    }),
  );

const rules = (version: string) => ({
  ok: true,
  data: { version, body: V1, published_at: '2026-09-15T00:00:00Z' },
});

beforeEach(() => {
  api.fetchPlatformRules.mockResolvedValue(rules('platform-rules@1.0.0'));
  api.fetchSession.mockResolvedValue(null);
});

describe('the rules page (T-1789, D-410)', () => {
  it('shows 1.0.0 in eight numbered sections, each with its anchor', async () => {
    const html = await draw('en');
    const ids = [...html.matchAll(/data-testid="rules-section-([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
      'joining',
      'what-this-place-is-for',
      'what-is-not-allowed',
      'your-rating-is-earned-and-is-shown',
      'reports-and-decisions',
      'appeals',
      'leaving',
      'changes',
    ]);
    expect(html).toContain('<section id="joining"');
    expect(html).toMatch(/<h2 id="joining-heading"[^>]*><span[^>]*>1<\/span>Joining<\/h2>/);
    // The lead-in left its paragraph; the paragraph's own words follow.
    expect(html).toContain('<p>You need an e-mail address you can receive mail at,');
    expect(html).not.toContain('Joining. You need');
    // Text with no lead-in stays in Leaving.
    expect(html).toContain('<p>The deletion is recorded (who asked and when)');
  });

  it('has an index of the eight: beside the text from 1024px, a closed details below', async () => {
    const html = await draw('en');
    const side = html.slice(html.indexOf('data-testid="rules-index"'));
    expect(side.slice(0, side.indexOf('</nav>'))).toContain('href="#changes"');
    const phone = html.slice(html.indexOf('data-testid="rules-index-phone"'));
    expect(phone.slice(0, phone.indexOf('</details>')).match(/href="#/g)).toHaveLength(8);
    expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*data-testid="rules-index-phone"/);
    expect(html).toMatch(/<nav aria-label="On this page"/);
    expect(html).not.toMatch(PHYSICAL);
  });

  it('keeps the headings and the index English and left to right on the Persian page', async () => {
    const html = await draw('fa');
    expect(html).toContain('در این صفحه');
    expect(html).toMatch(/<article lang="en" dir="ltr"[^>]*data-testid="rules-body"/);
    expect(html).toMatch(/<ol lang="en" dir="ltr"/);
    expect(html).toContain('Your rating is earned and is shown</a>');
    expect(html).toContain('data-testid="rules-retention"');
  });

  it('shows a version nobody has checked as plain blocks, with no index', async () => {
    api.fetchPlatformRules.mockResolvedValue(rules('platform-rules@1.1.0'));
    const html = await draw('en');
    expect(html).not.toContain('rules-section-');
    expect(html).not.toContain('rules-index');
    expect(html).toContain('<p>Joining. You need an e-mail address');
  });
});

/** The plain words' own markup, up to the end of their section. */
const plainOf = (html: string): string => {
  const from = html.indexOf('data-testid="rules-plain"');
  return from === -1 ? '' : html.slice(from, html.indexOf('</section>', from));
};

describe('the community rules in plain words (T-1969, D-459)', () => {
  it('opens the page, above the text the member accepts, with exactly its three rules', async () => {
    const html = await draw('en');
    expect(html.indexOf('data-testid="rules-plain"')).toBeGreaterThan(
      html.indexOf('data-testid="title"'),
    );
    expect(html.indexOf('data-testid="rules-plain"')).toBeLessThan(
      html.indexOf('data-testid="rules-body"'),
    );
    expect(html.indexOf('data-testid="rules-plain"')).toBeLessThan(
      html.indexOf('data-testid="rules-version"'),
    );
    const plain = plainOf(html);
    expect(plain).toMatch(
      /<h2 id="in-plain-words-heading"[^>]*>Community rules, in plain words<\/h2>/,
    );
    expect(plain).toContain('is the platform rules below.');
    const list = plain.slice(plain.indexOf('data-testid="rules-plain-not-allowed"'));
    expect(list.slice(0, list.indexOf('</ul>')).match(/<li>/g)).toHaveLength(3);
    for (const rule of ['Spam and advertising.', 'Abuse and harassment.', 'Impersonation.']) {
      expect(plain).toContain(`<strong class="font-semibold">${rule}</strong>`);
    }
    // Where to report and to appeal, by the labels the controls show (T-1973):
    // `report.open`, `report.reason.other`, `restrictions.heading`,
    // `restrictions.appeal.submit`.
    expect(plain).toContain('use “Report” on their profile');
    expect(plain).toContain('If you choose “Something else”');
    expect(plain).toContain(
      '“Moderation decisions on your account” lists each decision with its own “Appeal” form',
    );
    // Nothing the policy does not say: no ranking of this page over the text,
    // no promise of who moderates, no "everything else is fine".
    expect(plain).not.toMatch(/prevail|win\b|moderators|Everything else/);
    expect(html).not.toMatch(PHYSICAL);
    // The member still accepts the text under it, and only that.
    expect(html).toContain('data-testid="rules-guest"');
  });

  it('is Persian on /fa, every string of it translated, the text below still English', async () => {
    const html = await draw('fa');
    const plain = plainOf(html);
    expect(html).toMatch(/data-testid="title">قوانین پلتفرم<\/h1>/);
    for (const words of [
      'قوانین جامعه، به زبان ساده',
      'سه چیز که مجاز نیست',
      'اسپم و تبلیغ.',
      'توهین و آزار.',
      'جعل هویت.',
      'امتیاز عملکرد',
      'از «گزارش» در نمایه‌ی او',
      'گزینه‌ی «مورد دیگر»',
      'بخش «تصمیم‌های نظارتی درباره‌ی حساب شما»',
      'فرم «درخواست تجدیدنظر»',
      '«عضو حذف‌شده»',
    ]) {
      expect(plain).toContain(words);
    }
    // The site's word for an appeal, from the groups to the restrictions
    // (T-1973), is «درخواست تجدیدنظر»; never a second one.
    expect(plain).not.toContain('اعتراض');
    expect(plain).not.toContain('data-translation="untranslated"');
    expect(plain).not.toContain('lang="en"');
    expect(html).toMatch(/<article lang="en" dir="ltr"[^>]*data-testid="rules-body"/);
  });

  it('is the English, marked, on a language with no translation of it', async () => {
    const plain = plainOf(await draw('de'));
    expect(plain).toContain('Community rules, in plain words');
    expect(plain).toContain('lang="en"');
  });

  it('is not shown beside a version it was not written for, nor when the text cannot be read', async () => {
    api.fetchPlatformRules.mockResolvedValue(rules('platform-rules@1.1.0'));
    expect(await draw('en')).not.toContain('rules-plain');
    api.fetchPlatformRules.mockResolvedValue({ ok: false });
    const html = await draw('fa');
    expect(html).not.toContain('rules-plain');
    expect(html).toContain('data-testid="rules-unreachable"');
  });

  it('gives the page a title, a description, a canonical and hreflang in en and fa, indexable', async () => {
    for (const [locale, title, description] of [
      ['en', 'Platform rules · Stadiomind', 'in plain words and in full'],
      ['fa', 'قوانین پلتفرم · Stadiomind', 'به زبان ساده و با متن کامل'],
    ] as const) {
      const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
      expect(meta.title).toBe(title);
      expect(String(meta.description)).toContain(description);
      expect(String(meta.alternates?.canonical)).toMatch(new RegExp(`/${locale}/rules$`));
      const languages = meta.alternates?.languages as Record<string, string>;
      expect(languages['en']).toMatch(/\/en\/rules$/);
      expect(languages['fa']).toMatch(/\/fa\/rules$/);
      expect(languages['x-default']).toMatch(/\/en\/rules$/);
      expect(meta.robots).toEqual({ index: true, follow: true });
    }
  });
});
