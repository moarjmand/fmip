import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  FollowedEntity,
  SquadPlayer,
  TeamCompetitionSplits,
  TeamPage,
  TeamPageFixture,
} from '@fmip/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  guestFollowHref,
  homeAwayLean,
  readTeamTab,
  squadIncomplete,
  teamTabHref,
} from '@/lib/team';

// The server actions need a request; the component only binds them.
vi.mock('@/lib/auth-actions', () => ({
  followAction: async () => undefined,
  unfollowAction: async () => undefined,
}));

const { ClubBand, ClubFacts, FixturesPanel, NoNextMatch, SquadPanel, TeamMatchRow } =
  await import('./club-page');
const { AroundThem, ComingUp, RecentResults, RecordPanel, SquadCard, TopScorerCard } =
  await import('./club-overview');
const { CardFollow, EntityFollow } = await import('./competition-page');
const { NextMatchCard } = await import('./next-match-card');

/**
 * The club page (T-1386, D-204; the Stadiomind Club board since T-1499,
 * D-276): the surface band when no club colour is known, where the club
 * stands at its end, the tabs as links, the recent results and the home and
 * away record with every missing figure said, each score in Persian digits
 * on `/fa`, the top scorer, the squad with its coverage, the table around
 * the club, and nothing drawn as if it had data it does not.
 */

const TEAM = '00000000-0000-4000-8000-000000000601';
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const HERE = __dirname;
const PAGE = readFileSync(join(HERE, '..', 'app', '[locale]', 'team', '[id]', 'page.tsx'), 'utf8');
const COMPONENT = readFileSync(join(HERE, 'club-page.tsx'), 'utf8');
const OVERVIEW = readFileSync(join(HERE, 'club-overview.tsx'), 'utf8');
const BAND = readFileSync(join(HERE, 'entity-band.tsx'), 'utf8');

function fixture(over: Partial<TeamPageFixture> = {}): TeamPageFixture {
  return {
    id: '00000000-0000-4000-8000-00000000f001',
    kickoff_at: '2026-10-08T14:00:00.000Z',
    status: 'finished',
    round: 'Regular Season - 8',
    stage: null,
    home: { id: TEAM, name: 'Tractor', short_name: null },
    away: { id: 'esteghlal', name: 'Esteghlal', short_name: null },
    score: { home: 2, away: 1 },
    competition: { id: 'pgpl', name: 'Persian Gulf Pro League', short_name: 'Pro League' },
    season: { id: 's1', label: '2026/27' },
    after_extra_time: false,
    penalties: null,
    ...over,
  };
}

const recordOf = (played: number) => ({
  played,
  won: 5,
  drawn: 2,
  lost: 1,
  goals_for: 9,
  goals_against: 2,
  clean_sheets: 6,
});

function splits(over: Partial<TeamCompetitionSplits> = {}): TeamCompetitionSplits {
  return {
    competition: { id: 'pgpl', name: 'Persian Gulf Pro League', short_name: 'Pro League' },
    season: { id: 's1', label: '2026/27', is_current: true },
    home: recordOf(4),
    away: recordOf(4),
    total: recordOf(8),
    penalty_shootouts: 0,
    finished_without_score: 0,
    averages: [],
    last_updated_at: null,
    ...over,
  };
}

function player(over: Partial<SquadPlayer> = {}): SquadPlayer {
  return {
    person: { id: 'p1', name: 'Alireza Beiranvand' },
    shirt_number: 1,
    position: 'goalkeeper',
    on_loan: false,
    since: '2025-07-01',
    minutes: {
      coverage: 'available',
      total: 630,
      matches: 7,
      matches_with_minutes: 7,
      supplied_minutes: 630,
    },
    ...over,
  };
}

function page(over: Partial<TeamPage> = {}): TeamPage {
  return {
    team: {
      id: TEAM,
      name: 'Tractor',
      localised_name: null,
      short_name: null,
      code: null,
      kind: 'club',
      gender: 'men',
      age_group: 'senior',
      founded_year: 1970,
      country: { id: 'ir', name: 'Iran', code: 'IR' },
      venue: { id: 'v', name: 'Yadegar-e-Emam Stadium', city: 'Tabriz', capacity: 66833 },
    },
    competitions: [
      {
        competition: { id: 'pgpl', name: 'Persian Gulf Pro League', short_name: 'Pro League' },
        season: { id: 's1', label: '2026/27', is_current: true },
        context: {
          coverage: 'limited',
          last_updated_at: null,
          data: {
            position: 1,
            total: 16,
            points: 17,
            rows: [
              {
                position: 1,
                team: { id: TEAM, name: 'Tractor', short_name: null },
                played: 8,
                won: 5,
                drawn: 2,
                lost: 1,
                goals_for: 9,
                goals_against: 2,
                goal_difference: 7,
                points: 17,
                form: [],
              },
            ],
          },
        },
      },
    ],
    next_match: null,
    previous_match: null,
    fixtures: [],
    results: [],
    squad: { coverage: 'limited', last_updated_at: null, data: [player()] },
    splits: [splits()],
    manager: {
      coach: { coverage: 'not_supplied', last_updated_at: null, data: null },
      lineup_fixture: null,
    },
    followers: 12,
    last_updated_at: null,
    ...over,
  };
}

