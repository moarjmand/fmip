import type { MatchViewing } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KnockoutBracket } from './knockout-bracket';
import { ViewingPanel } from './viewing-panel';

/**
 * The Watch line and the knockout bracket in Persian (T-1304): the sentence
 * about a territory keeps the name where Persian word order puts it, and the
 * bracket's own words come from the catalogue.
 */
const NONE = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;

const viewing = (): MatchViewing => ({
  fixture_id: 'f1',
  territory: { state: 'chosen', territory: { code: 'IR', name: 'Iran' } },
  options: NONE,
  highlights: NONE,
});

const line = (locale: string) =>
  renderToStaticMarkup(
    <ViewingPanel
      variant="line"
      locale={locale}
      timeZone="UTC"
      viewing={viewing()}
      kickoffAt="2026-10-01T16:00:00Z"
      status="scheduled"
      signedIn={false}
      href="/fa/match/f1"
    />,
  );

describe('ViewingPanel line (T-1304)', () => {
  it('keeps the English sentence word for word', () => {
    expect(line('en')).toContain('No viewing information yet for Iran');
  });

  it('writes the sentence in Persian with the territory inside it', () => {
    const html = line('fa');
    expect(html).toMatch(/هنوز اطلاعات پخشی برای .+ ثبت نشده است/);
    expect(html).not.toContain('data-translation="untranslated"');
  });
});

describe('a highlight from the licensed feed (T-1366)', () => {
  const finished = (publisher: string | null) =>
    renderToStaticMarkup(
      <ViewingPanel
        variant="line"
        locale="en"
        timeZone="UTC"
        viewing={{
          ...viewing(),
          highlights: {
            coverage: 'limited',
            last_updated_at: '2026-10-04T10:00:00Z',
            data: [
              {
                id: 'h1',
                kind: 'official_page',
                url: 'https://www.youtube.com/watch?v=official',
                embed_url: null,
                thumbnail_url: null,
                territory: 'IR',
                source: { id: 's', name: 'Highlightly', rights: 'link' },
                publisher,
                last_updated_at: '2026-10-04T10:00:00Z',
              },
            ],
          },
        }}
        kickoffAt="2026-10-03T16:00:00Z"
        status="finished"
        signedIn={false}
        href="/en/match/f1"
      />,
    );

  it('links to the original and names its publisher, with no player on the page', () => {
    const html = finished('LaLiga');
    expect(html).toContain('href="https://www.youtube.com/watch?v=official"');
    expect(html).toContain(
      'Official highlights (<bdi data-testid="viewing-highlight-publisher">LaLiga</bdi>)',
    );
    expect(html).not.toContain('<iframe');
  });

  it('names nobody when the feed named nobody', () => {
    expect(finished(null)).not.toContain('viewing-highlight-publisher');
  });
});

describe('KnockoutBracket (T-1304)', () => {
  it('names the section and a round’s format in Persian', () => {
    const html = renderToStaticMarkup(
      <KnockoutBracket
        locale="fa"
        timeZone="UTC"
        bracket={{
          rounds: [{ key: 'final', legs: 1, state: 'not_drawn', expected_ties: 1, ties: [] }],
        }}
      />,
    );
    expect(html).toContain('مرحله‌ی حذفی');
    expect(html).toContain('تک‌بازی');
  });
});
