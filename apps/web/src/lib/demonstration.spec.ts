import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { DEMONSTRATION_TITLE_PREFIX, isDemonstrationData } from './demonstration';
import { pageMetadata } from './seo';

/**
 * Demonstration data, and the four things that say so (T-087).
 *
 * The preview runs the whole product against development fixtures: matches
 * that were never played, on a public address. Unmarked, that is rule 3 told to
 * everybody who opens the link — so a reader gets a band on every page, a
 * crawler gets `noindex` and a robots.txt that forbids the site, and a shared
 * link carries it in its title.
 *
 * What each test here is really guarding is a *silent* failure: every one of
 * these four is invisible when it stops working. A banner that does not render
 * looks exactly like a page.
 */

const ORIGIN = 'https://preview.example';
const before = process.env['DEMONSTRATION_DATA'];

afterEach(() => {
  if (before === undefined) delete process.env['DEMONSTRATION_DATA'];
  else process.env['DEMONSTRATION_DATA'] = before;
});

describe('what counts as demonstration data', () => {
  it('is `on`, in any case, with whitespace forgiven', () => {
    for (const value of ['on', 'ON', 'On', ' on ']) {
      expect(isDemonstrationData({ DEMONSTRATION_DATA: value }), value).toBe(true);
    }
  });

  it('is nothing else, and absent is a normal deployment', () => {
    // The safe way round. A typo costs a preview its banner; the opposite
    // default would put "none of this is real" on real football.
    for (const value of ['off', 'true', '1', 'yes', '', 'onn']) {
      expect(isDemonstrationData({ DEMONSTRATION_DATA: value }), value).toBe(false);
    }
    expect(isDemonstrationData({})).toBe(false);
  });
});

