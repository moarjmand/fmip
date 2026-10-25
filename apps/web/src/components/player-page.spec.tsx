import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerMatch, PlayerPage, PlayerSeasonRecord } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ageOn,
  goalsPer90,
  latestSeason,
  lineupTeam,
  playerTabHref,
  readPlayerTab,
  seasonGroups,
  seasonTotals,
  spellsCoverage,
} from '@/lib/player';

vi.mock('@/lib/auth-actions', () => ({
  followAction: async () => undefined,
  unfollowAction: async () => undefined,
}));

const {
  LastMatchesPanel,
  PlayerHeader,
  PlayerMatchesPanel,
  RecordPanel,
  SeasonFilter,
  SeasonTilesPanel,
  SpellsPanel,
} = await import('./player-page');
const { PlayerAvailabilitySection } = await import('./player-availability');

/**
 * The player page in the Stadiomind Design System (T-1500, D-271): the photo
 * in the club's ring, the facts (age, height, foot) each a figure or its
 * "not supplied" badge, the season in tiles with minutes never shown as a
 * zero, the career by season in its own scrolling box, the last six matches
 * and the next match, every module's coverage as a badge, and each score
 * beside its own team in Persian digits on `/fa`.
 */

const PERSON = '00000000-0000-4000-8000-000000000701';
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const HERE = __dirname;
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'player', '[id]', 'page.tsx'),
  'utf8',
);
const COMPONENT = readFileSync(join(HERE, 'player-page.tsx'), 'utf8');
const AVAILABILITY = readFileSync(join(HERE, 'player-availability.tsx'), 'utf8');

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

const WHOLE = {
  coverage: 'available',
  total: 551,
  matches: 7,
  matches_with_minutes: 7,
  supplied_minutes: 551,
} as const;

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
    expected_goals: null,
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

describe('the player page’s helpers', () => {
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

  it('groups the record by season in its order, and totals a season', () => {
    const groups = seasonGroups(page().record.data!);
    expect(groups.map((g) => [g.season.label, g.rows.length])).toEqual([
      ['2026/27', 2],
      ['2025/26', 1],
    ]);
    expect(seasonTotals([row({ goals: 2 }), row({ goals: 1, sub_appearances: 2 })])).toEqual({
      goals: 3,
      appearances: 16,
    });
  });

  it('rates goals per 90 only over whole minutes, never "at least" or a few off the bench', () => {
    expect(goalsPer90(4, WHOLE)?.toFixed(2)).toBe('0.65');
    expect(goalsPer90(1, { ...WHOLE, total: 30, supplied_minutes: 30 })).toBeNull();
    expect(goalsPer90(4, { ...WHOLE, coverage: 'limited', total: null })).toBeNull();
    expect(goalsPer90(4, row().minutes)).toBeNull();
  });
});

