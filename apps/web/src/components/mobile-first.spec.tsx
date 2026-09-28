import type { MatchCentre, ScoreCard as ScoreCardData } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchCentreView, SECTIONS } from './match-centre-view';
import { ScoreCard } from './score-card';

/**
 * Scores and the match centre, phone first (T-605). Rendered, not read from
 * the source: what is asserted is the markup a phone gets -- one line per
 * match with the rest behind a disclosure that keeps every label, and a
 * match page whose sections are plain anchors, the three prediction products
 * three of them.
 */

const card = (over: Partial<ScoreCardData> = {}): ScoreCardData => ({
  id: '00000000-0000-4000-8000-000000000901',
  kickoff_at: '2025-01-05T16:30:00.000Z',
  status: 'live',
  minute: 67,
  competition: { id: 'c', name: 'Premier League', short_name: null, country_id: null },
  season: { id: 's', label: '2024/25' },
  stage: null,
  round: 'Regular Season - 20',
  leg: null,
  home: { id: 'h', name: 'Liverpool', short_name: null, code: 'LIV' },
  away: { id: 'a', name: 'Manchester United', short_name: null, code: 'MUN' },
  scores: {
    current: { home: 2, away: 1 },
    half_time: null,
    full_time: null,
    extra_time: null,
    penalties: null,
    aggregate: null,
  },
  red_cards: { home: 0, away: 1 },
  incidents: [
    { minute: 12, added_time: null, kind: 'goal', side: 'home', player: 'Salah' },
  ] as ScoreCardData['incidents'],
  venue: { id: 'v', name: 'Anfield', city: 'Liverpool' },
  coverage: 'available',
  last_updated_at: '2025-01-05T17:40:00.000Z',
  freshness: null,
  pinned: false,
  ...over,
});

