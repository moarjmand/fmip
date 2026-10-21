import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NormalisedBoxScore, Transport, TransportResponse } from '@fmip/ingestion';
import { mapBoxScore } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import type { FailureCountsService } from '../failure-counts/failure-counts.service';
import type { EntityResolverService } from '../ingestion/ingestion.service';
import { BoxScoreFeedService } from './box-score-feed.service';
import { HighlightlyQuota } from './highlightly-quota.service';
import {
  BOX_SCORE_DEFAULT_BATCH,
  type BoxScoreCandidate,
  type ExpectedRow,
  LINEUP_RULE_ACTOR,
  type PlayerPlacement,
  boxScoreBatch,
  boxScoreRows,
  namesAgree,
} from './internal/box-score-feed';
import type { LineupShirt, PostgresBoxScoreStore } from './internal/box-score-store';
import { feedConfig } from './internal/highlight-feed';

// The box score recorded read-only on the Pro plan (T-1432): Serie A,
// Juventus 0-3 Lazio, 2026-10-18, Highlightly match 1319180136.
const RECORDING = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'ingestion',
  'src',
  'adapters',
  '_fixtures',
  'highlightly-box-score',
);
function recorded(name: string): unknown {
  const file = JSON.parse(readFileSync(join(RECORDING, `${name}.json`), 'utf8')) as {
    requests: { body: unknown }[];
  };
  return file.requests[0]!.body;
}
const BOX = recorded('box-score-juventus-lazio');
const MATCHES = recorded('matches-serie-a-2026-10-18');
const SCORE = mapBoxScore(BOX)!;

const JUVENTUS = '422880';
const LAZIO = '415221';
const KICKOFF = new Date('2026-10-18T18:45:00Z');
const NOW = new Date('2026-10-19T08:00:00Z');

function candidate(over: Partial<BoxScoreCandidate> = {}): BoxScoreCandidate {
  return {
    fixtureId: 'fx-juv-laz',
    held: false,
    kickoffAt: KICKOFF,
    competitionId: 'serie-a',
    leagueExternalId: '115669',
    homeTeamId: 'team-juv',
    awayTeamId: 'team-laz',
    homeParticipantId: 'part-juv',
    awayParticipantId: 'part-laz',
    ...over,
  };
}
const TEAMS = new Map<string, string | null>([
  [JUVENTUS, 'team-juv'],
  [LAZIO, 'team-laz'],
]);
function idOf(score: NormalisedBoxScore, name: string): string {
  return score.sides.flatMap((s) => s.players).find((p) => p.name === name)!.externalId;
}

describe('BOX_SCORE_BATCH', () => {
  it('defaults when empty and refuses anything but a positive whole number', () => {
    expect(boxScoreBatch({})).toBe(BOX_SCORE_DEFAULT_BATCH);
    expect(boxScoreBatch({ BOX_SCORE_BATCH: ' 12 ' })).toBe(12);
    for (const bad of ['0', '-3', '2.5', 'many']) {
      expect(() => boxScoreBatch({ BOX_SCORE_BATCH: bad })).toThrow(/BOX_SCORE_BATCH/);
    }
  });
});