describe('the club page’s tabs', () => {
  it('reads ?tab= and falls back to the Overview', () => {
    expect(readTeamTab({ tab: 'squad' })).toBe('squad');
    expect(readTeamTab({ tab: ['results', 'squad'] })).toBe('results');
    expect(readTeamTab({ tab: 'history' })).toBe('overview');
    expect(readTeamTab({})).toBe('overview');
    expect(teamTabHref('fa', TEAM, 'overview')).toBe(`/fa/team/${TEAM}`);
    expect(teamTabHref('en', TEAM, 'stats')).toBe(`/en/team/${TEAM}?tab=stats`);
  });
});

describe('the club band', () => {
  const band = (p: TeamPage, locale = 'en', territory?: string) =>
    renderToStaticMarkup(
      <ClubBand
        page={p}
        locale={locale}
        timeZone="Asia/Tehran"
        tab="overview"
        follow={null}
        territory={territory}
      />,
    );

  it('names the club, its ground, followers, standing and the open tab, on the surface with no colour', () => {
    const html = band(page());
    expect(html).toContain('Iran · Club · Founded 1970');
    expect(html).toMatch(/data-testid="title"[^>]*>Tractor</);
    expect(html).toContain('Yadegar-e-Emam Stadium, Tabriz');
    expect(html).toContain('12 followers');
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="team-tab-overview"/);
    expect(html).toContain(`href="/en/team/${TEAM}?tab=squad"`);
    // No club colour known: the surface band (T-1499).
    expect(html).toContain('data-band="surface"');
    // The open section tab: ink over the saffron rule (T-1510).
    expect(html).toContain('border-accent font-extrabold text-fg');
    // Where the club stands, at the end of the band: the place and its points.
    expect(html).toMatch(/data-testid="band-standing".*Pro League.*>1st<.*17 pts from 8/);
    expect(html).not.toMatch(/style="[^"]*(?:background|color)/);
    // A club colour fills the band and nothing else on it is painted (D-204).
    const coloured = band(page({ team: { ...page().team, colour: '#88002d' } }));
    expect(coloured).toContain('data-band="club"');
    expect(coloured.match(/background-color/g)).toHaveLength(1);
    // No table places the club: no standing, never a place of nought.
    const unplaced = page({
      competitions: [
        {
          ...page().competitions[0]!,
          context: { coverage: 'not_supplied', last_updated_at: null, data: null },
        },
      ],
    });
    expect(band(unplaced)).not.toContain('band-standing');
    // The manager line says why there is no name instead of inventing one.
    expect(html).toContain('data-testid="manager-none"');
  });

  it('isolates the ground, its capacity and the followers, so a Latin name keeps its place on /fa (T-1561)', () => {
    const latin = page({
      team: {
        ...page().team,
        venue: { id: 'v', name: 'Anfield', city: 'Liverpool', capacity: 61276 },
      },
    });
    const fa = band(latin, 'fa');
    expect(fa).toMatch(/<bdi data-testid="team-ground">Anfield، Liverpool<\/bdi>/);
    expect(fa).toContain('<bdi>۶۱٬۲۷۶</bdi>');
    expect(fa).toMatch(/<bdi data-testid="followers">[^<]*۱۲/);
  });

  it('with no ground recorded, says where this season’s home matches were played (T-1394)', () => {
    // A match names Anfield while the club page said "not recorded": the
    // fixtures' ground, labelled as theirs, with how many it covers.
    const noGround = { ...page().team, venue: null };
    const html = band(
      page({
        team: noGround,
        fixture_ground: {
          venue: { id: 'anfield', name: 'Anfield', city: 'Liverpool' },
          matches: 3,
          home_matches: 3,
        },
      }),
    );
    expect(html).toMatch(/data-testid="fixture-ground"[^>]*>Anfield, Liverpool \(home matches/);
    expect(html).toContain('home matches this season: 3 of 3; no home ground recorded');
    expect(html).not.toContain('Home ground not recorded');
    const fa = band(
      page({
        team: noGround,
        fixture_ground: {
          venue: { id: 'anfield', name: 'Anfield', city: 'Liverpool' },
          matches: 2,
          home_matches: 3,
        },
      }),
      'fa',
    );
    expect(fa).toContain('بازی‌های خانگی این فصل: ۲ از ۳');
    // No fixture names a ground either: "not recorded", never a guess.
    expect(band(page({ team: noGround, fixture_ground: null }))).toContain(
      'Home ground not recorded',
    );
  });

  it('keeps a guest’s territory on the tab links', () => {
    expect(band(page(), 'en', 'IR')).toContain(
      `href="/en/team/${TEAM}?tab=fixtures&amp;territory=IR"`,
    );
  });

  it('groups the capacity and the followers with the Persian separator (U+066C), never a Latin comma', () => {
    const html = band(page({ followers: 1243 }), 'fa');
    expect(html).toContain('۶۶٬۸۳۳');
    expect(html).toContain('۱٬۲۴۳');
    // No Latin comma (or Arabic comma) between two Persian digits anywhere in the band.
    expect(html).not.toMatch(/[۰-۹][,،][۰-۹]/);
    expect(band(page({ followers: 1243 }))).toContain('1,243 followers');
  });

  it('writes the founding year and the capacity in Persian digits on /fa', () => {
    const html = band(page({ team: { ...page().team, localised_name: 'تراکتور' } }), 'fa');
    expect(html).toContain('۱۹۷۰');
    expect(html).toContain('۶۶٬۸۳۳');
    expect(html).toContain('data-testid="canonical-name">Tractor<');
    expect(html).not.toMatch(/1970/);
    expect(html).toContain('۱۷ امتیاز از ۸ بازی');
  });
});