describe('a page that holds demonstration data is never indexable', () => {
  it('refuses indexing even where the page asked for it', () => {
    const meta = pageMetadata({ locale: 'en', path: '/scores', title: 'Scores' }, ORIGIN, true);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('still indexes a normal deployment, so the guard is doing something', () => {
    // Without this the test above passes on a function that always says no.
    const meta = pageMetadata({ locale: 'en', path: '/scores', title: 'Scores' }, ORIGIN, false);
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it('says it in the Open Graph title, which is what a chat app renders', () => {
    const meta = pageMetadata({ locale: 'en', path: '/scores', title: 'Scores' }, ORIGIN, true);
    expect(meta.openGraph?.title).toBe(`${DEMONSTRATION_TITLE_PREFIX}Scores`);
  });

  it('leaves the document title to the layout template', () => {
    // Prefixing here would double up with the template, and would still miss
    // the nine pages that never call this function.
    const meta = pageMetadata({ locale: 'en', path: '/scores', title: 'Scores' }, ORIGIN, true);
    expect(meta.title).toBe('Scores');
  });

  it("leaves a normal deployment's Open Graph title alone", () => {
    const meta = pageMetadata({ locale: 'en', path: '/scores', title: 'Scores' }, ORIGIN, false);
    expect(meta.openGraph?.title).toBe('Scores');
  });
});

describe('the title template reaches the pages pageMetadata never sees', () => {
  it('is set on the layout, with the default Next.js requires', () => {
    const LAYOUT = readFileSync(join(__dirname, '..', 'app', '[locale]', 'layout.tsx'), 'utf8');
    expect(LAYOUT).toContain('DEMONSTRATION_TITLE_TEMPLATE');
    expect(LAYOUT).toContain('template: DEMONSTRATION_TITLE_TEMPLATE');
    // A template without a default is ignored, silently.
    expect(LAYOUT).toMatch(/default: `\$\{DEMONSTRATION_TITLE_PREFIX\}/);
  });

  it('covers a page that sets its own metadata object', () => {
    // The offline page is one of nine that export `metadata` directly. A
    // template applies to whatever a child segment set, however it set it --
    // which is the reason the marker lives there and not in `pageMetadata`.
    const OFFLINE = readFileSync(
      join(__dirname, '..', 'app', '[locale]', 'offline', 'page.tsx'),
      'utf8',
    );
    expect(OFFLINE).toContain('export const metadata');
    expect(OFFLINE).not.toContain('pageMetadata');
    // `absolute` would opt the page out of the template and lose the marker.
    expect(OFFLINE).not.toContain('absolute:');
  });
});

describe('robots.txt', () => {
  it('forbids the whole site, and offers no sitemap', () => {
    process.env['DEMONSTRATION_DATA'] = 'on';
    const result = robots();
    expect(result.rules).toEqual([{ userAgent: '*', disallow: '/' }]);
    // A sitemap alongside a blanket disallow is the same claim contradicted.
    expect(result.sitemap).toBeUndefined();
  });

  it('allows a normal deployment', () => {
    process.env['DEMONSTRATION_DATA'] = 'off';
    const result = robots();
    expect(result.sitemap).toContain('/sitemap.xml');
  });
});

describe('sitemap.xml', () => {
  it('is empty, rather than a map of matches that never happened', async () => {
    // Sitemaps are fetched even where robots.txt forbids crawling, so this is
    // not covered by the rule above.
    process.env['DEMONSTRATION_DATA'] = 'on';
    await expect(sitemap()).resolves.toEqual([]);
  });
});

describe('the banner itself', () => {
  const SRC = readFileSync(join(__dirname, '..', 'components', 'demonstration-banner.tsx'), 'utf8');
  const LAYOUT = readFileSync(join(__dirname, '..', 'app', '[locale]', 'layout.tsx'), 'utf8');

  it('stops prerendering before it reads the environment, not after', () => {
    // The whole failure this component exists to prevent: Render supplies
    // DEMONSTRATION_DATA at runtime and not to `docker build`, so a check that
    // ran while Next.js was prerendering would read nothing, decide "not
    // demonstration data" and bake a page of invented scores with no marker on
    // it. Order is the correctness property, so order is what is asserted.
    const connection = SRC.indexOf('await connection()');
    const check = SRC.indexOf('isDemonstrationData()');
    expect(connection, 'the banner does not call connection()').toBeGreaterThan(-1);
    expect(check, 'the banner does not check the environment').toBeGreaterThan(-1);
    expect(connection, 'the check runs before prerendering stops').toBeLessThan(check);
  });

  it('cannot be dismissed', () => {
    // A marker a reader can close is off for everyone who closed it, and
    // absent from every screenshot they take afterwards.
    expect(SRC).not.toMatch(/use client|onClick|useState|<button/);
  });

  it('is rendered on every page, above the content', () => {
    expect(LAYOUT).toContain('<DemonstrationBanner />');
    const banner = LAYOUT.indexOf('<DemonstrationBanner />');
    const content = LAYOUT.indexOf('id="content"');
    expect(banner).toBeLessThan(content);
    // After the skip link, which must stay first in the tab order (T-081).
    expect(LAYOUT.indexOf('data-testid="skip-link"')).toBeLessThan(banner);
  });

  it('uses logical properties only (rule 7)', () => {
    expect(SRC).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
  });
});

describe('the preview cannot serve fixture data unmarked', () => {
  const START = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'deploy', 'preview', 'start.mjs'),
    'utf8',
  );

  it('refuses to seed when the marker is off', () => {
    // A warning in a boot log is read by nobody and the container serves the
    // pages anyway, so this has to be a refusal.
    expect(START).toContain("if (!isOn('DEMONSTRATION_DATA')) {");
    const seed = START.indexOf('async function seedPreview()');
    const guard = START.indexOf("isOn('DEMONSTRATION_DATA')", seed);
    const run = START.indexOf("'dist/seed.js'");
    expect(guard).toBeGreaterThan(seed);
    expect(guard, 'the guard runs after the seed').toBeLessThan(run);
  });

  it('does not refuse the harmless direction', () => {
    // Marking a deployment nobody seeded costs nothing; only the reverse is a
    // failure, and a guard that blocked both would make the marker expensive
    // enough to leave off.
    expect(START).not.toContain("if (!isOn('PREVIEW_SEED')) die");
  });
});