describe('a match on the scores list', () => {
  const html = renderToStaticMarkup(
    <ul>
      <ScoreCard card={card()} timeZone="UTC" locale="en" />
    </ul>,
  );

  it('is one link to the match with the live minute, both names isolated and cut short', () => {
    expect(html).toContain('data-testid="match-link"');
    expect(html).toContain('href="/en/match/00000000-0000-4000-8000-000000000901"');
    expect(html).toMatch(/data-testid="score-status"[^>]*>67′</);
    expect(html).toMatch(/text-live[^"]*" data-testid="score-status"/);
    expect(html).toMatch(/<bdi class="truncate" title="Liverpool">Liverpool<\/bdi>/);
    expect(html).toMatch(/<bdi class="truncate" title="Manchester United">/);
    expect(html).toContain('min-h-11');
    expect(html).toContain('aria-label="one red card"');
  });

  it('keeps every label, behind a disclosure named for the match', () => {
    expect(html).toContain('<details');
    expect(html).toContain('Details: Liverpool v Manchester United');
    for (const id of [
      'score-card',
      'home-team',
      'away-team',
      'score',
      'incidents',
      'card-labels',
    ]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    const details = html.slice(html.indexOf('<details'));
    expect(details).toContain('Forecast: not on this page yet');
    expect(details).toContain('Watch: unsupported');
    expect(details).toContain('Updated <time dateTime="2025-01-05T17:40:00.000Z">');
    expect(details).toContain('Anfield, Liverpool');
  });

  it('keeps a leg, an aggregate and the competition of a favourite on the row', () => {
    const row = renderToStaticMarkup(
      <ScoreCard
        card={card({ leg: 2, scores: { ...card().scores, aggregate: { home: 3, away: 3 } } })}
        timeZone="UTC"
        locale="en"
        showCompetition
      />,
    );
    const meta = row.slice(row.indexOf('data-testid="row-meta"'), row.indexOf('<details'));
    expect(meta).toContain('Premier League');
    expect(meta).toContain('Leg 2');
    expect(meta).toContain('Agg');
  });

  it('says on the row itself when its data is behind (rule 4)', () => {
    const row = renderToStaticMarkup(
      <ScoreCard
        card={card({ freshness: 'stale' })}
        timeZone="UTC"
        locale="en"
        now={Date.parse('2025-01-05T18:00:00Z')}
      />,
    );
    const behind = row.indexOf('data-testid="behind"');
    expect(behind).toBeGreaterThan(-1);
    expect(behind).toBeLessThan(row.indexOf('<details'));
    expect(row).toMatch(/data-testid="score-status"[^>]*>Behind</);
  });
});

const covered = <T,>(data: T) => ({
  coverage: 'available' as const,
  last_updated_at: '2025-01-05T17:40:00.000Z',
  data,
});

const centre: MatchCentre = {
  fixture: {
    id: '00000000-0000-4000-8000-000000000901',
    kickoff_at: '2025-01-05T16:30:00.000Z',
    status: 'live',
    minute: 67,
    competition: { id: 'c', name: 'Premier League', short_name: null, country_id: null },
    season: { id: 's', label: '2024/25' },
    stage: null,
    round: null,
    group_name: null,
    leg: null,
    home: {
      id: 'h',
      name: 'Liverpool',
      short_name: null,
      code: 'LIV',
      formation: '4-3-3',
      coach: null,
    },
    away: {
      id: 'a',
      name: 'Manchester United',
      short_name: null,
      code: 'MUN',
      formation: null,
      coach: null,
    },
    scores: {
      current: { home: 2, away: 1 },
      half_time: { home: 1, away: 1 },
      full_time: null,
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    venue: null,
    is_neutral_venue: false,
    referee: null,
    attendance: null,
    periods: [],
    last_updated_at: '2025-01-05T17:40:00.000Z',
    freshness: null,
  },
  timeline: covered([]),
  statistics: covered([{ metric: 'shots', home: 10, away: 4 }]),
  lineups: covered({ home: [], away: [] }),
  availability: covered([]),
  player_statistics: { coverage: 'not_supplied', last_updated_at: null, data: null },
  form: {
    home: { coverage: 'not_supplied', last_updated_at: null, data: null },
    away: { coverage: 'not_supplied', last_updated_at: null, data: null },
  },
  head_to_head: covered([]),
  coverage: {
    scores: 'available',
    incidents: 'available',
    lineups: 'available',
    statistics: 'available',
    standings: 'limited',
    availability: 'limited',
    advanced_statistics: 'not_supplied',
  },
};

describe('the match centre', () => {
  const html = renderToStaticMarkup(
    <MatchCentreView
      centre={centre}
      timeZone="Asia/Tehran"
      locale="en"
      slots={{
        context: <p>TABLE</p>,
        forecast: <p>MODEL</p>,
        analysis: <p>FOUNDER</p>,
        community: <p>CROWD</p>,
        discussion: <p>TALK</p>,
        watch: <p>TV</p>,
        news: <p>NEWS</p>,
      }}
    />,
  );

  it('opens with a compact header: teams, score, minute, kick-off in the viewer’s zone', () => {
    const header = html.slice(0, html.indexOf('</header>'));
    expect(header).toContain('data-testid="match-header"');
    expect(header).toMatch(/data-testid="match-status">67′</);
    expect(header).toContain('<bdi>Liverpool</bdi>');
    // 16:30 UTC is 20:00 in Tehran.
    expect(header).toMatch(/Kick-off <time dateTime="2025-01-05T16:30:00.000Z">[^<]*20:00/);
    expect(header).toContain('Last data update');
  });

  it('has a section nav of plain anchors, each to a section that exists', () => {
    const nav = html.slice(html.indexOf('data-testid="section-nav"'), html.indexOf('</nav>'));
    for (const [key, label] of SECTIONS) {
      expect(nav).toContain(`href="#${key}"`);
      expect(nav).toContain(label.replace("'", '&#x27;'));
      expect(html).toContain(`id="${key}"`);
    }
    expect(nav).not.toContain('<button');
  });

  it('keeps the model, the founder and the community in three sections, in that order', () => {
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(at('forecast')).toBeLessThan(at('analysis'));
    expect(at('analysis')).toBeLessThan(at('community'));
    const section = (id: string, next: string) => html.slice(at(id), at(next));
    expect(section('forecast', 'analysis')).toContain('MODEL');
    expect(section('forecast', 'analysis')).not.toMatch(/FOUNDER|CROWD/);
    expect(section('analysis', 'community')).toContain('FOUNDER');
    expect(section('analysis', 'community')).not.toMatch(/MODEL|CROWD/);
    expect(section('community', 'discussion')).toContain('CROWD');
  });

  it('scrolls the statistics table inside its own box and stacks the line-ups on a phone', () => {
    expect(html).toMatch(/<div class="overflow-x-auto"><table/);
    const lineups = html.slice(html.indexOf('data-testid="lineups"'));
    expect(lineups).toContain('grid-cols-1');
    expect(lineups).toContain('sm:grid-cols-2');
  });

  it('gives a coverage tag its own gap and direction, and an empty module its own sentence', () => {
    // A flex gap, not a margin: beside an English title in a right-to-left
    // paragraph the margin landed on the far side and the two words touched.
    expect(html).toMatch(
      /<h2 class="flex flex-wrap items-baseline gap-x-2[^"]*"><span>Player statistics<\/span><span dir="auto"/,
    );
    expect(html).toContain(
      '<p dir="auto" class="text-sm text-muted">Not supplied for this match.</p>',
    );
    expect(html).toContain(
      '<p dir="auto" class="text-xs text-muted">No competitive results held.</p>',
    );
  });

  it('leaves a section out of the nav when the page has nothing for it', () => {
    const bare = renderToStaticMarkup(
      <MatchCentreView centre={centre} timeZone="UTC" locale="en" />,
    );
    expect(bare).toContain('href="#timeline"');
    expect(bare).not.toContain('href="#forecast"');
    expect(bare).not.toContain('id="forecast"');
  });
});
