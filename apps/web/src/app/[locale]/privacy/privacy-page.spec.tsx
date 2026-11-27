import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as NextServer from 'next/server';

/**
 * The privacy notice (T-1969, D-465): shown only when the server names its
 * controller and mailbox, otherwise an honest "being prepared"; never
 * indexed during the private trial; English and Persian written, every
 * other language the English marked; the draft says it is a draft, and
 * what the draft leaves open says "not yet confirmed". Rendered whole, with
 * the environment stubbed.
 */

// `connection()` needs a request; the spec renders without one.
vi.mock('next/server', async (original) => ({
  ...(await original<typeof NextServer>()),
  connection: async () => undefined,
}));

const api = vi.hoisted(() => ({ fetchCompetitions: vi.fn(), fetchTeams: vi.fn() }));
vi.mock('@/lib/api', () => api);

const { default: PrivacyPage, generateMetadata } = await import('./page');
const { default: sitemap } = await import('../../sitemap');

const NAME = 'Test Controller';
const MAILBOX = 'privacy@example.test';

const draw = async (locale: string) =>
  renderToStaticMarkup(await PrivacyPage({ params: Promise.resolve({ locale }) }));

const configure = (extra: Record<string, string> = {}) => {
  vi.stubEnv('PRIVACY_CONTROLLER_NAME', NAME);
  vi.stubEnv('SITE_CONTACT_EMAIL', MAILBOX);
  for (const [name, value] of Object.entries(extra)) vi.stubEnv(name, value);
};

/** The physical left and right this layout must never use (rule 7). */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://stadiomind.example');
  vi.stubEnv('DEMONSTRATION_DATA', 'off');
  vi.stubEnv('PRIVACY_CONTROLLER_NAME', '');
  vi.stubEnv('SITE_CONTACT_EMAIL', '');
  vi.stubEnv('PRIVACY_POSTAL_ADDRESS', '');
  vi.stubEnv('PRIVACY_ICO_NUMBER', '');
  api.fetchCompetitions.mockResolvedValue([]);
  api.fetchTeams.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('the privacy notice, not configured', () => {
  it.each([
    ['en', 'The privacy notice is being prepared. It is not published yet.'],
    ['fa', 'اطلاعیه‌ی حریم خصوصی در حال آماده شدن است و هنوز منتشر نشده است.'],
  ])(
    'says it is being prepared on /%s, and shows nothing that could pass for one',
    async (locale, words) => {
      const html = await draw(locale);
      expect(html).toContain('data-testid="privacy-preparing"');
      expect(html).toContain(words);
      expect(html).not.toContain('data-testid="privacy-body"');
      expect(html).not.toContain('data-testid="privacy-draft"');
      expect(html).not.toContain('mailto:');
    },
  );

  it('is so when only one of the two is set', async () => {
    vi.stubEnv('PRIVACY_CONTROLLER_NAME', NAME);
    expect(await draw('en')).toContain('data-testid="privacy-preparing"');
    vi.stubEnv('PRIVACY_CONTROLLER_NAME', '');
    vi.stubEnv('SITE_CONTACT_EMAIL', MAILBOX);
    expect(await draw('en')).toContain('data-testid="privacy-preparing"');
  });
});

