import type {
  Broadcaster,
  ViewingCompetition,
  ViewingDefault,
  ViewingUpcomingFixture,
  ViewingUpcomingResponse,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The server actions need a request; the console only binds them.
vi.mock('@/lib/viewing-console-actions', () => ({
  declareConsoleCoverageAction: async () => null,
  addConsoleBroadcasterAction: async () => null,
  addViewingDefaultAction: async () => null,
  removeViewingDefaultAction: async () => null,
  bulkListAction: async () => null,
  removeConsoleListingAction: async () => null,
}));

const { ViewingConsole } = await import('./viewing-console');

/**
 * Watch listings in the console (T-1361): nothing but the picker and the
 * broadcasters until a competition is chosen; an uncovered season offers no
 * default and ticks nothing; a covered one shows its defaults, ticks the
 * matches with nothing listed, badges a listing a default made, and keeps
 * every removal outside the bulk form (HTML has no nested forms). Logical
 * properties only (rule 7).
 */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const broadcaster: Broadcaster = {
  id: 'b1',
  name: 'IRIB Varzesh',
  homepage_url: 'https://varzesh.test',
  kind: 'tv',
};

const league: ViewingCompetition = {
  id: 'c1',
  name: 'Persian Gulf Pro League',
  short_name: 'PGPL',
  season: { id: 's1', label: '2026/27' },
  coverage: 'available',
  defaults: 1,
};

const standing: ViewingDefault = {
  id: 'd1',
  competition: { id: 'c1', name: 'Persian Gulf Pro League' },
  territory: 'IR',
  broadcaster,
  access: 'free',
  url: 'https://varzesh.test/live',
  note: 'IRIB schedule',
  listings: 2,
  created_at: '2026-10-01T08:00:00.000Z',
  updated_at: '2026-10-01T08:00:00.000Z',
};

function fixture(
  id: string,
  overrides: Partial<ViewingUpcomingFixture> = {},
): ViewingUpcomingFixture {
  return {
    id,
    kickoff_at: '2026-10-03T16:30:00.000Z',
    status: 'scheduled',
    season_id: 's1',
    stage: null,
    round: 'Regular Season - 7',
    leg: null,
    home: { id: 'h', name: 'Esteghlal' },
    away: { id: 'a', name: 'Persepolis' },
    covered: true,
    options: [],
    ...overrides,
  };
}

function upcoming(overrides: Partial<ViewingUpcomingResponse> = {}): ViewingUpcomingResponse {
  return {
    competition: { id: 'c1', name: 'Persian Gulf Pro League' },
    territory: 'IR',
    from: '2026-10-02T09:00:00.000Z',
    to: '2026-10-09T12:00:00.000Z',
    days: 7,
    season: { id: 's1', label: '2026/27' },
    coverage: 'available',
    defaults: [],
    fixtures: [],
    ...overrides,
  };
}

const query = { territory: 'IR', competition: 'c1', days: 7 };

function checkedBox(html: string, id: string): boolean {
  const tag = html.match(new RegExp(`<input[^>]*data-testid="bulk-pick-${id}"[^>]*>`))?.[0] ?? '';
  return /\schecked=""/.test(tag);
}

describe('ViewingConsole (T-1361)', () => {
  it('with no competition chosen, offers the picker and the broadcasters only', () => {
    const html = renderToStaticMarkup(
      <ViewingConsole
        locale="en"
        query={{ ...query, competition: null }}
        competitions={[league]}
        broadcasters={[broadcaster]}
        upcoming={{ state: 'none' }}
      />,
    );
    expect(html).toContain('data-testid="viewing-console-choose"');
    expect(html).toContain('Persian Gulf Pro League — 2026/27 · covered · 1 default');
    expect(html).toContain('data-testid="viewing-console-broadcaster-form"');
    expect(html).not.toContain('viewing-console-coverage');
    expect(html).not.toContain('viewing-bulk-form');
    expect(html).not.toMatch(PHYSICAL);
  });

  it('an uncovered season says so, offers no default, and ticks no match', () => {
    const html = renderToStaticMarkup(
      <ViewingConsole
        locale="en"
        query={query}
        competitions={[{ ...league, coverage: null, defaults: 0 }]}
        broadcasters={[broadcaster]}
        upcoming={{
          state: 'shown',
          data: upcoming({ coverage: null, fixtures: [fixture('f1', { covered: false })] }),
        }}
      />,
    );
    expect(html).toContain('nothing declared');
    expect(html).toContain('data-testid="viewing-console-coverage-form"');
    expect(html).toContain('data-testid="viewing-console-default-needs-coverage"');
    expect(html).not.toContain('viewing-console-default-form');
    expect(html).toContain('data-testid="viewing-console-uncovered"');
    expect(checkedBox(html, 'f1')).toBe(false);
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*data-testid="bulk-pick-f1"/);
    expect(html).not.toMatch(PHYSICAL);
  });

  it('a covered season shows its defaults, ticks the unlisted matches and badges a default listing', () => {
    const listed = fixture('f2', {
      options: [
        {
          id: 'o1',
          broadcaster,
          access: 'free',
          url: 'https://varzesh.test/live',
          territory: 'IR',
          source: { id: 'src', name: 'Editorial desk', rights: 'link' },
          from_default: true,
          last_updated_at: '2026-10-01T08:00:00.000Z',
        },
      ],
    });
    const html = renderToStaticMarkup(
      <ViewingConsole
        locale="en"
        query={query}
        competitions={[league]}
        broadcasters={[broadcaster]}
        upcoming={{
          state: 'shown',
          data: upcoming({ defaults: [standing], fixtures: [fixture('f1'), listed] }),
        }}
      />,
    );
    expect(html).toContain('data-testid="viewing-default-d1"');
    expect(html).toContain('2 listings');
    expect(html).toContain('data-testid="viewing-default-remove-d1"');
    expect(html).toContain('data-testid="viewing-console-default-form"');
    expect(checkedBox(html, 'f1')).toBe(true);
    expect(checkedBox(html, 'f2')).toBe(false);
    expect(html).toContain('data-testid="listing-default-badge"');
    expect(html).toContain('2026-10-03 16:30 UTC');
    // The removal is a form of its own, after the bulk form closes: no form inside a form.
    const bulk = html.slice(html.indexOf('data-testid="viewing-bulk-form"'));
    const bulkBody = bulk.slice(0, bulk.indexOf('</form>'));
    expect(bulkBody).not.toContain('<form');
    expect(html).toContain('id="remove-o1"');
    expect(html).toContain('data-testid="viewing-listing-remove-o1"');
    expect(html).not.toMatch(PHYSICAL);
  });

  it('says an unknown competition and a failed window in words', () => {
    const unknown = renderToStaticMarkup(
      <ViewingConsole
        locale="en"
        query={query}
        competitions={[]}
        broadcasters={null}
        upcoming={{ state: 'unknown' }}
      />,
    );
    expect(unknown).toContain('data-testid="viewing-console-unknown"');
    expect(unknown).toContain('The broadcasters cannot be read right now.');
    const failed = renderToStaticMarkup(
      <ViewingConsole
        locale="en"
        query={query}
        competitions={[league]}
        broadcasters={[]}
        upcoming={{ state: 'failed', message: 'Unknown competition.' }}
      />,
    );
    expect(failed).toContain('Unknown competition.');
  });
});
