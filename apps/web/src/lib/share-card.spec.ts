import { describe, expect, it } from 'vitest';
import type {
  CalledItCard,
  CompetitionPage,
  ForecastVersion,
  MatchHeader,
  PredictionHistoryItem,
  Rating,
  TableRow,
  TeamPage,
} from '@fmip/contracts';
import { t } from '@/i18n/messages';
import {
  aheadOfKickoff,
  BRAND_CARD,
  teamCardText,
  teamCardCacheControl,
  teamFixtureSize,
  teamNameSize,
  calledItText,
  cardAlt,
  cardName,
  kickoffUtc,
  matchCardText,
  memberCardText,
  nameSize,
  tableCardText,
  TABLE_CARD_ROWS,
} from './share-card';

/**
 * T-520: a share card says what its page says and nothing more, the same way
 * for everybody who sees the chat it was pasted into.
 */

const header = (over: Partial<MatchHeader> = {}): MatchHeader => ({
  id: 'f1',
  kickoff_at: '2026-10-04T14:00:00.000Z',
  status: 'scheduled',
  minute: null,
  competition: { id: 'c1', name: 'Premier League', short_name: 'PL', country_id: null },
  season: { id: 's1', label: '2026/27' },
  stage: null,
  round: 'Regular Season - 7',
  group_name: null,
  leg: null,
  home: {
    id: 'a',
    name: 'Arsenal',
    short_name: 'ARS',
    code: null,
    red_cards: 0,
    formation: null,
    coach: null,
  } as MatchHeader['home'],
  away: {
    id: 'b',
    name: 'Chelsea',
    short_name: 'CHE',
    code: null,
    red_cards: 0,
    formation: null,
    coach: null,
  } as MatchHeader['away'],
  scores: {
    current: null,
    half_time: null,
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
  last_updated_at: '2026-10-04T14:00:00.000Z',
  freshness: null,
  ...over,
});

const forecast = (over: Partial<ForecastVersion> = {}): ForecastVersion =>
  ({
    id: 'v1',
    fixture_id: 'f1',
    version_number: 1,
    kind: 'early',
    model_version: 'dixon-coles@1.0.0',
    computed_at: '2026-10-01T10:00:00.000Z',
    status: 'available',
    probabilities: { home: 0.4547, draw: 0.2913, away: 0.254 },
    expected_goals: null,
    most_likely_scorelines: null,
    leading_factors: null,
    data_completeness: 'available',
    inputs: null,
    unavailable_reason: null,
    unavailable_detail: null,
    ...over,
  }) as ForecastVersion;

describe('the match card (A10, T-1723)', () => {
  it('writes the kick-off in UTC and says so, since a preview is the same for everyone', () => {
    expect(kickoffUtc('2026-10-04T14:00:00.000Z')).toBe('Sun 4 Oct 2026 · 14:00 UTC');
    const text = matchCardText(header(), null);
    expect(text).toMatchObject({
      eyebrow: 'Premier League · 2026/27 · Regular Season - 7',
      home: 'Arsenal',
      away: 'Chelsea',
      centre: 'v',
      loser: null,
      decided: null,
      status: 'Sun 4 Oct 2026 · 14:00 UTC',
      model: { line: 'The model’s forecast appears before kick-off', source: null },
    });
  });

  it('shows the score live with when it was last heard from, and says so when it is stale', () => {
    const live = header({
      status: 'live',
      minute: 67,
      last_updated_at: '2026-10-04T15:12:00.000Z',
      scores: { ...header().scores, current: { home: 2, away: 1 } },
    });
    expect(matchCardText(live, null)).toMatchObject({
      centre: '2–1',
      loser: null,
      status: 'Live 67′ · as of 15:12 UTC',
    });
    expect(matchCardText({ ...live, freshness: 'stale' }, null).status).toBe(
      'Live 67′ · no update since 15:12 UTC',
    );
    expect(matchCardText({ ...live, at_half_time: true }, null).status).toBe(
      'Half time · as of 15:12 UTC',
    );
  });

  it('mutes the loser after full time, neither side after a draw', () => {
    const won = matchCardText(
      header({
        status: 'finished',
        scores: { ...header().scores, full_time: { home: 0, away: 1 } },
      }),
      null,
    );
    expect([won.centre, won.status, won.loser]).toEqual(['0–1', 'Full time', 'home']);
    const drawn = matchCardText(
      header({
        status: 'finished',
        scores: { ...header().scores, full_time: { home: 1, away: 1 } },
      }),
      null,
    );
    expect(drawn.loser).toBeNull();
  });

  it('says a disputed score is unclear and names no loser (T-1726, D-347)', () => {
    const text = matchCardText(
      header({
        status: 'finished',
        scores: { ...header().scores, full_time: { home: 0, away: 1 } },
        score_dispute: { recorded_goals: 2, reported: { home: 0, away: 1 } },
      }),
      null,
    );
    expect(text).toMatchObject({
      centre: '0–1',
      disputed: true,
      loser: null,
      status: 'Score unclear in the source',
    });
  });

  it('draws no number when the stored scores contradict each other (T-1819, D-414)', () => {
    // The API withholds the lines in conflict; the shoot-out line stays on record.
    const text = matchCardText(
      header({
        status: 'finished',
        scores: {
          ...header().scores,
          current: null,
          full_time: null,
          penalties: { home: 4, away: 3 },
        },
        score_conflict: { coverage: 'limited', reasons: ['ninety_exceeds_final'] },
      }),
      null,
    );
    expect(text).toMatchObject({
      centre: '–',
      disputed: true,
      loser: null,
      decided: null,
      status: 'Score unclear in the source',
    });
  });

  it('says how a cup tie was decided only when the feed says so', () => {
    const scores = {
      ...header().scores,
      full_time: { home: 1, away: 1 },
      extra_time: { home: 0, away: 0 },
    };
    expect(matchCardText(header({ status: 'finished', scores }), null).decided).toBe('AET');
    expect(
      matchCardText(
        header({ status: 'finished', scores: { ...scores, penalties: { home: 4, away: 3 } } }),
        null,
      ).decided,
    ).toBe('Pens 4–3');
  });

  it('names the model beside its pre-kick-off forecast, totalling 100', () => {
    const text = matchCardText(header(), forecast());
    expect(text.model).toEqual({
      line: 'The model: Arsenal 45.5% · Draw 29.1% · Chelsea 25.4%',
      source: 'dixon-coles@1.0.0',
    });
    const after = matchCardText(
      header({
        status: 'finished',
        scores: { ...header().scores, full_time: { home: 0, away: 0 } },
      }),
      forecast(),
    );
    expect(after.model?.line).toBe(
      'Before kick-off, the model: Arsenal 45.5% · Draw 29.1% · Chelsea 25.4%',
    );
    // No version before kick-off: said, never an empty box.
    expect(matchCardText(header({ status: 'live', minute: 3 }), null).model).toEqual({
      line: 'The model published no forecast before kick-off',
      source: null,
    });
    expect(
      matchCardText(header(), forecast({ status: 'unavailable', probabilities: null })).model
        ?.source,
    ).toBeNull();
  });

  it('draws no model line for a match not played as scheduled, or one the feed went quiet on', () => {
    for (const status of ['postponed', 'cancelled', 'abandoned', 'awarded', 'suspended'] as const) {
      const text = matchCardText(header({ status }), forecast());
      expect(text.model, status).toBeNull();
    }
    expect(matchCardText(header({ status: 'postponed' }), null)).toMatchObject({
      centre: 'v',
      status: 'Postponed',
    });
    // T-1713, D-343: a kick-off long past with no word from the feed is not a time to come.
    expect(matchCardText(header({ freshness: 'awaiting_update' }), forecast())).toMatchObject({
      status: 'Awaiting update',
      model: null,
    });
  });

  it('uses the short name for a very long one, when there is one', () => {
    const long = {
      ...header().home,
      name: 'Esteghlal Khuzestan Football Club',
      short_name: 'Esteghlal Khuz.',
    };
    expect(matchCardText(header({ home: long }), null).home).toBe('Esteghlal Khuz.');
    expect(cardName({ name: 'Gençlerbirliği S.K.', short_name: null })).toBe('Gençlerbirliği S.K.');
  });
});

describe('the called-it card (B01 + B17, T-1723)', () => {
  const card = (over: Partial<CalledItCard> = {}): CalledItCard => ({
    fixture_id: 'f1',
    competition: 'Premier League',
    round: 'Regular Season - 9',
    home: { name: 'Liverpool', short_name: null },
    away: { name: 'Arsenal', short_name: null },
    actual: { home: 0, away: 1 },
    pick: { outcome: 'away', score: null },
    exact: false,
    picked_at: '2026-10-30T17:34:00.000Z',
    kickoff_at: '2026-11-01T16:30:00.000Z',
    username: 'mosiop',
    ...over,
  });

  it('says the pick, the settled score and when it was made, in UTC', () => {
    expect(calledItText(card())).toEqual({
      eyebrow: 'Premier League · Regular Season - 9 · Sun 1 Nov',
      home: 'Liverpool',
      away: 'Arsenal',
      score: '0–1',
      loser: 'home',
      exact: null,
      pick: 'My pick: Arsenal to win',
      proof: 'Picked Fri 30 Oct · 17:34 UTC · 46 hours before kick-off',
      handle: '@mosiop',
    });
  });

  it('writes a draw and an exact score from the side picked', () => {
    const draw = calledItText(
      card({ actual: { home: 1, away: 1 }, pick: { outcome: 'draw', score: null } }),
    );
    expect([draw.pick, draw.loser]).toEqual(['My pick: Draw', null]);
    const exact = calledItText(
      card({ pick: { outcome: 'away', score: { home: 0, away: 1 } }, exact: true }),
    );
    expect([exact.pick, exact.exact]).toEqual(['My pick: Arsenal 1–0', 'Exact score, too']);
    const level = calledItText(
      card({
        actual: { home: 2, away: 2 },
        pick: { outcome: 'draw', score: { home: 1, away: 1 } },
      }),
    );
    expect([level.pick, level.exact]).toEqual(['My pick: Draw 1–1', null]);
  });

  it('counts the time before kick-off in the largest whole unit', () => {
    const kickoff = '2026-11-01T16:30:00.000Z';
    expect(aheadOfKickoff('2026-10-28T16:30:00.000Z', kickoff)).toBe('4 days before kick-off');
    expect(aheadOfKickoff('2026-10-31T10:30:00.000Z', kickoff)).toBe('30 hours before kick-off');
    expect(aheadOfKickoff('2026-11-01T15:00:00.000Z', kickoff)).toBe('90 minutes before kick-off');
    expect(aheadOfKickoff('2026-11-01T16:29:30.000Z', kickoff)).toBe('1 minute before kick-off');
  });

  it('never uses a bookmaker’s words, a rating or the model', () => {
    const words = JSON.stringify(
      calledItText(card({ exact: true, pick: { outcome: 'away', score: { home: 0, away: 1 } } })),
    );
    expect(words).not.toMatch(/\b(won|winner|settled|odds|payout|bet|rating|model)\b/i);
  });
});

describe('the table card', () => {
  const row = (position: number): TableRow => ({
    position,
    team: { id: `t${position}`, name: `Team ${position}`, short_name: null },
    played: 7,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 22 - position,
    form: [],
  });
  const page = (rows: TableRow[] | null): CompetitionPage =>
    ({
      competition: { name: 'Premier League' },
      season: { label: '2026/27' },
      table: { data: rows },
    }) as unknown as CompetitionPage;

  it('shows the top of the table, as many rows as fit', () => {
    const text = tableCardText(page(Array.from({ length: 20 }, (_, i) => row(i + 1))));
    expect(text.rows).toHaveLength(TABLE_CARD_ROWS);
    expect(text.rows[0]).toEqual({ position: 1, team: 'Team 1', played: 7, points: 21 });
    expect(text.absence).toBeNull();
  });

  it('says there is no table rather than drawing an empty one', () => {
    expect(tableCardText(page(null))).toMatchObject({ rows: [], absence: expect.any(String) });
    expect(tableCardText(page([])).absence).not.toBeNull();
  });
});

describe('team names on the match card', () => {
  it('gets smaller as a name gets longer, so two lines still sit under its crest', () => {
    expect(nameSize('Arsenal')).toBe(44);
    expect(nameSize('Omonia Nicosia')).toBe(38);
    expect(nameSize('Gençlerbirliği S.K.')).toBe(32);
  });
});

describe('the member card', () => {
  const settled = (home: string, outcome: 'home' | 'draw' | 'away', right: boolean) =>
    ({
      fixture: {
        id: home,
        kickoff_at: '2026-09-20T14:00:00.000Z',
        status: 'finished',
        competition: { id: 'c', name: 'Premier League' },
        home: { id: 'h', name: home, short_name: null },
        away: { id: 'a', name: 'Chelsea', short_name: null },
        score: { home: 2, away: 1 },
      },
      prediction: {
        latest: { outcome },
        settlement: { status: 'settled', actual: { home: 2, away: 1 }, outcome_correct: right },
      },
    }) as unknown as PredictionHistoryItem;

  it('shows the rating as the profile does, and the latest settled predictions', () => {
    const text = memberCardText(
      { display_name: 'Mo', username: 'mosiop' },
      { rating: 62.44, established: true, settled_count: 55 } as Rating,
      [settled('Arsenal', 'home', true), settled('Spurs', 'away', false)],
    );
    expect(text).toMatchObject({ name: 'Mo', handle: '@mosiop' });
    expect(text.rating).toBe('Rating 62.4 · established · 55 settled');
    expect(text.recent).toEqual([
      { match: 'Arsenal 2–1 Chelsea', verdict: 'Home win · right' },
      { match: 'Spurs 2–1 Chelsea', verdict: 'Away win · wrong' },
    ]);
  });

  it('says there is no rating yet, and leaves open and void predictions off', () => {
    const open = {
      ...settled('Leeds', 'draw', false),
      prediction: { latest: { outcome: 'draw' }, settlement: null },
    } as unknown as PredictionHistoryItem;
    const text = memberCardText({ display_name: 'New', username: 'newbie' }, null, [open]);
    expect(text.rating).toBe('No settled predictions yet');
    expect(text.recent).toEqual([]);
  });
});

describe('the brand card (B10, T-1825)', () => {
  it('says the brand line, with "record" apart to be lit', () => {
    // The catalogue's line (T-1827) and the card's are one sentence.
    expect(`${BRAND_CARD.before} ${BRAND_CARD.lit} ${BRAND_CARD.after}`).toBe(
      t('en', 'brand.line'),
    );
    expect(BRAND_CARD.lit).toBe('record');
  });

  it('is described in the reader’s language, an unknown one in English', () => {
    expect(cardAlt('brand', 'en')).toBe(
      'Stadiomind: a forecast model that shows its record in public',
    );
    expect(cardAlt('brand', 'fa')).toBe(
      'Stadiomind: مدل پیش‌بینی‌ای که کارنامه‌اش را علنی نشان می‌دهد',
    );
    expect(cardAlt('brand', 'xx')).toBe(cardAlt('brand', 'en'));
  });
});

describe('the team card (T1, T-1826)', () => {
  const ARSENAL = 'team-ars';
  const NOW = new Date('2026-11-13T23:30:00.000Z');
  const page = (over: Partial<TeamPage> = {}): TeamPage =>
    ({
      team: {
        id: ARSENAL,
        name: 'Arsenal',
        localised_name: null,
        short_name: null,
        code: 'ARS',
        kind: 'club',
        gender: 'men',
        age_group: 'senior',
        founded_year: 1886,
        country: { id: 'c-eng', name: 'England', code: 'GB-ENG' },
        venue: null,
        colour: '#e10000',
      },
      competitions: [
        {
          competition: {
            id: 'pl',
            name: 'Premier League',
            short_name: null,
            kind: 'league',
            scope: 'domestic',
          },
          season: { id: 's', label: '2026/27', is_current: true },
          context: {
            coverage: 'available',
            data: {
              position: 1,
              total: 20,
              points: 27,
              rows: [
                { position: 1, team: { id: ARSENAL, name: 'Arsenal' }, played: 10, points: 27 },
              ],
            },
          },
          has_table: true,
        },
      ],
      next_match: {
        id: 'f1',
        kickoff_at: '2026-11-21T17:30:00.000Z',
        status: 'scheduled',
        round: 'Regular Season - 11',
        stage: null,
        home: { id: 'new', name: 'Newcastle', short_name: null },
        away: { id: ARSENAL, name: 'Arsenal', short_name: null },
        score: null,
        competition: { id: 'pl', name: 'Premier League', short_name: null },
        season: { id: 's', label: '2026/27' },
        after_extra_time: false,
        penalties: null,
        freshness: null,
      },
      ...over,
    }) as unknown as TeamPage;

  it('says the club, its league and standing, its next match and the day it was drawn', () => {
    expect(teamCardText(page(), NOW)).toEqual({
      eyebrow: 'England · Club · Founded 1886',
      name: 'Arsenal',
      competition: { name: 'Premier League', known: true },
      standing: '1st · 27 pts from 10',
      next: {
        label: 'Next match',
        match: 'Newcastle v Arsenal',
        detail: 'Sat 21 Nov · Premier League · Matchweek 11',
        known: true,
      },
      // The UK's day, never a time: 23:30 UTC on the 13th is still the 13th in London.
      asOf: 'As of 13 Nov 2026',
    });
  });

  it('says what the answer does not hold, never a made-up figure (rule 3)', () => {
    const text = teamCardText(page({ competitions: [], next_match: null }), NOW);
    expect(text.competition).toEqual({ name: 'No current competition on record', known: false });
    expect(text.standing).toBeNull();
    expect(text.next).toEqual({
      label: 'Next match',
      match: 'No match scheduled',
      detail: null,
      known: false,
    });
  });

  it('draws a standing only from a table held in full and on time (rule 4)', () => {
    const [league] = page().competitions;
    for (const coverage of ['limited', 'delayed'] as const) {
      const partial = { ...league!, context: { ...league!.context, coverage } };
      expect(teamCardText(page({ competitions: [partial] }), NOW).standing).toBeNull();
    }
  });

  it('says "Now playing" or "Suspended" for a match in play or suspended, never "Next match"', () => {
    const base = page();
    const live = { ...base.next_match!, status: 'live' };
    const suspended = { ...base.next_match!, status: 'suspended' };
    expect(teamCardText(page({ next_match: live }), NOW).next.label).toBe('Now playing');
    expect(teamCardText(page({ next_match: suspended }), NOW).next.label).toBe('Suspended');
  });

  it('is kept five minutes while its match is close or under way, else an hour (rev-2026-11-13-08)', () => {
    const at = (iso: string, status = 'scheduled') => ({ kickoff_at: iso, status });
    const now = new Date('2026-11-21T17:00:00.000Z');
    expect(teamCardCacheControl(null, now)).toBe('public, max-age=3600');
    expect(teamCardCacheControl(at('2026-11-22T17:00:00.000Z'), now)).toBe('public, max-age=3600');
    expect(teamCardCacheControl(at('2026-11-21T18:01:00.000Z'), now)).toBe('public, max-age=3600');
    expect(teamCardCacheControl(at('2026-11-21T18:00:00.000Z'), now)).toBe('public, max-age=300');
    // A kick-off already past and still "scheduled" is about to change too.
    expect(teamCardCacheControl(at('2026-11-21T12:00:00.000Z'), now)).toBe('public, max-age=300');
    expect(teamCardCacheControl(at('2026-11-21T16:30:00.000Z', 'live'), now)).toBe(
      'public, max-age=300',
    );
    expect(teamCardCacheControl(at('2026-11-25T16:30:00.000Z', 'suspended'), now)).toBe(
      'public, max-age=300',
    );
  });

  it('steps a long fixture down so the date under it stays clear (PR #888 review)', () => {
    expect(teamFixtureSize('Newcastle v Arsenal')).toBe(56);
    expect(teamFixtureSize('Borussia Dortmund v Bayer Leverkusen')).toBe(44);
    expect(teamFixtureSize('Wolverhampton Wanderers v Brighton and Hove Albion')).toBe(34);
  });

  it('names no standing for a table that does not place the club, and no played count it lacks', () => {
    const [league] = page().competitions;
    const noTable = { ...league!, context: { coverage: 'not_supplied', data: null } };
    expect(teamCardText(page({ competitions: [noTable] as never }), NOW).standing).toBeNull();
    const elsewhere = {
      ...league!,
      context: { coverage: 'available', data: { position: 3, total: 20, points: 20, rows: [] } },
    };
    expect(teamCardText(page({ competitions: [elsewhere] as never }), NOW).standing).toBe(
      '3rd · 20 pts',
    );
  });

  it('never gives a long-past kick-off as the next match’s day (D-343)', () => {
    const base = page();
    const late = { ...base.next_match!, freshness: 'awaiting_update' as const };
    expect(teamCardText(page({ next_match: late }), NOW).next.detail).toBe(
      'Awaiting update · Premier League · Matchweek 11',
    );
  });

  it('shows the English localised name, and sizes a long one down', () => {
    const named = page();
    named.team.localised_name = 'Persepolis';
    expect(teamCardText(named, NOW).name).toBe('Persepolis');
    expect(teamNameSize('Arsenal Tivat')).toBe(90);
    expect(teamNameSize('Borussia Mönchengladbach')).toBe(64);
    expect(teamNameSize('Club Atlético Tucumán de San Miguel')).toBe(52);
  });

  it('is described in the reader’s language', () => {
    expect(cardAlt('team', 'fa')).toBe('باشگاه، رقابتش و بازی بعدی‌اش');
  });
});
