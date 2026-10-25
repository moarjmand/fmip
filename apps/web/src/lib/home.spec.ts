import { describe, expect, it } from 'vitest';
import type {
  ForecastVersion,
  MatchViewing,
  PanelLatest,
  PublicModelAccuracyResponse,
  ScoreCard,
  ScoresResponse,
} from '@fmip/contracts';
import {
  accuracyFigure,
  featuredNotes,
  heroMatch,
  heroVersion,
  homeBroadcasts,
  homePanels,
  keyDay,
  keyMatchGroups,
  liveCards,
  liveCheckedAt,
  matchesOn,
  sharedRound,
  shortDay,
  tableCompetition,
  tableRowOf,
  todayFixtureIds,
} from './home';

/** T-526: the homepage keeps the reader's order and shows only what is real. */
const card = (
  id: string,
  status: ScoreCard['status'],
  kickoff: string,
  competition = 'pl',
): ScoreCard =>
  ({
    id,
    status,
    kickoff_at: kickoff,
    competition: { id: competition, name: competition, short_name: null, country_id: null },
    home: { id: `${id}h`, name: `${id} home`, short_name: null, code: null },
    away: { id: `${id}a`, name: `${id} away`, short_name: null, code: null },
  }) as unknown as ScoreCard;

const scores = (pinned: ScoreCard[], groups: ScoreCard[][]): ScoresResponse =>
  ({
    pinned,
    groups: groups.map((fixtures) => ({
      country: null,
      competition: fixtures[0]!.competition,
      fixtures,
    })),
  }) as unknown as ScoresResponse;

describe('the homepage', () => {
  it('reads the editor’s notes, and an unreachable answer as nothing featured', () => {
    expect(featuredNotes([{ fixture_id: 'a', note: 'Derby.' }]).get('a')).toBe('Derby.');
    expect(featuredNotes(null).size).toBe(0);
  });

  it('takes its table from the first competition in the reader’s order', () => {
    const a = card('a', 'scheduled', '2026-10-04T12:00:00Z', 'ucl');
    const b = card('b', 'scheduled', '2026-10-04T12:00:00Z', 'pl');
    expect(tableCompetition(scores([], [[a], [b]]))).toBe('ucl');
    expect(tableCompetition(scores([b], [[a]]))).toBe('pl');
    expect(tableCompetition(scores([], []))).toBeNull();
  });

  it('writes a kick-off day in the reader’s zone, not in UTC', () => {
    expect(shortDay('en', '2026-10-04T22:30:00Z', 'UTC')).toBe('4 Oct');
    expect(shortDay('en', '2026-10-04T22:30:00Z', 'Asia/Tehran')).toBe('5 Oct');
    expect(shortDay('fa', '2026-10-04T22:30:00Z', 'Asia/Tehran')).toBe('۱۳ مهر');
  });
});

describe("the member's homepage (T-942)", () => {
  it("takes today's matches in the reader's zone, pinned first, once each", () => {
    const pinned = card('fav', 'scheduled', '2026-10-04T20:00:00Z');
    const late = card('late', 'scheduled', '2026-10-04T23:30:00Z');
    const tomorrow = card('tomorrow', 'scheduled', '2026-10-05T12:00:00Z');
    const done = card('done', 'finished', '2026-10-04T10:00:00Z');
    const data = scores([pinned], [[done, pinned, late, tomorrow]]);
    // 23:30 UTC is already the 5th in Tehran, so it is not "today" there.
    expect(todayFixtureIds(data, '2026-10-04', 'UTC')).toEqual(['fav', 'done', 'late']);
    expect(todayFixtureIds(data, '2026-10-04', 'Asia/Tehran')).toEqual(['fav', 'done']);
  });

  it('lists only panels with a post, the most recently written-on first', () => {
    const panel = (id: string, at: string | null): PanelLatest =>
      ({
        fixture_id: id,
        state: 'open',
        total: at === null ? 0 : 1,
        posts: at === null ? [] : [{ id: `${id}p`, created_at: at }],
      }) as unknown as PanelLatest;
    const chosen = homePanels([
      panel('quiet', null),
      panel('older', '2026-10-04T10:00:00Z'),
      panel('newer', '2026-10-04T12:00:00Z'),
    ]);
    expect(chosen.map((p) => p.fixture_id)).toEqual(['newer', 'older']);
  });
});