describe('the player header', () => {
  const header = (p: PlayerPage, locale = 'en') =>
    renderToStaticMarkup(
      <PlayerHeader page={p} locale={locale} tab="overview" seasonId={null} follow={null} />,
    );

  it('puts position and shirt above the name, the club in the identity line, compare and the tabs', () => {
    const html = header(page());
    expect(html).toContain('Goalkeeper · No. 1');
    expect(html).toMatch(/data-testid="title"[^>]*>Alireza Beiranvand</);
    expect(html).toMatch(/data-testid="current-team".*Tractor/);
    expect(html).toContain('data-testid="compare-with"');
    expect(html).toContain(`action="/en/player/${PERSON}/compare"`);
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="player-tab-overview"/);
  });

  it('rings the photo in the club’s colour, and in the theme’s line when it has none', () => {
    const none = header(page());
    expect(none).toMatch(/data-testid="photo-ring" data-ring="none"/);
    expect(none).toContain('border-strong');
    expect(none).not.toMatch(/style="[^"]*(?:background|color)/);
    const spell = page().current_spell!;
    const villa = header(
      page({ current_spell: { ...spell, team: { ...spell.team, colour: '#88002d' } } }),
    );
    expect(villa).toMatch(
      /style="border-color:#88002d"[^>]*data-testid="photo-ring" data-ring="club"/,
    );
  });

  it('names the team of his latest line-up, as a line-up, when no spell is open (T-1394)', () => {
    // No open spell, but he started for Liverpool on 11 October: "no current
    // team" beside that line-up was the contradiction the audit found.
    const latest = match({
      team: { id: 'liverpool', name: 'Liverpool' },
      fixture: { ...match().fixture, kickoff_at: '2026-10-11T15:30:00.000Z' },
    });
    const p = page({
      current_spell: null,
      recent_matches: { coverage: 'available', last_updated_at: null, data: [latest, match()] },
    });
    expect(lineupTeam(p)).toEqual({
      team: { id: 'liverpool', name: 'Liverpool' },
      day: '2026-10-11',
    });
    const html = header(p);
    expect(html).toMatch(
      /data-testid="current-team-lineup".*href="\/en\/team\/liverpool".*Liverpool/,
    );
    expect(html).toContain('from the latest line-up that names this player, 11 October 2026');
    expect(html).toContain('no current spell on record');
    expect(html).not.toContain('No current team on record');
    // In Persian, the sentence is the catalogue's and the date the Persian calendar's.
    const fa = header(p, 'fa');
    expect(fa).toContain('بر پایه‌ی آخرین ترکیبی که نام این بازیکن در آن آمده');
    expect(fa).not.toContain('2026-10-11');
  });

  it('keeps "no current team" when neither a spell nor a line-up names a team', () => {
    const none = page({
      current_spell: null,
      recent_matches: { coverage: 'not_supplied', last_updated_at: null, data: null },
    });
    expect(lineupTeam(none)).toBeNull();
    expect(header(none)).toContain('No current team on record');
    // An open spell is the answer; the line-up is not asked.
    expect(lineupTeam(page())).toBeNull();
  });

  it('says each fact we do not hold is not supplied, never a guessed value', () => {
    const html = header(page());
    for (const fact of ['age', 'height', 'foot']) {
      expect(html).toMatch(
        new RegExp(
          `data-testid="fact-${fact}" data-coverage="not_supplied">(?:(?!data-testid="fact-).)*data-coverage-badge="not_supplied"`,
        ),
      );
    }
    expect(html.match(/data-coverage-badge="not_supplied"/g)).toHaveLength(3);
    expect(html).not.toContain('cm');
    expect(html).not.toMatch(/(?:Left|Right|Either) foot/);
  });

  it('shows the facts we hold, with the birth date under the age, in the reader’s digits', () => {
    const held = page({
      person: {
        ...page().person,
        date_of_birth: '1992-06-15',
        height_cm: 175,
        preferred_foot: 'left',
      },
    });
    const age = ageOn('1992-06-15', new Date())!;
    const html = header(held);
    expect(html).toMatch(/data-testid="fact-age" data-coverage="available"/);
    expect(html).toContain(`>${age}<`);
    expect(html).toContain('born 15 June 1992');
    expect(html).toContain('175 cm');
    expect(html).toContain('Left foot');
    expect(html).not.toContain('data-coverage-badge');
    const fa = header(held, 'fa');
    expect(fa).toContain('۱۷۵ سانتی‌متر');
    expect(fa).toContain('چپ‌پا');
    expect(fa).not.toContain('>175');
  });
});

