import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerMatch, PlayerPage, PlayerSeasonRecord } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { latestSeason, playerTabHref, readPlayerTab, spellsCoverage } from '@/lib/player';

vi.mock('@/lib/auth-actions', () => ({
  followAction: async () => undefined,
  unfollowAction: async () => undefined,
}));

const { PlayerBand, PlayerMatchesPanel, RecordPanel, SeasonFilter, SeasonTilesPanel, SpellsPanel } =
  await import('./player-page');
const { PlayerAvailabilitySection } = await import('./player-availability');

/**
 * The player page in the Hybrid design (T-1386, D-204): the band in the
 * brand's colours with a "not supplied" badge for a birth date we do not
 * hold, the season in dense tiles with minutes never shown as a zero,
 * every module's coverage as a badge, and each score beside its own team in
 * Persian digits on `/fa`.
 */

const PERSON = '00000000-0000-4000-8000-000000000701';
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const HERE = __dirname;
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'player', '[id]', 'page.tsx'),
  'utf8',
);
const COMPONENT = readFileSync(join(HERE, 'player-page.tsx'), 'utf8');

function row(over: Partial<PlayerSeasonRecord> = {}): PlayerSeasonRecord {
  return {
    season: { id: 's2', label: '2026/27' },
    competition: { id: 'pgpl', name: 'Persian Gulf Pro League', short_name: 'Pro League' },
    team: { id: 'tractor', name: 'Tractor' },
    starts: 7,
    sub_appearances: 0,
    goals: 0,
    assists: 1,
    yellow_cards: 0,
    red_cards: 0,
    minutes: {
      coverage: 'not_supplied',
      total: null,
      matches: 7,
      matches_with_minutes: 0,
      supplied_minutes: 0,
    },
    ...over,
  };
}

function match(over: Partial<PlayerMatch> = {}): PlayerMatch {
  return {
    fixture: {
      id: 'f1',
      kickoff_at: '2026-10-08T14:00:00.000Z',
      status: 'finished',
      round: null,
      stage: null,
      home: { id: 'tractor', name: 'Tractor', short_name: null },
      away: { id: 'esteghlal', name: 'Esteghlal', short_name: null },
      score: { home: 3, away: 1 },
      competition: { id: 'pgpl', name: 'Persian Gulf Pro League', short_name: 'Pro League' },
      season: { id: 's2', label: '2026/27' },
      after_extra_time: false,
      penalties: null,
    },
    team: { id: 'tractor', name: 'Tractor' },
    role: 'starter',
    came_on: false,
    goals: 0,
    assists: 1,
    yellow_cards: 1,
    red_cards: 0,
    ...over,
  };
}

function page(over: Partial<PlayerPage> = {}): PlayerPage {
  return {
    person: {
      id: PERSON,
      full_name: 'Alireza Beiranvand',
      known_as: null,
      localised_name: null,
      date_of_birth: null,
      nationality: { id: 'ir', name: 'Iran', code: 'IR' },
      height_cm: null,
      preferred_foot: null,
    },
    current_spell: {
      team: { id: 'tractor', name: 'Tractor', short_name: null },
      start_date: '2025-07-01',
      end_date: null,
      shirt_number: 1,
      position: 'goalkeeper',
      on_loan: false,
    },
    spells: [],
    record: {
      coverage: 'limited',
      last_updated_at: null,
      data: [
        row(),
        row({ competition: { id: 'fr', name: 'Friendlies', short_name: null } }),
        row({ season: { id: 's1', label: '2025/26' }, starts: 17 }),
      ],
    },
    recent_matches: { coverage: 'available', last_updated_at: null, data: [match()] },
    availability: {
      team: { id: 'tractor', name: 'Tractor', short_name: null, basis: 'spell' },
      fixture: null,
      listing: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason: 'no_next_match',
    },
    last_updated_at: null,
    ...over,
  };
}

describe('the player page’s tabs', () => {
  it('reads ?tab= and keeps the season only where a tab filters by it', () => {
    expect(readPlayerTab({ tab: 'career' })).toBe('career');
    expect(readPlayerTab({ tab: 'nope' })).toBe('overview');
    expect(playerTabHref('en', PERSON, 'overview', 's1')).toBe(`/en/player/${PERSON}`);
    expect(playerTabHref('en', PERSON, 'career', 's1')).toBe(`/en/player/${PERSON}?tab=career`);
    expect(playerTabHref('fa', PERSON, 'stats', 's1')).toBe(
      `/fa/player/${PERSON}?tab=stats&season=s1`,
    );
  });

  it('takes the newest season’s first row for the tiles and names the rest', () => {
    const latest = latestSeason(page().record.data!);
    expect(latest?.row.competition.name).toBe('Persian Gulf Pro League');
    expect(latest?.others.map((r) => r.competition.name)).toEqual(['Friendlies']);
    expect(latestSeason([])).toBeNull();
    expect(spellsCoverage([])).toBe('not_supplied');
  });
});

describe('the player band', () => {
  const band = (p: PlayerPage, locale = 'en') =>
    renderToStaticMarkup(
      <PlayerBand page={p} locale={locale} tab="overview" seasonId={null} follow={null} />,
    );

  it('puts position and shirt above the name, the club in the identity line, compare and the tabs', () => {
    const html = band(page());
    expect(html).toContain('Goalkeeper · No. 1');
    expect(html).toMatch(/data-testid="title"[^>]*>Alireza Beiranvand</);
    expect(html).toMatch(/data-testid="current-team".*Tractor/);
    expect(html).toContain('data-testid="compare-with"');
    expect(html).toContain(`action="/en/player/${PERSON}/compare"`);
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="player-tab-overview"/);
    expect(html).toContain('bg-accent');
    expect(html).not.toMatch(/style="[^"]*(?:background|color)/);
  });

  it('says a birth date we do not hold is not supplied, never a guessed age', () => {
    const html = band(page());
    expect(html).toMatch(/Date of birth.*data-coverage-badge="not_supplied"/);
    const born = band(page({ person: { ...page().person, date_of_birth: '1992-09-21' } }));
    expect(born).not.toContain('Date of birth');
    expect(born).toContain('born 1992-09-21');
  });
});