describe('following the club', () => {
  it('posts a team follow, and says when the follows cannot be read', () => {
    const off = renderToStaticMarkup(
      <EntityFollow
        locale="en"
        entityType="team"
        entityId={TEAM}
        signedIn
        following={[]}
        followingKey="teamPage.follow.following"
        unreachableKey="teamPage.follow.unreachable"
      />,
    );
    expect(off).toContain('value="team"');
    expect(off).toContain('data-testid="team-follow"');
    const on = renderToStaticMarkup(
      <EntityFollow
        locale="en"
        entityType="team"
        entityId={TEAM}
        signedIn
        following={[{ entity_type: 'team', entity_id: TEAM } as FollowedEntity]}
        followingKey="teamPage.follow.following"
        unreachableKey="teamPage.follow.unreachable"
      />,
    );
    expect(on).toContain('You follow this team');
    const unknown = renderToStaticMarkup(
      <EntityFollow
        locale="en"
        entityType="team"
        entityId={TEAM}
        signedIn
        following={null}
        followingKey="teamPage.follow.following"
        unreachableKey="teamPage.follow.unreachable"
      />,
    );
    expect(unknown).toContain('data-testid="team-follow-unreachable"');
    expect(unknown).not.toContain('<form');
  });
});

describe('the next match', () => {
  it('names the round in our words, never the feed’s text', () => {
    const card = (round: string, locale: string) =>
      renderToStaticMarkup(
        <NextMatchCard
          fixture={fixture({ status: 'scheduled', score: null, round })}
          forecast={{ state: 'none' }}
          viewing={null}
          locale={locale}
          timeZone="Asia/Tehran"
        />,
      );
    // A round we can name is in the reader's words; one we cannot is left out (D-193).
    const fa = card('Regular Season - 9', 'fa');
    expect(fa).not.toContain('Regular Season');
    expect(fa).toContain('۹');
    expect(card('Mystery Bracket Z', 'en')).not.toContain('Mystery Bracket');
    expect(card('Regular Season - 9', 'en')).toContain('No model forecast for this match yet.');
  });

  it('is a heading of its own, as every other card is (T-1563)', () => {
    const html = renderToStaticMarkup(
      <NextMatchCard
        fixture={fixture({ status: 'scheduled', score: null })}
        forecast={{ state: 'none' }}
        viewing={null}
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(html).toMatch(/<article aria-labelledby="next-match-heading"/);
    expect(html).toMatch(/<h2 id="next-match-heading"[^>]*>Next match<\/h2>/);
  });

  it('says there is none rather than leaving the top of the page blank', () => {
    expect(renderToStaticMarkup(<NoNextMatch locale="en" />)).toContain('No match scheduled.');
  });
});

describe('from the next match to a pick (T-1741, D-362)', () => {
  const KICKOFF = '2026-11-07T15:00:00.000Z';
  const BEFORE = Date.parse('2026-11-07T09:00:00.000Z');
  const AFTER = Date.parse('2026-11-07T15:05:00.000Z');
  const FORECAST = {
    state: 'available' as const,
    home: 60.8,
    draw: 27.8,
    away: 11.4,
    version: 3,
    model_version: 'dixon-coles-elo@0.6.0',
    computed_at: '2026-11-02T15:10:00.000Z',
  };
  const card = (
    over: Partial<TeamPageFixture> = {},
    now: number | undefined = BEFORE,
    follow?: ReactNode,
    locale = 'en',
  ) =>
    renderToStaticMarkup(
      <NextMatchCard
        fixture={fixture({ status: 'scheduled', score: null, kickoff_at: KICKOFF, ...over })}
        forecast={FORECAST}
        viewing={null}
        locale={locale}
        timeZone="Europe/London"
        now={now}
        follow={follow}
      />,
    );
  const guestFollow = (
    <CardFollow
      locale="en"
      entityType="team"
      entityId={TEAM}
      signedIn={false}
      following={null}
      followingKey="teamPage.follow.following"
      guestHref={guestFollowHref('en', TEAM)}
    />
  );
  const memberFollow = (following: FollowedEntity[] | null) =>
    renderToStaticMarkup(
      <CardFollow
        locale="en"
        entityType="team"
        entityId={TEAM}
        signedIn
        following={following}
        followingKey="teamPage.follow.following"
        guestHref={guestFollowHref('en', TEAM)}
      />,
    );

  it('ends the card in "Make your pick", an outlined link to the match page’s pick card', () => {
    const html = card();
    const pick = /<a[^>]*data-testid="next-match-pick"[^>]*>/.exec(html)?.[0] ?? '';
    expect(pick).toContain(`href="/en/match/00000000-0000-4000-8000-00000000f001#pick"`);
    // Secondary, in the saffron edge and ink; the fill stays the primary's.
    expect(pick).toContain('border-accent');
    expect(pick).toContain('text-accent');
    expect(pick).not.toContain('bg-brand');
    expect(pick).toContain('min-h-touch');
    expect(html).toContain('>Make your pick<');
    // A link, not the pick control: no outcome buttons on this card.
    expect(html).not.toContain('aria-pressed');
    expect(card({}, BEFORE, undefined, 'fa')).toContain(
      'href="/fa/match/00000000-0000-4000-8000-00000000f001#pick"',
    );
  });

  it('offers the pick only while the match has not kicked off', () => {
    // The kick-off has passed by the clock, though the status has not moved yet.
    expect(card({}, AFTER)).not.toContain('next-match-pick');
    // Under way, or over, by the match's own status.
    expect(card({ status: 'live' })).not.toContain('next-match-pick');
    expect(card({ status: 'finished', score: { home: 1, away: 0 } })).not.toContain(
      'next-match-pick',
    );
    // With neither a pick nor a follow there is no empty row of actions.
    expect(card({ status: 'live' })).not.toContain('next-match-actions');
    // Follow does not depend on the kick-off.
    expect(card({ status: 'live' }, BEFORE, guestFollow)).toContain('team-card-follow-guest');
  });

  it('keeps the percentages the model’s: in its box, each beside its side’s name, with the version', () => {
    const html = card();
    const box = /data-testid="next-match-model".*?data-testid="next-match-actions"/s.exec(html);
    expect(box).not.toBeNull();
    const words = (box?.[0] ?? '').replace(/<[^>]+>/g, '');
    expect(words).toContain('Model');
    expect(words).toMatch(/Tractor\s*60\.8%/);
    expect(words).toMatch(/Draw\s*27\.8%/);
    expect(words).toMatch(/Esteghlal\s*11\.4%/);
    expect(words).toContain('dixon-coles-elo@0.6.0');
    // The model's tag is the turquoise outline; nothing of it is saffron.
    expect(box?.[0]).toContain('border-model');
    expect(box?.[0]).not.toContain('bg-brand');
    // And nothing outside the box is a percentage.
    expect(html.replace(box?.[0] ?? '', '')).not.toMatch(/\d+(\.\d)?%/);
  });

  it('sends a guest’s Follow to sign-in with the way back in next, a same-origin path', () => {
    const html = card({}, BEFORE, guestFollow);
    const link = /<a[^>]*data-testid="team-card-follow-guest"[^>]*>/.exec(html)?.[0] ?? '';
    const href = /href="([^"]*)"/.exec(link)?.[1];
    expect(href).toBe(`/en/login?next=${encodeURIComponent(`/en/team/${TEAM}`)}`);
    const next = new URL(href ?? '', 'https://stadiomind.test').searchParams.get('next');
    expect(next).toBe(`/en/team/${TEAM}`);
    expect(next).not.toMatch(/^\/\/|:/);
    expect(guestFollowHref('fa', TEAM)).toBe(
      `/fa/login?next=${encodeURIComponent(`/fa/team/${TEAM}`)}`,
    );
    // Beside the pick, in one row.
    expect(html).toMatch(
      /data-testid="next-match-actions".*next-match-pick.*team-card-follow-guest/s,
    );
  });

  it('gives a member the band’s follow action, says so once following, and nothing when unreadable', () => {
    const off = memberFollow([]);
    expect(off).toContain('data-testid="team-card-follow"');
    expect(off).toContain('value="team"');
    expect(off).toContain(`value="${TEAM}"`);
    expect(off).toContain('type="submit"');
    const on = memberFollow([{ entity_type: 'team', entity_id: TEAM } as FollowedEntity]);
    expect(on).toContain('data-testid="team-card-following"');
    expect(on).toContain('You follow this team');
    expect(on).not.toContain('<form');
    expect(memberFollow(null)).toBe('');
    // On a phone the member keeps the band's control, so the card adds no second one there.
    expect(off).toMatch(/<form[^>]*class="max-md:hidden"/);
    expect(on).toContain('max-md:hidden');
  });
});