describe('the season in tiles', () => {
  it('shows a tile per competition, a season tile over them, and the record’s coverage', () => {
    const html = renderToStaticMarkup(<SeasonTilesPanel page={page()} locale="en" />);
    expect(html).toContain('Season 2026/27');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(html.match(/data-testid="tile-competition"/g)).toHaveLength(2);
    expect(html).toMatch(
      /data-testid="tile-season".*All competitions.*>0<.*Goals · 14 appearances/,
    );
    expect(html).toMatch(/Pro League.*Goals · 7 appearances · minutes not supplied/);
    expect(html).toContain('Friendlies');
  });

  it('says minutes the feed never sent are missing, and gives no rate per 90 from them', () => {
    const html = renderToStaticMarkup(<SeasonTilesPanel page={page()} locale="en" />);
    expect(html).toMatch(/data-testid="tile-competition" data-minutes="not_supplied"/);
    expect(html).not.toContain('per 90');
    expect(html).not.toMatch(/\b0 min\b/);
  });

  it('shows minutes “at least” where only some matches carried them, without a rate', () => {
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
    expect(html).toContain('at least 450 min');
    expect(html).not.toContain('per 90');
    // One row: no season tile repeating it.
    expect(html).not.toContain('data-testid="tile-season"');
  });

  it('gives the goals per 90 over whole minutes, and names the team when the season has two', () => {
    const club = row({ goals: 4, minutes: WHOLE });
    const country = row({
      competition: { id: 'afq', name: 'AFCON qualifying', short_name: null },
      team: { id: 'sen', name: 'Senegal' },
      goals: 1,
    });
    const html = renderToStaticMarkup(
      <SeasonTilesPanel
        page={page({
          record: { coverage: 'available', last_updated_at: null, data: [club, country] },
        })}
        locale="en"
      />,
    );
    expect(html).toContain('Goals · 7 appearances · 551 min · 0.65 per 90');
    expect(html).toContain('AFCON qualifying · Senegal');
    expect(html).toMatch(/AFCON qualifying · Senegal.*>1<.*Goals · /);
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
    expect(html).toMatch(/data-testid="tile-season".*۱۴/);
    expect(html).not.toMatch(/>[^<]*[0-9]/);
  });

  it('groups a large figure with the Persian separator (U+066C), never a Latin comma', () => {
    const full = row({
      minutes: {
        coverage: 'available',
        total: 2250,
        matches: 25,
        matches_with_minutes: 25,
        supplied_minutes: 2250,
      },
    });
    const p = page({ record: { coverage: 'available', last_updated_at: null, data: [full] } });
    const tiles = renderToStaticMarkup(<SeasonTilesPanel page={p} locale="fa" />);
    expect(tiles).toContain('۲٬۲۵۰');
    const table = renderToStaticMarkup(
      <RecordPanel page={p} rows={[full]} locale="fa" full testId="record" />,
    );
    expect(table).toContain('۲٬۲۵۰');
    expect(tiles + table).not.toMatch(/[۰-۹][,،][۰-۹]/);
  });
});

