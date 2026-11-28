import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KEYED_ROUTES,
  feedbackHref,
  feedbackPage,
  feedbackSubject,
  siteContactEmail,
} from '@/lib/feedback';
import { FeedbackLink, feedbackAddress } from './feedback-link';

/**
 * The testers' feedback place (T-1965, D-466): "Send feedback" opens an
 * e-mail to `SITE_CONTACT_EMAIL`, the subject in the reader's language with
 * the page they are on; with no address there is no link and no question
 * (rule 3). On `/welcome`, in the footer and on the member's own profile.
 */

let pathname = '/en/welcome';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
// The request scope: `feedbackAddress` asks for it before reading the variable.
const connection = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('next/server', () => ({ connection }));

const ADDRESS = 'feedback@example.test';
const WEB = join(__dirname, '..');
const source = (path: string) => readFileSync(join(WEB, path), 'utf8');

const draw = async (locale: string, variant: 'line' | 'item', testId?: string) => {
  const element = FeedbackLink({ locale, address: await feedbackAddress(), variant, testId });
  return element === null ? '' : renderToStaticMarkup(element);
};

beforeEach(() => {
  pathname = '/en/welcome';
  vi.stubEnv('SITE_CONTACT_EMAIL', ADDRESS);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the contact mailbox', () => {
  it('is the variable, trimmed, and only one plain address', () => {
    expect(siteContactEmail({ SITE_CONTACT_EMAIL: ` ${ADDRESS} ` })).toBe(ADDRESS);
    for (const value of [
      undefined,
      '',
      '   ',
      'not-an-address',
      'a@b',
      'a@example.test?cc=b@example.test',
      'a@example.test,b@example.test',
      'a b@example.test',
      // Percent-encoded separators: a mail program decodes them into a second
      // recipient or a header (RFC 6068).
      'a%2Cb@example.test',
      'a%0Abcc%3Ab@example.test',
      'a@example.test%3Fbcc%3Dx',
      'a=b@example.test',
      // Not a domain.
      'a@b..c',
      'a@.b.c',
      'a@example.c',
      'a@sub_domain.example',
    ]) {
      expect(siteContactEmail({ SITE_CONTACT_EMAIL: value }), String(value)).toBeNull();
    }
    expect(
      siteContactEmail({ SITE_CONTACT_EMAIL: 'first.last+test@mail.example-site.co.uk' }),
    ).toBe('first.last+test@mail.example-site.co.uk');
  });

  it('gets the page’s path in the subject, never its query', () => {
    expect(feedbackSubject('Feedback, from {page}', '/fa/welcome')).toBe(
      'Feedback, from /fa/welcome',
    );
    expect(feedbackSubject('{page}', '/en/search?q=private#x')).toBe('/en/search');
    expect(feedbackSubject('{page}', '')).toBe('/');
  });

  it('names a keyed route by its name only, never the key in its path', () => {
    expect(feedbackPage('/en/group-invite/s3cr3t-t0ken')).toBe('/en/group-invite');
    expect(feedbackPage('/fa/called-it/s3cr3t-t0ken?x=1')).toBe('/fa/called-it');
    expect(feedbackSubject('{page}', '/en/group-invite/s3cr3t')).not.toContain('s3cr3t');
    expect(feedbackPage('/en/match/0a1b')).toBe('/en/match/0a1b');
  });

  it('knows every route with a [token] segment as keyed', () => {
    const found: string[] = [];
    const walk = (dir: string, parent: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '[token]') found.push(parent);
        walk(join(dir, entry.name), entry.name);
      }
    };
    walk(join(WEB, 'app', '[locale]'), '');
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect([...found].sort()).toEqual([...KEYED_ROUTES].sort());
  });

  it('keeps the path left to right inside a right-to-left subject', () => {
    expect(feedbackSubject('از صفحه‌ی {page}', '/fa/welcome')).toBe(
      'از صفحه‌ی \u200e/fa/welcome\u200e',
    );
    expect(feedbackSubject('from {page}', '/en/welcome')).toBe('from /en/welcome');
  });

  it('encodes the whole subject into the address', () => {
    expect(feedbackHref(ADDRESS, 'a b/ی')).toBe(
      `mailto:${ADDRESS}?subject=${encodeURIComponent('a b/ی')}`,
    );
  });
});

describe('Send feedback', () => {
  it('opens an e-mail to the address, the subject in English naming the page', async () => {
    const html = await draw('en', 'line', 'welcome-feedback');
    expect(html).toContain('data-testid="welcome-feedback-line"');
    expect(html).toContain('Something unclear, wrong or missing? Write to us by e-mail:');
    const subject = encodeURIComponent('Feedback on Stadiomind, from /en/welcome');
    expect(html).toContain(`href="mailto:${ADDRESS}?subject=${subject}"`);
    expect(html).toContain('>Send feedback</a>');
  });

  it('is written in Persian on /fa, the subject too', async () => {
    pathname = '/fa/u/new_member';
    const html = await draw('fa', 'line', 'profile-feedback');
    expect(html).toContain('چیزی نامفهوم، نادرست یا ناقص است؟ با ایمیل برای ما بنویسید:');
    expect(html).toContain('>ارسال بازخورد</a>');
    const subject = encodeURIComponent(
      'بازخورد درباره‌ی Stadiomind، از صفحه‌ی \u200e/fa/u/new_member\u200e',
    );
    expect(html).toContain(`?subject=${subject}"`);
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('is a list item alone in the footer’s strip', async () => {
    const html = await draw('en', 'item', 'footer-feedback');
    expect(html).toMatch(/^<li><a href="mailto:[^"]+" data-testid="footer-feedback">/);
    expect(html).not.toContain('Something unclear');
  });

  it('draws nothing at all, the question included, without an address', async () => {
    for (const value of ['', 'not-an-address']) {
      vi.stubEnv('SITE_CONTACT_EMAIL', value);
      const address = await feedbackAddress();
      expect(address).toBeNull();
      expect(FeedbackLink({ locale: 'en', address, variant: 'line' })).toBeNull();
      expect(FeedbackLink({ locale: 'fa', address, variant: 'item' })).toBeNull();
    }
  });

  it('is read at request time, never at build time', async () => {
    connection.mockClear();
    await feedbackAddress();
    expect(connection).toHaveBeenCalledOnce();
    expect(source('lib/feedback.ts')).toContain("env['SITE_CONTACT_EMAIL']");
  });
});