describe('the band on a phone (T-1741, D-362)', () => {
  const band = (p: TeamPage, followOnCard = false) =>
    renderToStaticMarkup(
      <ClubBand
        page={p}
        locale="en"
        timeZone="Asia/Tehran"
        tab="overview"
        follow={<span data-testid="the-follow" />}
        followOnCard={followOnCard}
        territory={undefined}
      />,
    );

  it('is one row below 768px: the crest, the name and where the club stands on one line', () => {
    const html = band(page());
    expect(html).toContain('data-phone="compact"');
    // The crest spans the name and the standing line beside it.
    expect(html).toMatch(/<span class="[^"]*max-md:row-span-2[^"]*"/);
    // The standing as one line with its separators, stacked again from 768px.
    const standing = /<div[^>]*data-testid="band-standing">.*?<\/div>/s.exec(html)?.[0] ?? '';
    expect(standing.replace(/<[^>]+>/g, '')).toBe('Pro League·1st·17 pts from 8');
    expect(standing.match(/aria-hidden="true" class="[^"]*md:hidden[^"]*"/g)).toHaveLength(2);
    // The eyebrow, the ground and the coach leave the band on a phone and stay in it from 768px.
    expect(html).toMatch(/<p class="[^"]*max-md:hidden[^"]*" data-testid="band-eyebrow"/);
    expect(html).toMatch(/<div class="max-md:hidden">.*data-testid="team-ground"/s);
    expect(html).toMatch(/<div class="max-md:hidden">.*data-testid="manager"/s);
    // The name is never left out.
    expect(html).toMatch(/data-testid="title"[^>]*>Tractor</);
    expect(BAND).not.toMatch(PHYSICAL);
  });

  it('leaves the band’s follow out on a phone only when the next-match card carries it', () => {
    expect(band(page(), true)).toMatch(
      /<div class="[^"]*max-md:hidden[^"]*"><span data-testid="the-follow"/,
    );
    expect(band(page(), false)).not.toMatch(
      /<div class="[^"]*max-md:hidden[^"]*"><span data-testid="the-follow"/,
    );
    // A guest's Follow is on the card only where there is a card: the Overview with a next match.
    expect(PAGE).toContain('followOnCard={overview && page.next_match !== null && me === null}');
  });

  it('shows what the band left out as a card under the next match, in the same words', () => {
    const html = renderToStaticMarkup(
      <ClubFacts page={page()} locale="en" timeZone="Asia/Tehran" />,
    );
    // Phones only: from 768px the band has them.
    expect(html).toMatch(/<section[^>]*class="[^"]*md:hidden[^"]*"[^>]*data-testid="club-facts"/);
    expect(html).toMatch(/<h2 id="club-facts-heading"[^>]*>Team details<\/h2>/);
    expect(html).toContain('Iran · Club · Founded 1970');
    expect(html).toMatch(/data-testid="facts-team-ground">Yadegar-e-Emam Stadium, Tabriz</);
    expect(html).toContain('12 followers');
    expect(html).toContain('data-testid="facts-manager-none"');
    // Its ids are its own, so the band's stay the only ones of their name.
    expect(html).not.toMatch(/data-testid="(team-ground|followers|manager|head-coach)"/);
    expect(html).not.toMatch(PHYSICAL);
    // Placed after the next match on the Overview, and after the tab's content elsewhere.
    expect(PAGE).toMatch(/<NextMatchCard[\s\S]*?<ClubFacts[\s\S]*?<RecentResults/);
    expect(PAGE).toContain('{!overview && <ClubFacts');
  });
});