describe('the career by season', () => {
  const career = (p: PlayerPage, rows = p.record.data!) =>
    renderToStaticMarkup(
      <RecordPanel page={p} rows={rows} locale="en" full={false} testId="career-record" />,
    );

  it('heads each season’s rows with the season once, with substitute appearances and minutes', () => {
    const html = career(page());
    expect(html).toContain('Career by season');
    expect(html.match(/data-testid="record-row"/g)).toHaveLength(3);
    expect(html.match(/scope="rowgroup"/g)).toHaveLength(2);
    expect(html).toMatch(/scope="rowgroup" rowSpan="2"[^>]*><bdi>2026\/27/);
    expect(html).toContain('>Sub<');
    expect(html).toContain('data-testid="record-minutes"');
    expect(html).not.toContain('>Red<');
    expect(html).toContain('data-coverage-badge="limited"');
  });

  it('scrolls in its own named, focusable box, so the page never scrolls sideways', () => {
    const html = career(page());
    expect(html).toMatch(
      /class="overflow-x-auto[^"]*" role="region" aria-labelledby="career-record-caption" tabindex="0"/,
    );
    expect(html).toContain(
      '<caption id="career-record-caption" class="sr-only">Alireza Beiranvand: career by season and competition</caption>',
    );
    expect(html).toContain('min-w-[40rem]');
  });

  it('has the cards on the Stats tab, and says why a season shows nothing', () => {
    const p = page();
    const full = renderToStaticMarkup(
      <RecordPanel page={p} rows={p.record.data!} locale="en" full testId="record" />,
    );
    expect(full).toContain('>Yellow<');
    expect(full).toContain('>Red<');
    const empty = renderToStaticMarkup(
      <RecordPanel page={p} rows={[]} locale="en" full testId="record" />,
    );
    expect(empty).toContain('Nothing on record for this season.');
    expect(empty).not.toContain('<table');
    const none = career(
      page({ record: { coverage: 'not_supplied', last_updated_at: null, data: null } }),
      [],
    );
    expect(none).toContain('No line-ups on record for this player');
    expect(none).toContain('data-coverage-badge="not_supplied"');
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
  it('lists the last matches with his goals and assists, a dash when none, and the coverage', () => {
    const p = page();
    const matches = [
      match({ goals: 2, assists: 0 }),
      match({
        fixture: { ...match().fixture, id: 'f2' },
        assists: 0,
        role: 'bench',
        came_on: false,
      }),
    ];
    const html = renderToStaticMarkup(
      <LastMatchesPanel page={p} matches={matches} locale="en" timeZone="UTC" />,
    );
    expect(html.match(/data-testid="player-match"/g)).toHaveLength(2);
    expect(html).toMatch(/data-testid="player-match-contribution">2 goals</);
    expect(html).toMatch(/data-testid="player-match-contribution">–</);
    expect(html).toContain('Unused sub');
    expect(html).toContain('8 Oct');
    expect(html).toContain('data-coverage-badge="available"');
    const fa = renderToStaticMarkup(
      <LastMatchesPanel page={p} matches={matches} locale="fa" timeZone="Asia/Tehran" />,
    );
    expect(fa).toMatch(/Tractor.*dir="rtl"[^>]*data-testid="player-match-score">۳–۱<.*Esteghlal/);
    const none = renderToStaticMarkup(
      <LastMatchesPanel
        page={page({
          recent_matches: { coverage: 'not_supplied', last_updated_at: null, data: null },
        })}
        matches={[]}
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(none).toContain('data-testid="recent-matches-empty"');
    expect(none).toContain('data-coverage-badge="not_supplied"');
  });

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
    expect(fa).toMatch(/Tractor.*dir="rtl"[^>]*data-testid="player-match-score">۳–۱<.*Esteghlal/);
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

  it('labels a match’s expected goals with their source, and shows nothing it did not supply (T-1432)', () => {
    const p = page();
    const withXg = [
      match({ expected_goals: { source: 'highlightly', figures: { xg: 0.38, xa: 0.1 } } }),
      match({ expected_goals: { source: 'highlightly', figures: { xa: 0.05 } } }),
      match(),
    ];
    const en = renderToStaticMarkup(
      <PlayerMatchesPanel page={p} matches={withXg} locale="en" timeZone="UTC" />,
    );
    const lines = en
      .split('data-testid="player-match-xg"')
      .slice(1)
      .map((line) => line.slice(0, line.indexOf('</li>')));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('xG (Highlightly)');
    expect(lines[0]).toContain('0.38');
    expect(lines[0]).toContain('0.10');
    expect(en).not.toContain('xGOT');
    // No xG supplied: a dash, never 0.00.
    expect(lines[1]).toContain(' –');
    expect(lines.join('')).not.toContain('0.00');
    const fa = renderToStaticMarkup(
      <PlayerMatchesPanel page={p} matches={withXg.slice(0, 1)} locale="fa" timeZone="UTC" />,
    );
    expect(fa).toContain('۰٫۳۸');
  });
});

describe('the clubs and the next match', () => {
  it('says no spells are on record, with a not-supplied badge', () => {
    const html = renderToStaticMarkup(<SpellsPanel page={page()} locale="en" />);
    expect(html).toContain('No spells on record.');
    expect(html).toContain('data-coverage-badge="not_supplied"');
  });

  it('heads the card with the next match and carries the listing’s coverage as a badge', () => {
    const html = renderToStaticMarkup(
      <PlayerAvailabilitySection
        locale="en"
        timeZone="UTC"
        availability={page().availability}
        now={new Date()}
      />,
    );
    expect(html).toContain('data-testid="player-availability"');
    expect(html).toMatch(/<h2[^>]*>Next match</);
    expect(html).toContain('data-coverage-badge="not_supplied"');
  });
});

describe('logical properties only (rule 7)', () => {
  it('uses no physical left or right in the page or its components', () => {
    expect(PAGE).not.toMatch(PHYSICAL);
    expect(COMPONENT).not.toMatch(PHYSICAL);
    expect(AVAILABILITY).not.toMatch(PHYSICAL);
  });
});