describe('boxScoreRows', () => {
  const people = new Map<string, PlayerPlacement>([
    [idOf(SCORE, 'R. Kolo Muani'), { kind: 'resolved', personId: 'kolo' }],
    [idOf(SCORE, 'G. Vicario'), { kind: 'resolved', personId: 'vicario' }],
    [idOf(SCORE, 'O. Provstgaard'), { kind: 'resolved', personId: 'provstgaard' }],
    [idOf(SCORE, 'D. Rugani'), { kind: 'resolved', personId: 'rugani' }],
  ]);

  it("writes a placed player's figures on their side, and counts everyone else as unresolved", () => {
    const decided = boxScoreRows(SCORE, candidate(), TEAMS, people);
    expect(decided.kind).toBe('rows');
    if (decided.kind !== 'rows') return;
    expect(decided.players).toBe(47);
    expect(decided.unresolved).toBe(43);
    const by = (person: string) =>
      Object.fromEntries(
        decided.rows.filter((r) => r.personId === person).map((r) => [r.metric, r.value]),
      );
    expect(by('kolo')).toEqual({ xg: 0.38, xa: 0.12 });
    expect(by('vicario')).toEqual({ xa: 0, xgot_conceded: 1.2, xgp: -1.75 });
    expect(by('provstgaard')).toEqual({ xg: 0.24, xa: 0.01, xgot: 0.55 });
    // An unused substitute is placed and has no figure: no row, never a zero.
    expect(by('rugani')).toEqual({});
    const sides = new Set(decided.rows.map((r: ExpectedRow) => `${r.personId}:${r.participantId}`));
    expect(sides).toEqual(new Set(['kolo:part-juv', 'vicario:part-juv', 'provstgaard:part-laz']));
  });

  it('places the sides by team, whichever order the source lists them in', () => {
    const swapped = candidate({
      homeTeamId: 'team-laz',
      awayTeamId: 'team-juv',
      homeParticipantId: 'part-laz',
      awayParticipantId: 'part-juv',
    });
    const decided = boxScoreRows(SCORE, swapped, TEAMS, people);
    expect(
      decided.kind === 'rows' && decided.rows.find((r) => r.personId === 'kolo'),
    ).toMatchObject({ participantId: 'part-juv' });
  });

  it('stores nothing when a side is neither of the match teams', () => {
    const other = new Map(TEAMS);
    other.set(LAZIO, 'team-somebody-else');
    expect(boxScoreRows(SCORE, candidate(), other, people)).toEqual({
      kind: 'side_mismatch',
      teamExternalId: LAZIO,
    });
  });

  it('keeps the first entry when two of the source ids are one person', () => {
    const twice = new Map(people);
    twice.set(idOf(SCORE, 'Bremer'), { kind: 'resolved', personId: 'kolo' });
    const decided = boxScoreRows(SCORE, candidate(), TEAMS, twice);
    expect(
      decided.kind === 'rows' &&
        decided.rows.filter((r) => r.personId === 'kolo').map((r) => r.metric),
    ).toEqual(['xa']);
  });

  it('is not ready when the source lists nobody yet', () => {
    expect(boxScoreRows({ sides: [], malformed: 0 }, candidate(), TEAMS, people)).toEqual({
      kind: 'not_ready',
    });
  });
});

class Provider implements Transport {
  readonly urls: string[] = [];
  constructor(private readonly answer: (url: string) => TransportResponse) {}
  request(url: string): Promise<TransportResponse> {
    this.urls.push(url);
    return Promise.resolve(this.answer(url));
  }
}
const ok = (body: unknown): TransportResponse => ({
  status: 200,
  body,
  receivedAt: '2026-10-19T08:00:01.000Z',
});
// The recorded box score for its own match; any other match's is not out yet.
const recordedProvider = () =>
  new Provider((url) =>
    url.endsWith('/box-score/1319180136')
      ? ok(BOX)
      : url.includes('/box-score/')
        ? ok([])
        : ok(MATCHES),
  );

function service(
  env: NodeJS.ProcessEnv,
  transport: Transport,
  candidates: BoxScoreCandidate[],
  mapped: ReadonlyMap<string, string>,
  batch = 60,
  // Our line-up's shirt 16 for Lazio; by default its name is not the source's, so it is only a hint.
  lineupNames: string[] = ['Someone Else'],
  ignored: ReadonlySet<string> = new Set(),
) {
  const stored: { fixtureId: string; rows: ExpectedRow[]; players: number; unresolved: number }[] =
    [];
  const queued: { externalId: string; entityType: string; payload: unknown }[] = [];
  const linked: { externalId: string; internalId: string; actor: string }[] = [];
  const shirts: LineupShirt[] = [
    { participantId: 'part-laz', shirtNumber: 16, personId: 'frattesi', names: lineupNames },
  ];
  const store = {
    candidates: () => Promise.resolve(candidates),
    lineupShirts: () => Promise.resolve(shirts),
    store: (
      c: { fixtureId: string },
      a: { rows: ExpectedRow[]; players: number; unresolved: number },
    ) => {
      stored.push({ fixtureId: c.fixtureId, ...a });
      return Promise.resolve();
    },
  } as unknown as PostgresBoxScoreStore;
  const resolver = {
    resolve: (ref: { externalId: string; entityType: string }, payload: unknown) => {
      const internalId = mapped.get(`${ref.entityType}:${ref.externalId}`);
      if (internalId !== undefined) return Promise.resolve({ kind: 'resolved', internalId });
      queued.push({ externalId: ref.externalId, entityType: ref.entityType, payload });
      if (ignored.has(ref.externalId))
        return Promise.resolve({ kind: 'ignored', unresolvedId: 'u' });
      return Promise.resolve({ kind: 'queued', unresolvedId: 'u', seenCount: 1 });
    },
    link: (ref: { externalId: string }, internalId: string, actor: string) => {
      linked.push({ externalId: ref.externalId, internalId, actor });
      return Promise.resolve({ kind: 'linked', internalId });
    },
  } as unknown as EntityResolverService;
  const failures = { watch: () => undefined } as unknown as FailureCountsService;
  const config = feedConfig(env);
  const quota = new HighlightlyQuota(config, transport);
  return {
    jobs: new BoxScoreFeedService(config, batch, quota, store, resolver, failures),
    quota,
    stored,
    queued,
    linked,
  };
}