describe('the home and away record', () => {
  const show = (p: TeamPage, locale = 'en') =>
    renderToStaticMarkup(<RecordPanel page={p} locale={locale} />);

  it('draws a row per split and a column per figure, with tiles and a sentence for phones', () => {
    const html = show(
      page({
        splits: [
          splits({
            home: { ...recordOf(4), won: 1, drawn: 1, lost: 2 },
            away: { ...recordOf(4), won: 2, drawn: 1, lost: 1 },
          }),
        ],
      }),
    );
    expect(html).toContain('Pro League so far');
    expect(html).toMatch(/<caption[^>]*>Home and away record of Tractor in Pro League</);
    expect(html).toMatch(/data-testid="record-home".*?Home.*?>4<.*?>1<.*?>1<.*?>2</);
    expect(html).toContain('data-testid="record-total"');
    expect(html).toMatch(/data-testid="record-tiles".*?>5-2-1</);
    expect(html).toContain('Better away (7 pts from 4) than at home (4 pts from 4).');
  });

  it('says what is missing instead of a row of noughts', () => {
    const none = show(page({ splits: [splits({ total: recordOf(0) })] }));
    expect(none).toContain('data-testid="record-empty"');
    expect(none).not.toContain('record-tiles');
    expect(show(page({ competitions: [], splits: [] }))).toContain(
      'No current competition on record.',
    );
  });

  it('reads won-drawn-lost from the start of the line in Persian, in Persian digits', () => {
    const html = show(page(), 'fa');
    expect(html).toContain('۲۰۲۶/۲۷');
    expect(html).toMatch(/dir="rtl"[^>]*>۵-۲-۱</);
    expect(html).not.toMatch(/>5-/);
  });

  it('weighs points per match, home against away', () => {
    const level = splits({
      home: { ...recordOf(2), won: 1, drawn: 0, lost: 1 },
      away: { ...recordOf(2), won: 1, drawn: 0, lost: 1 },
    });
    expect(homeAwayLean('en', level)).toBe(
      'As good away (3 pts from 2) as at home (3 pts from 2).',
    );
    expect(homeAwayLean('en', splits({ away: recordOf(0) }))).toBeNull();
  });
});

describe('a club’s match row', () => {
  const row = (f: TeamPageFixture, locale = 'en') =>
    renderToStaticMarkup(
      <ul>
        <TeamMatchRow fixture={f} teamId={TEAM} locale={locale} timeZone="Asia/Tehran" />
      </ul>,
    );

  it('puts the score between the sides, home first, and the result from the club’s side', () => {
    const en = row(fixture());
    expect(en).toMatch(/Tractor.*dir="ltr"[^>]*data-testid="match-score">2 – 1<.*Esteghlal/);
    expect(en).toMatch(/data-result="W"/);
    const away = row(fixture({ home: fixture().away, away: fixture().home }));
    expect(away).toMatch(/data-result="L"/);
  });

  it('keeps each score beside its own team on /fa, in Persian digits', () => {
    const fa = row(fixture(), 'fa');
    // Home first in the DOM; the pair right to left, so its two sits on the home side.
    expect(fa).toMatch(/Tractor.*dir="rtl"[^>]*data-testid="match-score">۲ – ۱<.*Esteghlal/);
  });

  it('has no result letter for a match not played', () => {
    const html = row(fixture({ status: 'scheduled', score: null }));
    expect(html).not.toContain('data-testid="result-letter"');
    expect(html).toContain('>v<');
  });
});