describe('the front page (T-1382, D-200; T-1495, D-270)', () => {
  // Groups in the answer's order, which without the session is D-154's:
  // the Pro League first, then the Champions League, then the Premier League.
  const pgpl = (id: string, status: ScoreCard['status'], kickoff: string) =>
    card(id, status, kickoff, 'pgpl');
  const ucl = (id: string, status: ScoreCard['status'], kickoff: string) =>
    card(id, status, kickoff, 'ucl');
  const epl = (id: string, status: ScoreCard['status'], kickoff: string) =>
    card(id, status, kickoff, 'epl');

  it('takes today as the key day when anything is played, else the next day with a match', () => {
    const data = scores([], [[pgpl('a', 'finished', '2026-10-08T12:00:00Z')]]);
    expect(keyDay(data, '2026-10-08', 'UTC')).toBe('2026-10-08');
    const later = scores([], [[pgpl('b', 'scheduled', '2026-10-10T12:00:00Z')]]);
    expect(keyDay(later, '2026-10-08', 'UTC')).toBe('2026-10-10');
    expect(keyDay(scores([], []), '2026-10-08', 'UTC')).toBeNull();
  });

  const hero = (...args: Parameters<typeof heroMatch>) => {
    const found = heroMatch(...args);
    return found === null ? null : [found.card.id, found.slot];
  };

  it('opens on the next big match when nothing is live: the competitions’ order, then the earliest', () => {
    const data = scores(
      [],
      [
        [
          pgpl('late', 'scheduled', '2026-10-08T15:00:00Z'),
          pgpl('early', 'scheduled', '2026-10-08T13:30:00Z'),
        ],
        [ucl('cup', 'scheduled', '2026-10-08T11:00:00Z')],
      ],
    );
    expect(hero(data, '2026-10-08', 'UTC')).toEqual(['early', 'today']);
  });

  it('puts a member’s own team first, then an editor’s feature, and never a finished match', () => {
    const data = scores(
      [],
      [
        [
          pgpl('done', 'finished', '2026-10-08T10:00:00Z'),
          pgpl('pro', 'scheduled', '2026-10-08T13:30:00Z'),
        ],
        [ucl('cup', 'scheduled', '2026-10-08T19:00:00Z')],
        [epl('mine', 'scheduled', '2026-10-08T20:00:00Z')],
      ],
    );
    expect(hero(data, '2026-10-08', 'UTC', new Set(), new Set(['cup']))?.[0]).toBe('cup');
    expect(hero(data, '2026-10-08', 'UTC', new Set(['mineh']), new Set(['cup']))?.[0]).toBe('mine');
    // A followed team's finished match does not lead.
    expect(hero(data, '2026-10-08', 'UTC', new Set(['doneh']))?.[0]).toBe('pro');
  });

  it('gives the slot to a big match in play, and falls back to the next big one when none is', () => {
    const day = (status: ScoreCard['status']) =>
      scores(
        [],
        [
          [
            pgpl('now', status, '2026-10-08T12:00:00Z'),
            pgpl('next', 'scheduled', '2026-10-08T17:00:00Z'),
          ],
        ],
      );
    expect(hero(day('live'), '2026-10-08', 'UTC')).toEqual(['now', 'live']);
    // Over: the next big match takes the slot again.
    expect(hero(day('finished'), '2026-10-08', 'UTC')).toEqual(['next', 'today']);
  });

  it('never gives the slot to a live match smaller than the next big one', () => {
    const data = scores(
      [],
      [
        [pgpl('clasico', 'scheduled', '2026-10-09T19:00:00Z')],
        [ucl('cup', 'live', '2026-10-08T17:00:00Z')],
        [epl('minor', 'live', '2026-10-08T17:30:00Z')],
      ],
    );
    // An editor's feature beats a big competition's live match; it is tomorrow.
    expect(hero(data, '2026-10-08', 'UTC', new Set(), new Set(['clasico']))).toEqual([
      'clasico',
      'tomorrow',
    ]);
    // A live match outside the big competitions never leads: with one big
    // competition counted, the Pro League's match tomorrow does.
    expect(hero(data, '2026-10-08', 'UTC', new Set(), new Set(), 1)).toEqual([
      'clasico',
      'tomorrow',
    ]);
    // Within the big competitions, the match in play wins.
    expect(hero(data, '2026-10-08', 'UTC')).toEqual(['cup', 'live']);
  });

  it('looks past an empty today and tomorrow to the first day with a match, and says so', () => {
    const data = scores(
      [],
      [
        [
          pgpl('today', 'finished', '2026-10-08T10:00:00Z'),
          pgpl('saturday', 'scheduled', '2026-10-10T13:00:00Z'),
          pgpl('sunday', 'scheduled', '2026-10-11T13:00:00Z'),
        ],
      ],
    );
    expect(hero(data, '2026-10-08', 'UTC')).toEqual(['saturday', 'later']);
    const over = scores([], [[pgpl('today', 'finished', '2026-10-08T10:00:00Z')]]);
    expect(hero(over, '2026-10-08', 'UTC')).toBeNull();
    expect(hero(scores([], []), '2026-10-08', 'UTC')).toBeNull();
  });

  it('lists the matches in play in the competitions’ order, and when they were last heard from', () => {
    const a = {
      ...ucl('a', 'live', '2026-10-08T12:00:00Z'),
      last_updated_at: '2026-10-08T12:40:00Z',
    };
    const b = {
      ...pgpl('b', 'live', '2026-10-08T13:00:00Z'),
      last_updated_at: '2026-10-08T13:10:00Z',
      live_answered_at: '2026-10-08T13:20:00Z',
    };
    const data = scores([], [[b, pgpl('c', 'scheduled', '2026-10-08T18:00:00Z')], [a]]);
    expect(liveCards(data).map((card) => card.id)).toEqual(['b', 'a']);
    expect(liveCheckedAt(liveCards(data))).toBe('2026-10-08T13:20:00Z');
    expect(liveCheckedAt([])).toBeNull();
  });

  it('reads the hero’s figures from its last version before kick-off, never a later one', () => {
    const version = (version_number: number, computed_at: string) =>
      ({ version_number, computed_at }) as ForecastVersion;
    const kickoff = '2026-10-08T17:00:00.000Z';
    const versions = [
      version(1, '2026-10-06T09:00:00.000Z'),
      version(2, '2026-10-08T15:45:00.000Z'),
      version(3, '2026-10-08T17:30:00.000Z'),
    ];
    expect(heroVersion(versions, kickoff)?.version_number).toBe(2);
    expect(heroVersion([versions[2]!], kickoff)).toBeNull();
    expect(heroVersion(null, kickoff)).toBeNull();
  });

  it('names a competition’s round only when its whole card shares one', () => {
    const r = (round: string | null) =>
      ({ ...pgpl('x', 'scheduled', '2026-10-08T12:00:00Z'), round }) as ScoreCard;
    expect(sharedRound([r('Regular Season - 8'), r('Regular Season - 8')])).toBe(
      'Regular Season - 8',
    );
    expect(sharedRound([r('Regular Season - 8'), r('Regular Season - 9')])).toBeNull();
    expect(sharedRound([r(null)])).toBeNull();
  });

  it('groups the key day by competition in order, the member’s teams first and each match once', () => {
    const data = scores(
      [],
      [
        [
          pgpl('p2', 'scheduled', '2026-10-08T15:00:00Z'),
          pgpl('p1', 'live', '2026-10-08T13:00:00Z'),
        ],
        [ucl('u1', 'scheduled', '2026-10-08T19:00:00Z')],
        [epl('e1', 'scheduled', '2026-10-09T19:00:00Z')],
      ],
    );
    const shape = (groups: ReturnType<typeof keyMatchGroups>) =>
      groups.map((g) => [g.kind, g.competition?.id ?? null, g.cards.map((c) => c.id)]);
    expect(shape(keyMatchGroups(data, '2026-10-08', 'UTC'))).toEqual([
      ['competition', 'pgpl', ['p1', 'p2']],
      ['competition', 'ucl', ['u1']],
    ]);
    expect(shape(keyMatchGroups(data, '2026-10-08', 'UTC', new Set(['u1h'])))).toEqual([
      ['yours', null, ['u1']],
      ['competition', 'pgpl', ['p1', 'p2']],
    ]);
    expect(matchesOn(data, '2026-10-08', 'UTC')).toBe(3);
  });

  it('cuts a long day and counts what it left for the scores page', () => {
    const data = scores(
      [],
      [
        ['a', 'b', 'c'].map((id, i) => pgpl(id, 'scheduled', `2026-10-08T1${i}:00:00Z`)),
        [ucl('u', 'scheduled', '2026-10-08T19:00:00Z')],
      ],
    );
    const cut = keyMatchGroups(data, '2026-10-08', 'UTC', new Set(), { groups: 1, rows: 2 });
    expect(cut).toHaveLength(1);
    expect(cut[0]!.cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(cut[0]!.more).toBe(1);
  });

  it('finds a team’s row in the table, or nothing', () => {
    const rows = [{ position: 1, points: 16, team: { id: 't' } }] as never;
    expect(tableRowOf(rows, 't')?.points).toBe(16);
    expect(tableRowOf(rows, 'x')).toBeNull();
    expect(tableRowOf(null, 't')).toBeNull();
  });

  it('shows the newest month with a scored match, and nothing when none is scored', () => {
    const point = (period: string, matches: number, rps: number | null) => ({
      period,
      period_start: `${period}-01`,
      forecasts: matches,
      matches,
      coverage: matches === 0 ? 'not_supplied' : matches < 30 ? 'limited' : 'available',
      log_loss: null,
      brier: null,
      rps,
      accuracy: null,
      uniform_rps: rps === null ? null : 0.23,
    });
    const answer = (points: ReturnType<typeof point>[]) =>
      ({
        period: 'month',
        overall: { competition: null, model_versions: ['dixon-coles-elo@0.6.0'], points },
        last_updated_at: '2026-10-08T03:00:00Z',
      }) as unknown as PublicModelAccuracyResponse;
    const figure = accuracyFigure(
      answer([point('2026-09', 40, 0.201), point('2026-10', 12, 0.19)]),
    );
    expect(figure?.period).toBe('2026-10');
    expect(figure?.periodKind).toBe('month');
    expect(figure?.periodStart).toBe('2026-10-01');
    expect(figure?.metrics.coverage).toBe('limited');
    expect(figure?.modelVersions).toEqual(['dixon-coles-elo@0.6.0']);
    expect(accuracyFigure(answer([point('2026-10', 0, null)]))).toBeNull();
  });

  it('lists today’s broadcasts only where a source lists one, and says why when none', () => {
    const today = [
      pgpl('a', 'scheduled', '2026-10-08T17:00:00Z'),
      pgpl('b', 'scheduled', '2026-10-08T15:00:00Z'),
      pgpl('done', 'finished', '2026-10-08T10:00:00Z'),
    ];
    const chosen = { state: 'chosen', territory: { code: 'IR', name: 'Iran' } };
    const option = (id: string, at: string) => ({
      id,
      broadcaster: { id: `${id}b`, name: `TV ${id}`, homepage_url: null, kind: 'tv' },
      url: `https://example.org/${id}`,
      source: { id: 's', name: 'Desk', rights: 'link' },
      last_updated_at: at,
    });
    const listed = (id: string, options: unknown[] | null) =>
      ({
        fixture_id: id,
        territory: chosen,
        options: {
          coverage: options === null ? 'not_supplied' : 'available',
          data: options,
          last_updated_at: null,
        },
        highlights: { coverage: 'not_supplied', data: null, last_updated_at: null },
      }) as unknown as MatchViewing;
    const name = (t: { name: string }) => t.name;

    expect(homeBroadcasts(today, null, name)).toEqual({ state: 'unreachable' });
    const unchosen = { fixture_id: 'a', territory: { state: 'not_chosen' } } as never;
    expect(homeBroadcasts(today, [unchosen], name)).toEqual({ state: 'ask' });

    const result = homeBroadcasts(
      today,
      [
        listed('a', [option('x', '2026-10-08T09:00:00Z')]),
        listed('b', [option('y', '2026-10-08T11:00:00Z')]),
        listed('done', [option('z', '2026-10-08T12:00:00Z')]),
      ],
      name,
    );
    expect(result.state).toBe('listed');
    if (result.state === 'listed') {
      // By kick-off; a finished match is not a live broadcast any more.
      expect(result.rows.map((r) => r.card.id)).toEqual(['b', 'a']);
      expect(result.sources).toEqual(['Desk']);
      expect(result.checkedAt).toBe('2026-10-08T11:00:00Z');
      expect(result.territory).toBe('Iran');
    }
    expect(homeBroadcasts(today, [listed('a', [])], name)).toEqual({
      state: 'none',
      territory: 'Iran',
      supplied: true,
    });
    expect(homeBroadcasts(today, [listed('a', null)], name)).toEqual({
      state: 'none',
      territory: 'Iran',
      supplied: false,
    });
  });
});