describe('the privacy notice, configured', () => {
  beforeEach(() => configure());

  it('names the controller and his mailbox from the server, twice and at every contact', async () => {
    const html = await draw('en');
    expect(html).not.toContain('data-testid="privacy-preparing"');
    expect(html).toContain(
      `Stadiomind is run by <bdi class="font-semibold">${NAME}</bdi>, an individual who lives in the United Kingdom, during a private test with invited members`,
    );
    expect(html.match(new RegExp(`>${NAME}<`, 'g'))).toHaveLength(2);
    // Contact, the people we write about, access, rectify, complain, children.
    expect(html.match(new RegExp(`href="mailto:${MAILBOX}"`, 'g'))).toHaveLength(6);
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it('has the thirteen sections of the draft, numbered, the third in seven parts', async () => {
    const html = await draw('en');
    const ids = [...html.matchAll(/data-testid="privacy-section-([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
      'who-we-are',
      'short-version',
      'what-we-collect',
      'what-is-public',
      'sharing',
      'cookies',
      'transfers',
      'retention',
      'rights',
      'complaints',
      'children',
      'security',
      'changes',
    ]);
    expect(html).toMatch(
      /<h2 id="cookies-heading"[^>]*><span[^>]*>6<\/span>Cookies and similar technologies<\/h2>/,
    );
    expect(html).toMatch(
      /<h3 id="language-models-heading"[^>]*><span[^>]*>3\.5<\/span>Language-model features<\/h3>/,
    );
    // The index leads to every section.
    for (const id of ids) expect(html).toContain(`href="#${id}"`);
  });

  it('draws each table of the draft as cards: the cookie names as code, every row present', async () => {
    const html = await draw('en');
    const rows = (id: string) => {
      const start = html.indexOf(`data-testid="privacy-rows-${id}"`);
      return html.slice(start, html.indexOf('</ul>', start)).match(/<li /g)?.length ?? 0;
    };
    expect(rows('visitors')).toBe(4);
    expect(rows('members')).toBe(22);
    expect(rows('language-models')).toBe(4);
    expect(rows('processors')).toBe(7);
    expect(rows('cookies')).toBe(8);
    expect(rows('retention')).toBe(16);
    for (const name of ['fmip_session', 'fmip_first_run', 'fmip_text_size', 'fmip_console']) {
      expect(html).toContain(`<code dir="ltr" class="font-mono text-[0.9em]">${name}</code>`);
    }
    expect(html).toContain('<dt class="text-muted">Lawful basis</dt>');
  });

  it('says it is a draft, not in effect, and marks what the draft leaves open', async () => {
    const html = await draw('en');
    expect(html).toContain('data-testid="privacy-draft"');
    expect(html).toContain('<bdi dir="ltr">0.4</bdi>');
    expect(html).not.toContain('data-testid="privacy-in-effect"');
    // The draft line itself, then: campaigns' basis, the backup region, the
    // e-mail service and where it is, the access logs, the minimum age.
    expect(html.match(/data-pending=""/g)).toHaveLength(7);
    expect(html).toContain('not yet confirmed');
  });

  it('leaves the postal address and the ICO number out until they are set', async () => {
    let html = await draw('en');
    expect(html).not.toContain('data-testid="privacy-postal"');
    expect(html).not.toContain('data-testid="privacy-ico"');
    configure({ PRIVACY_POSTAL_ADDRESS: 'PO Box 1, Testtown', PRIVACY_ICO_NUMBER: 'ZA000000' });
    html = await draw('en');
    expect(html).toContain('Postal address: <bdi>PO Box 1, Testtown</bdi>');
    expect(html).toContain('ICO registration number: <bdi dir="ltr">ZA000000</bdi>');
  });

  it('is in Persian on /fa, every word written, the name and the mailbox isolated', async () => {
    const html = await draw('fa');
    expect(html).toContain('>اطلاعیه‌ی حریم خصوصی</');
    expect(html).toContain(
      'Stadiomind را <bdi class="font-semibold">Test Controller</bdi>، فردی که در بریتانیا زندگی می‌کند',
    );
    expect(html).toContain(
      `<a href="mailto:${MAILBOX}" dir="ltr" class="underline">${MAILBOX}</a>`,
    );
    expect(html).toContain('<bdi dir="ltr">0303 123 1113</bdi>');
    expect(html).toContain('>۱۳</span>');
    expect(html).toContain('>۳.۵</span>');
    expect(html).toContain('هنوز تأیید نشده');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('is the English, marked, in a language with no translation yet', async () => {
    const html = await draw('de');
    expect(html).toContain('data-translation="untranslated"');
    expect(html).toContain('lang="en" dir="ltr" data-translation="untranslated">Who we are');
  });

  it('uses no physical left or right (rule 7)', async () => {
    const html = await draw('fa');
    for (const [, classes] of html.matchAll(/class="([^"]*)"/g)) {
      expect(classes, classes).not.toMatch(PHYSICAL);
    }
  });
});

describe('the privacy notice and search engines', () => {
  it.each(['en', 'fa'])(
    'has a title, a description, a canonical and hreflang on /%s, and is never indexed',
    async (locale) => {
      configure();
      const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
      expect(meta.title).toBe(
        locale === 'en' ? 'Privacy notice · Stadiomind' : 'اطلاعیه‌ی حریم خصوصی · Stadiomind',
      );
      expect(meta.description).toBeTruthy();
      expect(meta.alternates?.canonical).toBe(`https://stadiomind.example/${locale}/privacy`);
      expect(meta.alternates?.languages).toMatchObject({
        en: 'https://stadiomind.example/en/privacy',
        fa: 'https://stadiomind.example/fa/privacy',
        'x-default': 'https://stadiomind.example/en/privacy',
      });
      expect(meta.robots).toEqual({ index: false, follow: false });
    },
  );

  it('is noindex while not configured too', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('is not in the sitemap', async () => {
    configure();
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain('https://stadiomind.example/en/about');
    expect(urls.filter((url) => url.includes('/privacy'))).toEqual([]);
  });

  it('is not refused by robots.txt either: a crawler must fetch the page to read its noindex', () => {
    const robots = readFileSync(join(__dirname, '..', '..', 'robots.ts'), 'utf8');
    expect(robots).not.toContain('privacy');
  });
});