const MAPPED = new Map([
  [`team:${JUVENTUS}`, 'team-juv'],
  [`team:${LAZIO}`, 'team-laz'],
  [`person:${idOf(SCORE, 'R. Kolo Muani')}`, 'kolo'],
  [`person:${idOf(SCORE, 'C. Mandas')}`, 'mandas'],
]);
const KEY = { HIGHLIGHTLY_KEY: 'test-key', HIGHLIGHTS_DAILY_BUDGET: '100' };

describe('the box-score job', () => {
  it('without a key: no request, nothing stored, and the health says so', async () => {
    const provider = recordedProvider();
    const { jobs, stored } = service({}, provider, [candidate()], MAPPED);
    expect(await jobs.run(NOW)).toBeNull();
    expect(provider.urls).toEqual([]);
    expect(stored).toEqual([]);
    expect(jobs.health()).toMatchObject({ feed: 'absent', batch: null, daily_budget: null });
  });

  it("finds our match on the source's list, asks once, and stores the placed players' figures", async () => {
    const provider = recordedProvider();
    const { jobs, stored } = service(KEY, provider, [candidate()], MAPPED);
    const run = await jobs.run(NOW);
    expect(provider.urls).toEqual([
      'https://soccer.highlightly.net/matches?leagueId=115669&date=2026-10-18&timezone=Etc%2FUTC&limit=100',
      'https://soccer.highlightly.net/box-score/1319180136',
    ]);
    expect(run).toMatchObject({
      waiting: 1,
      questions: 1,
      asked: 1,
      stored: 1,
      players_unresolved: 45,
      requests: 2,
      stopped: null,
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ fixtureId: 'fx-juv-laz', players: 47, unresolved: 45 });
    expect(
      stored[0]!.rows.map((r) => [r.personId, r.participantId, r.metric, r.value]).sort(),
    ).toEqual(
      [
        ['kolo', 'part-juv', 'xa', 0.12],
        ['kolo', 'part-juv', 'xg', 0.38],
        ['mandas', 'part-laz', 'xa', 0],
        ['mandas', 'part-laz', 'xgot_conceded', 0.09],
        ['mandas', 'part-laz', 'xgp', 0.09],
      ].sort(),
    );
  });

  it("queues an unmapped player with a reviewer's hint from our line-up's shirt, never a mapping", async () => {
    const { jobs, queued } = service(KEY, recordedProvider(), [candidate()], MAPPED);
    await jobs.run(NOW);
    const frattesi = queued.find((q) => q.externalId === idOf(SCORE, 'D. Frattesi'));
    expect(frattesi).toEqual({
      externalId: idOf(SCORE, 'D. Frattesi'),
      entityType: 'person',
      payload: {
        name: 'D. Frattesi',
        seenIn: 'serie-a',
        fixture: 'fx-juv-laz',
        team: 'team-laz',
        shirtNumber: 16,
        lineupPerson: 'frattesi',
      },
    });
    const zaccagni = queued.find((q) => q.externalId === idOf(SCORE, 'M. Zaccagni'));
    expect(zaccagni?.payload).toMatchObject({ shirtNumber: 10, lineupPerson: null });
  });

  it('maps a player by the line-up rule when the shirt and the name agree (T-1436)', async () => {
    const { jobs, stored, linked } = service(KEY, recordedProvider(), [candidate()], MAPPED, 60, [
      'Davide Frattesi',
    ]);
    const run = await jobs.run(NOW);
    expect(linked).toEqual([
      { externalId: idOf(SCORE, 'D. Frattesi'), internalId: 'frattesi', actor: LINEUP_RULE_ACTOR },
    ]);
    expect(run).toMatchObject({ players_linked: 1, players_unresolved: 44 });
    expect(stored[0]).toMatchObject({ players: 47, unresolved: 44 });
    expect(stored[0]!.rows.some((r) => r.personId === 'frattesi')).toBe(true);
  });

  it('never maps by the shirt alone, nor a player a reviewer ignored', async () => {
    const other = service(KEY, recordedProvider(), [candidate()], MAPPED);
    expect(await other.jobs.run(NOW)).toMatchObject({ players_linked: 0, players_unresolved: 45 });
    expect(other.linked).toEqual([]);
    const ignored = service(
      KEY,
      recordedProvider(),
      [candidate()],
      MAPPED,
      60,
      ['Davide Frattesi'],
      new Set([idOf(SCORE, 'D. Frattesi')]),
    );
    expect(await ignored.jobs.run(NOW)).toMatchObject({ players_linked: 0 });
    expect(ignored.linked).toEqual([]);
  });

  it('asks nothing for a held match, and nothing at all when every match of the day is held', async () => {
    const provider = recordedProvider();
    const { jobs, stored } = service(KEY, provider, [candidate({ held: true })], MAPPED);
    expect(await jobs.run(NOW)).toMatchObject({ waiting: 0, questions: 0, requests: 0 });
    expect(provider.urls).toEqual([]);
    expect(stored).toEqual([]);
  });

  it('counts a match it cannot place, by reason, and spends no box-score request on it', async () => {
    const provider = recordedProvider();
    const unmappedLazio = new Map(MAPPED);
    unmappedLazio.delete(`team:${LAZIO}`);
    const { jobs, queued } = service(KEY, provider, [candidate()], unmappedLazio);
    expect(await jobs.run(NOW)).toMatchObject({
      unmatched: { team_unmapped: 1, no_fixture: 0, ambiguous: 0 },
      asked: 0,
      requests: 1,
    });
    expect(queued.some((q) => q.entityType === 'team' && q.externalId === LAZIO)).toBe(true);

    const elsewhere = service(
      KEY,
      recordedProvider(),
      [candidate({ kickoffAt: new Date('2026-10-18T23:30:00Z') })],
      MAPPED,
    );
    expect(await elsewhere.jobs.run(NOW)).toMatchObject({
      unmatched: { team_unmapped: 0, no_fixture: 1, ambiguous: 0 },
    });
  });

  it('asks again later when the source has no players yet, and stores nothing', async () => {
    const provider = new Provider((url) => (url.includes('/box-score/') ? ok([]) : ok(MATCHES)));
    const { jobs, stored } = service(KEY, provider, [candidate()], MAPPED);
    expect(await jobs.run(NOW)).toMatchObject({ asked: 1, stored: 0, not_ready: 1 });
    expect(stored).toEqual([]);
  });

  it('stops at the batch, and at the shared ceiling, and the health reads the shared count', async () => {
    // Two of our matches on the day's list: AC Milan-Atalanta and Juventus-Lazio.
    const milan = candidate({
      fixtureId: 'fx-mil-ata',
      kickoffAt: new Date('2026-10-18T16:00:00Z'),
      homeTeamId: 'team-mil',
      awayTeamId: 'team-ata',
      homeParticipantId: 'part-mil',
      awayParticipantId: 'part-ata',
    });
    const both = new Map(MAPPED);
    both.set('team:416923', 'team-mil');
    both.set('team:425433', 'team-ata');
    const batched = service(KEY, recordedProvider(), [milan, candidate()], both, 1);
    expect(await batched.jobs.run(NOW)).toMatchObject({ asked: 1, stopped: 'batch', requests: 2 });

    const tight = service(
      { HIGHLIGHTLY_KEY: 'k', HIGHLIGHTS_DAILY_BUDGET: '1' },
      recordedProvider(),
      [candidate()],
      MAPPED,
    );
    expect(await tight.jobs.run(NOW)).toMatchObject({ requests: 2, stopped: 'quota', stored: 0 });
    expect(tight.quota.reading()).toEqual({ configured: true, requestsToday: 1, budget: 1 });
    expect(tight.jobs.health()).toMatchObject({ requests_today: 1, daily_budget: 1, batch: 60 });
  });
});

describe('namesAgree (T-1436)', () => {
  it('agrees on a shared word, setting aside accents, case and initials', () => {
    expect(namesAgree('D. Frattesi', ['Davide Frattesi'])).toBe(true);
    expect(
      namesAgree('Vinicius Jr.', ['Vinícius José Paixão de Oliveira Júnior', 'Vinícius Júnior']),
    ).toBe(true);
    expect(namesAgree('F. de Jong', ['Frenkie de Jong'])).toBe(true);
    expect(namesAgree('Rodrygo', ['Rodrygo Silva de Goes'])).toBe(true);
  });

  it('disagrees when only particles, suffixes or initials are shared, or nothing is', () => {
    expect(namesAgree('M. Zaccagni', ['Davide Frattesi'])).toBe(false);
    expect(namesAgree('L. de Vries', ['Frenkie de Jong'])).toBe(false);
    expect(namesAgree('A. Junior', ['Junior Firpo'])).toBe(false);
    expect(namesAgree('Jr.', ['Neymar Jr'])).toBe(false);
    expect(namesAgree('D.', ['Davide Frattesi'])).toBe(false);
    expect(namesAgree('D. Frattesi', [])).toBe(false);
  });
});