describe('recent results and coming up', () => {
  it('lists six results from the club’s side, its goals first, with the form for phones', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      // Every other one away, a 2–1 win there: the club's goals still first.
      i % 2 === 1
        ? fixture({
            id: `r${i}`,
            home: fixture().away,
            away: fixture().home,
            score: { home: 1, away: 2 },
          })
        : fixture({ id: `r${i}` }),
    );
    const html = renderToStaticMarkup(
      <RecentResults page={page({ results: many })} locale="en" timeZone="Asia/Tehran" />,
    );
    expect(html.match(/data-testid="match-line"/g)).toHaveLength(6);
    expect(html).toContain('v Esteghlal');
    expect(html).toContain('at Esteghlal');
    expect(html.match(/data-testid="match-score">2–1</g)).toHaveLength(6);
    expect(html).toContain('aria-label="Form, newest first: Won, Won, Won, Won, Won and Won"');
    expect(html).toContain(`href="/en/team/${TEAM}?tab=results"`);
    const none = renderToStaticMarkup(<RecentResults page={page()} locale="en" timeZone="UTC" />);
    expect(none).toContain('data-testid="recent-results-empty"');
  });

  it('lists the matches after the next one in the reader’s zone, and says when there are none', () => {
    const next = fixture({ id: 'n0', status: 'scheduled', score: null });
    const later = Array.from({ length: 6 }, (_, i) =>
      fixture({ id: `n${i + 1}`, status: 'scheduled', score: null }),
    );
    const html = renderToStaticMarkup(
      <ComingUp
        page={page({ next_match: next, fixtures: [next, ...later] })}
        locale="en"
        timeZone="Asia/Tehran"
        territory="IR"
        freshness={null}
      />,
    );
    expect(html.match(/data-testid="match-line"/g)).toHaveLength(4);
    expect(html).not.toContain('/match/n0"');
    expect(html).toContain('Tehran time');
    expect(html).toContain(`href="/en/team/${TEAM}?tab=fixtures&amp;territory=IR"`);
    const none = renderToStaticMarkup(
      <ComingUp
        page={page({ next_match: next, fixtures: [next] })}
        locale="en"
        timeZone="UTC"
        territory={undefined}
        freshness={null}
      />,
    );
    expect(none).toContain('data-testid="coming-up-empty"');
  });

  it('leaves out a cancelled or postponed match, which the Fixtures tab lists without where to watch it (T-1560)', () => {
    const next = fixture({ id: 'n0', status: 'scheduled', score: null });
    const called = fixture({ id: 'gone', status: 'cancelled', score: null });
    const moved = fixture({ id: 'moved', status: 'postponed', score: null });
    const later = fixture({ id: 'n1', status: 'scheduled', score: null });
    const p = page({ next_match: next, fixtures: [called, next, moved, later] });
    const html = renderToStaticMarkup(
      <ComingUp page={p} locale="en" timeZone="UTC" territory={undefined} freshness={null} />,
    );
    expect(html.match(/data-testid="match-line"/g)).toHaveLength(1);
    expect(html).toContain('/match/n1"');
    expect(html).not.toContain('/match/gone"');
    expect(html).not.toContain('/match/moved"');
    // The rest are a click away on the Fixtures tab.
    expect(html).toContain(`href="/en/team/${TEAM}?tab=fixtures"`);
    const tab = renderToStaticMarkup(
      <FixturesPanel
        page={p}
        locale="en"
        timeZone="UTC"
        viewing={new Map()}
        signedIn={false}
        territory={undefined}
        freshness={null}
      />,
    );
    expect(tab.match(/data-testid="match-line"/g)).toHaveLength(4);
    expect(tab.match(/data-testid="viewing-line"/g)).toHaveLength(2);
  });

  it('leaves out a match still scheduled long after its kick-off, which the Fixtures tab labels (T-1710, D-343)', () => {
    const next = fixture({ id: 'n0', status: 'scheduled', score: null });
    const stuck = fixture({
      id: 'stuck',
      status: 'scheduled',
      score: null,
      freshness: 'awaiting_update',
    });
    const later = fixture({ id: 'n1', status: 'scheduled', score: null });
    const p = page({ next_match: next, fixtures: [stuck, next, later] });
    const html = renderToStaticMarkup(
      <ComingUp page={p} locale="en" timeZone="UTC" territory={undefined} freshness={null} />,
    );
    expect(html).toContain('/match/n1"');
    expect(html).not.toContain('/match/stuck"');
    const tab = (locale: string) =>
      renderToStaticMarkup(
        <FixturesPanel
          page={p}
          locale={locale}
          timeZone="UTC"
          viewing={new Map()}
          signedIn={false}
          territory={undefined}
          freshness={null}
        />,
      );
    const en = tab('en');
    expect(en.match(/data-testid="match-line"/g)).toHaveLength(3);
    // Where to watch it only for the two to come; the stuck one says so instead.
    expect(en.match(/data-testid="viewing-line"/g)).toHaveLength(2);
    expect(en).toMatch(/data-testid="fixture-status"[^>]*>Awaiting update</);
    expect(tab('fa')).toMatch(/data-testid="fixture-status"[^>]*>در انتظار به‌روزرسانی</);
  });
});

describe('the top scorer (T-1528, D-275)', () => {
  const entry = (data: { person: { id: string; name: string }; goals: number }[] | null) => ({
    competition: { id: 'pgpl', name: 'Persian Gulf Pro League', short_name: 'Pro League' },
    season: { id: 's1', label: '2026/27', is_current: true },
    scorers: {
      coverage: data === null ? ('not_supplied' as const) : ('limited' as const),
      last_updated_at: null,
      data,
    },
  });
  const card = (p: TeamPage, locale = 'en') =>
    renderToStaticMarkup(<TopScorerCard page={p} locale={locale} />);
  const amiri = [{ person: { id: 'p9', name: 'Amiri' }, goals: 4 }];

  it('names the club’s leading scorer with the goals and the coverage', () => {
    const html = card(page({ top_scorers: [entry(amiri)] }));
    expect(html).toContain('Top scorer · Pro League');
    expect(html).toContain('href="/en/player/p9"');
    expect(html).toContain('4 goals');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(card(page({ top_scorers: [entry(amiri)] }), 'fa')).toContain('۴ گل');
  });

  it('says so when no goal is recorded, when none was sent, or when the API is older', () => {
    expect(card(page({ top_scorers: [entry([])] }))).toContain(
      'No goal for the club is recorded in Pro League yet.',
    );
    const none = card(page({ top_scorers: [entry(null)] }));
    expect(none).toContain('data-coverage="not_supplied"');
    expect(none).toContain('data-coverage-badge="not_supplied"');
    expect(card(page())).toContain('data-testid="top-scorer-none"');
    expect(card(page())).not.toContain('top-scorer-goals');
  });
});