describe('the season in tiles', () => {
  it('shows the newest season with its coverage and a dashed tile for minutes not supplied', () => {
    const html = renderToStaticMarkup(<SeasonTilesPanel page={page()} locale="en" />);
    expect(html).toContain('Pro League · 2026/27');
    expect(html).toMatch(/data-testid="tile-apps".*>7</);
    expect(html).toMatch(/data-testid="tile-minutes" data-coverage="not_supplied"/);
    expect(html).not.toMatch(/data-testid="tile-minutes"[^>]*>.*>0</);
    expect(html).toContain('data-coverage-badge="limited"');
    expect(html).toContain('Also this season: Friendlies');
  });

  it('shows minutes “at least” where only some matches carried them', () => {
    const limited = row({
      minutes: {
        coverage: 'limited',
        total: null,
        matches: 7,
        matches_with_minutes: 5,
        supplied_minutes: 450,
      },
    });
    const html = renderToStaticMarkup(
      <SeasonTilesPanel
        page={page({ record: { coverage: 'limited', last_updated_at: null, data: [limited] } })}
        locale="en"
      />,
    );
    expect(html).toContain('at least 450');
  });

  it('says there is no record instead of drawing noughts', () => {
    const html = renderToStaticMarkup(
      <SeasonTilesPanel
        page={page({ record: { coverage: 'not_supplied', last_updated_at: null, data: null } })}
        locale="en"
      />,
    );
    expect(html).toContain('data-testid="player-season-empty"');
    expect(html).not.toContain('data-testid="tile-');
    expect(html).toContain('data-coverage-badge="not_supplied"');
  });

  it('writes the tiles and the season in Persian digits on /fa', () => {
    const html = renderToStaticMarkup(<SeasonTilesPanel page={page()} locale="fa" />);
    expect(html).toContain('۲۰۲۶/۲۷');
    expect(html).toMatch(/data-testid="tile-apps".*>۷</);
  });
});

describe('the record', () => {
  it('has minutes and reds on the Stats tab only, with the record’s coverage', () => {
    const p = page();
    const full = renderToStaticMarkup(
      <RecordPanel page={p} rows={p.record.data!} locale="en" full testId="record" />,
    );
    expect(full).toContain('data-testid="record-minutes"');
    expect(full).toContain('Red');
    const short = renderToStaticMarkup(
      <RecordPanel
        page={p}
        rows={p.record.data!}
        locale="en"
        full={false}
        testId="career-record"
      />,
    );
    expect(short).not.toContain('record-minutes');
    expect(short.match(/data-testid="record-row"/g)).toHaveLength(3);
  });

  it('writes the seasons in Persian digits, and keeps the tab on the season pills', () => {
    const p = page();
    const html = renderToStaticMarkup(
      <RecordPanel page={p} rows={p.record.data!} locale="fa" full testId="record" />,
    );
    expect(html).toContain('۲۰۲۵/۲۶');
    const pills = renderToStaticMarkup(
      <SeasonFilter
        page={p}
        locale="en"
        tab="stats"
        seasons={[
          { id: 's2', label: '2026/27' },
          { id: 's1', label: '2025/26' },
        ]}
        seasonId="s1"
      />,
    );
    expect(pills).toContain(`href="/en/player/${PERSON}?tab=stats&amp;season=s1"`);
  });
});

describe('the matches', () => {
  it('keeps each score beside its own team on /fa, with his line and the coverage', () => {
    const p = page();
    const fa = renderToStaticMarkup(
      <PlayerMatchesPanel
        page={p}
        matches={p.recent_matches.data!}
        locale="fa"
        timeZone="Asia/Tehran"
      />,
    );
    expect(fa).toMatch(/Tractor.*dir="rtl"[^>]*data-testid="player-match-score">۳ – ۱<.*Esteghlal/);
    const en = renderToStaticMarkup(
      <PlayerMatchesPanel page={p} matches={p.recent_matches.data!} locale="en" timeZone="UTC" />,
    );
    expect(en).toContain('Started');
    expect(en).toContain('Yellow card');
    expect(en).toContain('data-coverage-badge="available"');
    const none = renderToStaticMarkup(
      <PlayerMatchesPanel page={p} matches={[]} locale="en" timeZone="UTC" />,
    );
    expect(none).toContain('data-testid="recent-matches-empty"');
  });
});

describe('the clubs and the availability', () => {
  it('says no spells are on record, with a not-supplied badge', () => {
    const html = renderToStaticMarkup(<SpellsPanel page={page()} locale="en" />);
    expect(html).toContain('No spells on record.');
    expect(html).toContain('data-coverage-badge="not_supplied"');
  });

  it('carries the listing’s coverage as a badge', () => {
    const html = renderToStaticMarkup(
      <PlayerAvailabilitySection
        locale="en"
        timeZone="UTC"
        availability={page().availability}
        now={new Date()}
      />,
    );
    expect(html).toContain('data-testid="player-availability"');
    expect(html).toContain('data-coverage-badge="not_supplied"');
  });
});

describe('logical properties only (rule 7)', () => {
  it('uses no physical left or right in the page or its components', () => {
    expect(PAGE).not.toMatch(PHYSICAL);
    expect(COMPONENT).not.toMatch(PHYSICAL);
  });
});
