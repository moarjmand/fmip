import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_MEDIA } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attribute, message } from '@/i18n/messages';
import { CompetitionsBarLinks, isCompetitionPath } from './competitions-bar-links';
import { CompetitionsDirectory } from './competitions-directory';

/**
 * The competitions bar and the All competitions page's list (T-1433), drawn:
 * the landmark, each competition to its page as a pill, "All competitions"
 * at the end (T-1513), the current one marked, the words in Persian, and
 * only logical CSS.
 */

let pathname = '/en';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const HEADER = readFileSync(join(__dirname, 'site-header.tsx'), 'utf8');
const SOURCES = ['competitions-bar.tsx', 'competitions-bar-links.tsx', 'competitions-directory.tsx']
  .map((file) => readFileSync(join(__dirname, file), 'utf8'))
  .join('\n');

const ITEMS = [
  { id: 'pgpl', label: 'Pro League', icon: null },
  { id: 'epl', label: 'PL', icon: null },
];

const bar = (locale: 'en' | 'fa', items = ITEMS) =>
  renderToStaticMarkup(
    <CompetitionsBarLinks
      locale={locale}
      items={items}
      all={message(locale, 'competitions.bar.all')}
      navLabel={attribute(locale, 'competitions.bar.label')}
    />,
  );

beforeEach(() => {
  pathname = '/en';
});

describe('the competitions bar', () => {
  it('is a named landmark: each competition to its page, then All competitions (T-1513)', () => {
    const html = bar('en');
    expect(html).toMatch(/<nav aria-label="Competitions"/);
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      '/en/competition/pgpl',
      '/en/competition/epl',
      '/en/competitions',
    ]);
    expect(html).toContain('All competitions');
    expect(html).not.toContain('aria-current');
  });

  it('marks the competition being read, on any of its tabs', () => {
    pathname = '/en/competition/epl/';
    expect(isCompetitionPath('/en/competition/epl', 'en', 'epl')).toBe(true);
    expect(isCompetitionPath('/en/competition/epl2', 'en', 'epl')).toBe(false);
    const html = bar('en');
    expect(html).toMatch(/aria-current="page"[^>]*data-competition="epl"/);
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it('marks All competitions on its page', () => {
    pathname = '/en/competitions';
    expect(bar('en')).toMatch(/aria-current="page"[^>]*data-testid="competitions-bar-all"/);
  });

  it('is in Persian on /fa', () => {
    pathname = '/fa';
    const html = bar('fa');
    expect(html).toContain('aria-label="رقابت‌ها"');
    expect(html).toContain('همه رقابت‌ها');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('is All competitions alone when no list could be read (rule 3)', () => {
    const html = bar('en', []);
    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).toContain('/en/competitions');
  });

  it('draws the Design System pills, and is not drawn on a phone (D-267)', () => {
    const html = bar('en');
    const nav = /<nav[^>]*>/.exec(html)?.[0] ?? '';
    expect(nav).toContain('max-md:hidden');
    expect(nav).not.toContain('data-mode');
    expect(html.match(/class="pill-entry focus-inset"/g)).toHaveLength(2);
    expect(html).toContain('class="pill-all focus-inset"');
    // The arrow turns with the writing direction, and a screen reader skips it.
    expect(html).toContain(
      '<span aria-hidden="true" class="inline-block rtl:-scale-x-100">→</span>',
    );
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/@utility pill-entry \{[\s\S]*?rounded-pill border border-default/);
    expect(css).toMatch(/&\[aria-current='page'\] > span \{\s*@apply border-accent/);
  });

  it('sits right under the header, before the live strip', () => {
    const header = HEADER.indexOf('</header>');
    const bar = HEADER.indexOf('<CompetitionsBar');
    expect(header).toBeGreaterThan(0);
    expect(bar).toBeGreaterThan(header);
    expect(bar).toBeLessThan(HEADER.indexOf('<LiveStrip'));
  });

  it("keeps the contracts package off every page's first load (T-808)", () => {
    // The client halves draw logos the server rendered; EntityImage imports
    // @fmip/contracts, which would ride on every page's first load.
    for (const file of ['competitions-bar-links.tsx', 'competitions-directory.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/from '@\/components\/entity-image'/);
      expect(source).not.toMatch(/^import \{[^}]*\} from '@fmip\/contracts'/m);
    }
  });

  it('uses logical properties only (rule 7)', () => {
    expect(SOURCES).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-[\w[]/);
    expect(SOURCES).not.toMatch(/text-(?:left|right)\b/);
  });
});

describe('the All competitions list', () => {
  const groups = [
    {
      key: 'continental',
      kind: 'continental' as const,
      name: null,
      heading: 'قاره‌ای',
      competitions: [
        {
          id: 'ucl',
          name: 'لیگ قهرمانان اروپا',
          short_name: null,
          scope: 'continental' as const,
          kind: 'cup' as const,
          country: null,
          order: null,
          logo: NO_MEDIA,
        },
      ],
    },
    {
      key: 'irn',
      kind: 'country' as const,
      name: 'ایران',
      heading: 'ایران',
      competitions: [
        {
          id: 'pgpl',
          name: 'لیگ برتر خلیج فارس',
          short_name: null,
          scope: 'domestic' as const,
          kind: 'league' as const,
          country: { id: 'irn', name: 'ایران', code: 'IRN' },
          order: 1,
          logo: NO_MEDIA,
        },
      ],
    },
  ];
  const words = {
    filter: attribute('fa', 'competitions.filter'),
    jump: attribute('fa', 'competitions.jump'),
    noMatch: message('fa', 'competitions.noMatch'),
  };

  it('draws each group as a section with its heading, a jump link and a link per competition', () => {
    const html = renderToStaticMarkup(
      <CompetitionsDirectory
        locale="fa"
        groups={groups}
        icons={{}}
        initialFilter=""
        words={words}
      />,
    );
    expect(html.match(/data-testid="competitions-group"/g)).toHaveLength(2);
    expect(html).toContain('href="#group-irn"');
    expect(html).toContain('href="/fa/competition/pgpl"');
    expect(html).toContain('aria-labelledby="group-irn-heading"');
    // The filter is labelled and is a plain GET form a reader without a script can send.
    expect(html).toContain('جست‌وجوی رقابت یا کشور');
    const form = /<form[^>]*>/.exec(html)?.[0] ?? '';
    expect(form).toContain('role="search"');
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/fa/competitions"');
  });

  it('starts from the filter the address carries, and says when nothing matches', () => {
    const one = renderToStaticMarkup(
      <CompetitionsDirectory
        locale="fa"
        groups={groups}
        icons={{}}
        initialFilter="ايران"
        words={words}
      />,
    );
    expect(one.match(/data-testid="competitions-item"/g)).toHaveLength(1);
    expect(one).toContain('/fa/competition/pgpl');

    const none = renderToStaticMarkup(
      <CompetitionsDirectory
        locale="fa"
        groups={groups}
        icons={{}}
        initialFilter="zzz"
        words={words}
      />,
    );
    expect(none).toContain('data-testid="competitions-no-match"');
    expect(none).not.toContain('data-testid="competitions-group"');
  });
});