describe("the band's head coach (T-1439, D-230)", () => {
  const NO_MEDIA = { coverage: 'not_supplied', url: null } as const;
  const lineupCoach = {
    coach: {
      coverage: 'available' as const,
      last_updated_at: null,
      data: { id: 'p-pep', name: 'Pep Guardiola' },
    },
    lineup_fixture: { id: 'f-0', kickoff_at: '2026-10-18T14:00:00.000Z' },
  };
  const band = (p: TeamPage, locale = 'en') =>
    renderToStaticMarkup(
      <ClubBand
        page={p}
        locale={locale}
        timeZone="UTC"
        tab="overview"
        follow={null}
        territory={undefined}
      />,
    );

  it('links the head coach to his page, and says when the latest line-up names another', () => {
    const html = band(
      page({
        manager: lineupCoach,
        head_coach: {
          coverage: 'available',
          last_updated_at: '2026-10-21T10:00:00.000Z',
          data: {
            person: { id: 'p-maresca', name: 'Enzo Maresca', photo: NO_MEDIA },
            since: '2026-08-01',
            lineup_disagrees: true,
          },
        },
      }),
    );
    expect(html).toContain('Head coach');
    expect(html).toContain('href="/en/coach/p-maresca"');
    expect(html).toContain('since 1 August 2026');
    expect(html).toContain('The latest line-up names Pep Guardiola as coach');
    expect(html).not.toContain('data-testid="manager"');
    expect(
      band(
        page({
          manager: lineupCoach,
          head_coach: {
            coverage: 'available',
            last_updated_at: null,
            data: {
              person: { id: 'p-maresca', name: 'انزو مارسکا', photo: NO_MEDIA },
              since: null,
              lineup_disagrees: false,
            },
          },
        }),
        'fa',
      ),
    ).toContain('سرمربی');
  });

  it("falls back to the line-up's coach, linked to the coach page, without a head coach", () => {
    for (const headCoach of [
      undefined,
      { coverage: 'not_supplied' as const, last_updated_at: null, data: null },
    ]) {
      const html = band(page({ manager: lineupCoach, head_coach: headCoach }));
      expect(html).toContain('href="/en/coach/p-pep"');
      expect(html).not.toContain('data-testid="head-coach"');
    }
  });

  it("dates the line-up's coach by its day, in the reader's calendar (T-1562)", () => {
    const en = band(page({ manager: lineupCoach }));
    expect(en).toContain('<time dateTime="2026-10-18T14:00:00.000Z">18 October 2026</time>');
    const fa = band(page({ manager: lineupCoach }), 'fa');
    expect(fa).toContain('<time dateTime="2026-10-18T14:00:00.000Z">۲۶ مهر ۱۴۰۵</time>');
    expect(fa).toContain('<bdi>Pep Guardiola</bdi>');
  });
});

describe('the squad', () => {
  it('shows the cards with the squad’s coverage, and says when positions or numbers are missing', () => {
    const html = renderToStaticMarkup(
      <SquadCard
        page={page({
          squad: {
            coverage: 'limited',
            last_updated_at: null,
            data: [
              player(),
              player({ person: { id: 'p2', name: 'Shiri' }, position: null, shirt_number: null }),
            ],
          },
        })}
        locale="en"
      />,
    );
    expect(html).toContain('Goalkeeper · No. 1');
    expect(html).toContain('data-testid="squad-incomplete"');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(html).not.toContain('squad-minutes-note');
    expect(squadIncomplete([player()])).toBe(false);
  });

  it('caps the Overview’s grid and links to the whole squad, which the tab groups by position', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      player({ person: { id: `p${i}`, name: `Player ${i}` }, shirt_number: i + 1 }),
    );
    const p = page({ squad: { coverage: 'available', last_updated_at: null, data: many } });
    const overview = renderToStaticMarkup(<SquadCard page={p} locale="en" />);
    expect(overview.match(/data-testid="player"/g)).toHaveLength(12);
    expect(overview).toContain('The whole squad: 14 players');
    const tab = renderToStaticMarkup(<SquadPanel page={p} locale="en" full />);
    expect(tab.match(/data-testid="player"/g)).toHaveLength(14);
    expect(tab).toContain('Goalkeepers');
    expect(tab).toContain('data-testid="squad-minutes-note"');
  });

  it('says when no squad is on record', () => {
    const html = renderToStaticMarkup(
      <SquadCard
        page={page({ squad: { coverage: 'not_supplied', last_updated_at: null, data: null } })}
        locale="en"
      />,
    );
    expect(html).toContain('data-testid="squad-empty"');
    expect(html).toContain('data-coverage-badge="not_supplied"');
  });
});

describe('where the club stands', () => {
  it('draws its row in bold with the table’s coverage, a unique id per competition, and the whole table a link away', () => {
    const html = renderToStaticMarkup(<AroundThem page={page()} locale="en" />);
    expect(html).toContain('id="table-s1"');
    expect(html).toMatch(/class="[^"]*bg-accent\/10[^"]*"[^>]*aria-current="true"/);
    expect(html).toContain('Pro League places 1 to 1');
    expect(html).toContain('href="/en/competition/pgpl?tab=table"');
    const unplaced = renderToStaticMarkup(
      <AroundThem
        page={page({
          competitions: [
            {
              ...page().competitions[0]!,
              context: { coverage: 'not_supplied', last_updated_at: null, data: null },
            },
          ],
        })}
        locale="en"
      />,
    );
    expect(unplaced).toContain('No table position to show.');
    expect(unplaced).toContain('data-coverage-badge="not_supplied"');
  });
});

