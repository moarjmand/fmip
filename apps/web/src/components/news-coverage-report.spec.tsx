import type { EntityNewsResponse, NewsCoverageReport as Report } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewsCoverageReport } from './news-coverage-report';
import { EntityNews } from './related-news';

/**
 * News coverage per competition (T-1010, D-129), rendered: the competition
 * page says how thin its news is below the floor, and says no carried source
 * covers it before any old card (rule 3); the console's report names each
 * gap and offers no way to add a source (N-8). Logical properties (rule 7).
 */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const READ = '2026-09-29T10:00:00Z';

function competitionNews(overrides: Partial<EntityNewsResponse>): EntityNewsResponse {
  return {
    entity: { type: 'competition', id: 'c' },
    stories: { coverage: 'limited', last_updated_at: READ, data: [] },
    reason: 'below_floor',
    coverage: {
      window_days: 30,
      floor: 5,
      stories: 2,
      sources: [{ id: 's', name: 'A', stories: 2 }],
    },
    ...overrides,
  };
}

describe('EntityNews for a competition (T-1010)', () => {
  it('says the coverage is thin below the floor, with the count and the window', () => {
    const html = renderToStaticMarkup(
      <EntityNews locale="en" timeZone="UTC" news={competitionNews({})} />,
    );
    expect(html).toContain('data-testid="entity-news-thin"');
    expect(html).toContain('Only 2 stories about this competition');
    expect(html).toContain('last 30 days');
  });

  it('says no carried source covers it, and not that nobody reported on it', () => {
    const html = renderToStaticMarkup(
      <EntityNews
        locale="en"
        timeZone="UTC"
        news={competitionNews({
          reason: 'no_carried_source',
          coverage: { window_days: 30, floor: 5, stories: 0, sources: [] },
        })}
      />,
    );
    expect(html).toContain('data-testid="entity-news-no-source"');
    expect(html).toContain('None of the publishers we read');
    expect(html).not.toContain('entity-news-nothing');
  });

  it('a covered competition carries no notice', () => {
    const html = renderToStaticMarkup(
      <EntityNews
        locale="en"
        timeZone="UTC"
        news={competitionNews({
          stories: { coverage: 'available', last_updated_at: READ, data: [] },
          reason: 'nothing_linked',
          coverage: { window_days: 30, floor: 5, stories: 9, sources: [] },
        })}
      />,
    );
    expect(html).not.toContain('entity-news-thin');
    expect(html).not.toContain('entity-news-no-source');
  });
});

describe('NewsCoverageReport (T-1010)', () => {
  const report: Report = {
    generated_at: READ,
    window_days: 30,
    floor: 5,
    carried_sources: 2,
    feeds_read_at: READ,
    competitions: [
      {
        competition: { id: 'bare', name: 'Bare League' },
        state: 'no_carried_source',
        coverage: { window_days: 30, floor: 5, stories: 0, sources: [] },
      },
      {
        competition: { id: 'full', name: 'Full League' },
        state: 'covered',
        coverage: {
          window_days: 30,
          floor: 5,
          stories: 7,
          sources: [
            { id: 'a', name: 'Paper A', stories: 5 },
            { id: 'b', name: 'Paper B', stories: 3 },
          ],
        },
      },
    ],
  };

  it('lists every competition with its state, count and sources, and adds nothing', () => {
    const html = renderToStaticMarkup(<NewsCoverageReport locale="en" report={report} />);
    expect(html.match(/data-testid="coverage-row"/g)).toHaveLength(2);
    expect(html).toContain('data-state="no_carried_source"');
    expect(html).toContain('Paper A (5), Paper B (3)');
    expect(html).toContain('1 under the floor of 5');
    expect(html).toContain('(N-8)');
    expect(html).not.toContain('<form');
    expect(html).not.toMatch(PHYSICAL);
  });

  it('says when no source is carried and when no feed was read', () => {
    const html = renderToStaticMarkup(
      <NewsCoverageReport
        locale="en"
        report={{ ...report, carried_sources: 0, feeds_read_at: null }}
      />,
    );
    expect(html).toContain('data-testid="coverage-no-sources"');
    expect(html).toContain('data-testid="coverage-feeds-unread"');
  });
});