describe('crests, logos and photos on the club page (T-1617)', () => {
  const crest = (id: string) => ({
    coverage: 'available' as const,
    url: `/api/media/crest/${id}/0123456789ab.png`,
  });
  const logo = { coverage: 'available' as const, url: '/api/media/logo/pgpl/0123456789ab.png' };
  const NONE = { coverage: 'not_supplied' as const, url: null };
  const pictured = (over: Partial<TeamPageFixture> = {}) =>
    fixture({
      home: { id: TEAM, name: 'Tractor', short_name: null, crest: crest('tractor') },
      away: { id: 'esteghlal', name: 'Esteghlal', short_name: null, crest: crest('esteghlal') },
      competition: {
        id: 'pgpl',
        name: 'Persian Gulf Pro League',
        short_name: 'Pro League',
        logo,
      },
      ...over,
    });
  const srcs = (html: string) => [...html.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1]);

  it("draws both crests on the next match, each beside its side's name", () => {
    const html = renderToStaticMarkup(
      <NextMatchCard
        fixture={pictured({ status: 'scheduled', score: null })}
        forecast={{ state: 'none' }}
        viewing={null}
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(srcs(html)).toEqual([
      '/api/media/crest/tractor/0123456789ab-96.webp',
      '/api/media/crest/esteghlal/0123456789ab-96.webp',
    ]);
    expect(html).toMatch(/tractor.*Tractor.*Esteghlal/s);
    expect(html).not.toMatch(PHYSICAL);
  });

  it('puts both crests on a match row and the logo beside its competition', () => {
    const html = renderToStaticMarkup(
      <ul>
        <TeamMatchRow fixture={pictured()} teamId={TEAM} locale="en" timeZone="UTC" />
      </ul>,
    );
    expect(srcs(html)).toEqual([
      '/api/media/crest/tractor/0123456789ab-48.webp',
      '/api/media/crest/esteghlal/0123456789ab-48.webp',
      '/api/media/logo/pgpl/0123456789ab-48.webp',
    ]);
    // A competition with no logo sent: no tile, no mark in the small print.
    const plain = renderToStaticMarkup(
      <ul>
        <TeamMatchRow fixture={fixture()} teamId={TEAM} locale="en" timeZone="UTC" />
      </ul>,
    );
    expect(plain).not.toContain('data-kind="logo"');
  });

  it("shows the opponent's crest in recent results and coming up, never the club's own", () => {
    const recent = renderToStaticMarkup(
      <RecentResults page={page({ results: [pictured()] })} locale="en" timeZone="UTC" />,
    );
    expect(srcs(recent)).toEqual([
      '/api/media/crest/esteghlal/0123456789ab-48.webp',
      '/api/media/logo/pgpl/0123456789ab-48.webp',
    ]);
    const later = pictured({
      id: '00000000-0000-4000-8000-00000000f002',
      status: 'scheduled',
      score: null,
      home: { id: 'esteghlal', name: 'Esteghlal', short_name: null, crest: NONE },
      away: { id: TEAM, name: 'Tractor', short_name: null, crest: crest('tractor') },
    });
    const coming = renderToStaticMarkup(
      <ComingUp
        page={page({ fixtures: [later] })}
        locale="en"
        timeZone="UTC"
        territory={undefined}
        freshness={null}
      />,
    );
    // The opponent has no crest held: its lettered mark, not the club's crest.
    expect(srcs(coming)).toEqual([]);
    expect(coming).toContain('data-letters="E"');
  });

  it('draws the squad with photos and the table around the club with crests and the logo', () => {
    const squad = renderToStaticMarkup(
      <SquadCard
        page={page({
          squad: {
            coverage: 'available',
            last_updated_at: null,
            data: [
              player({
                person: {
                  id: 'p1',
                  name: 'Ali Daei',
                  photo: { coverage: 'available', url: '/api/media/photo/p1/0123456789ab.png' },
                },
              }),
            ],
          },
        })}
        locale="en"
      />,
    );
    expect(srcs(squad)).toEqual(['/api/media/photo/p1/0123456789ab-48.webp']);
    const base = page();
    const entry = base.competitions[0]!;
    const around = renderToStaticMarkup(
      <AroundThem
        page={page({
          competitions: [
            {
              ...entry,
              competition: { ...entry.competition, logo },
              context: {
                ...entry.context,
                data: {
                  ...entry.context.data!,
                  rows: entry.context.data!.rows.map((r) => ({
                    ...r,
                    team: { ...r.team, crest: crest('tractor') },
                  })),
                },
              },
            },
          ],
        })}
        locale="en"
      />,
    );
    expect(srcs(around)).toEqual([
      '/api/media/logo/pgpl/0123456789ab-48.webp',
      '/api/media/crest/tractor/0123456789ab-48.webp',
    ]);
    expect(around).not.toMatch(PHYSICAL);
  });
});

describe('logical properties only (rule 7)', () => {
  it('uses no physical left or right in the page or its components', () => {
    expect(PAGE).not.toMatch(PHYSICAL);
    expect(COMPONENT).not.toMatch(PHYSICAL);
    expect(OVERVIEW).not.toMatch(PHYSICAL);
    expect(BAND).not.toMatch(PHYSICAL);
  });
});
