import type { NormalisedHighlight, Transport, TransportResponse } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import type { FailureCountsService } from '../failure-counts/failure-counts.service';
import type { EntityResolverService } from '../ingestion/ingestion.service';
import { HighlightFeedService } from './highlight-feed.service';
import {
  type FeedCandidate,
  HIGHLIGHTS_DEFAULT_BUDGET,
  feedConfig,
  feedQuestions,
  matchClips,
  offeredIn,
} from './internal/highlight-feed';
import type { FeedClip, PostgresHighlightFeedStore } from './internal/highlight-feed-store';
import { DailyBudgetTransport } from './internal/highlight-feed-transport';

const KICKOFF = new Date('2026-10-03T19:00:00Z');

function candidate(over: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    fixtureId: 'fx-1',
    held: false,
    kickoffAt: KICKOFF,
    competitionId: 'comp-1',
    leagueExternalId: '119924',
    homeTeamId: 'team-home',
    awayTeamId: 'team-away',
    ...over,
  };
}

function clip(over: Partial<NormalisedHighlight> = {}, match: object = {}): NormalisedHighlight {
  return {
    title: 'Highlights',
    url: 'https://www.youtube.com/watch?v=abc',
    publisher: 'LaLiga',
    externalId: '41001',
    matchHighlights: true,
    ...over,
    match: {
      externalId: '9001',
      kickoffAt: KICKOFF.toISOString(),
      competition: { externalId: '119924', name: 'La Liga' },
      home: { externalId: '501', name: 'Home FC' },
      away: { externalId: '502', name: 'Away FC' },
      ...match,
    },
  };
}

const MAPPED = new Map<string, string | null>([
  ['501', 'team-home'],
  ['502', 'team-away'],
]);

describe('the switch', () => {
  it('is off without a key, whatever else is set', () => {
    expect(feedConfig({})).toEqual({ state: 'absent' });
    expect(feedConfig({ HIGHLIGHTLY_KEY: '  ', HIGHLIGHTS_DAILY_BUDGET: '10' })).toEqual({
      state: 'absent',
    });
  });

  it('is on with a key, at its own ceiling of 5000 unless told otherwise', () => {
    expect(feedConfig({ HIGHLIGHTLY_KEY: 'k' })).toEqual({
      state: 'configured',
      apiKey: 'k',
      dailyBudget: HIGHLIGHTS_DEFAULT_BUDGET,
    });
    expect(HIGHLIGHTS_DEFAULT_BUDGET).toBe(5000);
    expect(feedConfig({ HIGHLIGHTLY_KEY: 'k', HIGHLIGHTS_DAILY_BUDGET: '1200' })).toMatchObject({
      dailyBudget: 1200,
    });
  });

  it('refuses a ceiling that is not a positive whole number rather than guessing', () => {
    for (const bad of ['0', '-5', '2.5', 'lots']) {
      expect(() => feedConfig({ HIGHLIGHTLY_KEY: 'k', HIGHLIGHTS_DAILY_BUDGET: bad })).toThrow(
        /HIGHLIGHTS_DAILY_BUDGET/,
      );
    }
  });
});

describe('where a clip is offered', () => {
  it('everywhere when nothing is restricted', () => {
    expect(offeredIn({ allowed: [], blocked: [] }, 'IR')).toBe(true);
  });

  it('only in an allowed territory when the allow list is not empty', () => {
    const rule = { allowed: ['ES', 'GB'], blocked: [] };
    expect(offeredIn(rule, 'gb')).toBe(true);
    expect(offeredIn(rule, 'IR')).toBe(false);
  });

  it('never in a blocked territory, even one also allowed', () => {
    expect(offeredIn({ allowed: [], blocked: ['IR'] }, 'IR')).toBe(false);
    expect(offeredIn({ allowed: [], blocked: ['IR'] }, 'DE')).toBe(true);
    expect(offeredIn({ allowed: ['IR'], blocked: ['IR'] }, 'IR')).toBe(false);
  });
});

describe('the questions a run asks', () => {
  it('one per league and UTC day with a match still waiting; a held match rides along', () => {
    const { questions, unmappedCompetitions } = feedQuestions([
      candidate({ fixtureId: 'a' }),
      candidate({ fixtureId: 'b', held: true }),
      candidate({ fixtureId: 'c', kickoffAt: new Date('2026-10-04T12:00:00Z') }),
      candidate({ fixtureId: 'd', kickoffAt: new Date('2026-10-02T12:00:00Z'), held: true }),
    ]);
    expect(questions.map((q) => [q.date, q.candidates.map((c) => c.fixtureId)])).toEqual([
      ['2026-10-03', ['a', 'b']],
      ['2026-10-04', ['c']],
    ]);
    expect(unmappedCompetitions.size).toBe(0);
  });

  it('never asks about a competition nobody mapped, and says which', () => {
    const { questions, unmappedCompetitions } = feedQuestions([
      candidate({ leagueExternalId: null, competitionId: 'unmapped' }),
      candidate({ leagueExternalId: null, competitionId: 'done', held: true }),
    ]);
    expect(questions).toEqual([]);
    expect([...unmappedCompetitions]).toEqual(['unmapped']);
  });
});

describe('placing a clip on our match', () => {
  it('needs both teams mapped and one match of theirs near the feed’s kick-off', () => {
    const { matched, unmatched } = matchClips([clip()], [candidate()], MAPPED);
    expect([...matched.keys()]).toEqual(['fx-1']);
    expect(unmatched).toEqual([]);
  });

  it('accepts the pair in either order (a neutral ground is named differently)', () => {
    const swapped = candidate({ homeTeamId: 'team-away', awayTeamId: 'team-home' });
    expect([...matchClips([clip()], [swapped], MAPPED).matched.keys()]).toEqual(['fx-1']);
  });

  it('keeps a clip out when a team is not mapped -- never by its name', () => {
    const half = new Map<string, string | null>([['501', 'team-home']]);
    const { matched, unmatched } = matchClips([clip()], [candidate()], half);
    expect(matched.size).toBe(0);
    expect(unmatched.map((u) => u.reason)).toEqual(['team_unmapped']);
  });

  it('keeps a clip out when no match of ours is within three hours', () => {
    const late = clip({}, { kickoffAt: '2026-10-03T22:30:00.000Z' });
    expect(matchClips([late], [candidate()], MAPPED).unmatched[0]?.reason).toBe('no_fixture');
    const near = clip({}, { kickoffAt: '2026-10-03T21:30:00.000Z' });
    expect(matchClips([near], [candidate()], MAPPED).matched.size).toBe(1);
  });

  it('keeps a clip out when two of our matches would fit', () => {
    const twice = [candidate(), candidate({ fixtureId: 'fx-2' })];
    expect(matchClips([clip()], twice, MAPPED).unmatched[0]?.reason).toBe('ambiguous');
  });

  it('ranks full-match highlights before a clip that named no category', () => {
    const vague = clip({ externalId: '1', matchHighlights: false });
    const full = clip({ externalId: '2', matchHighlights: true });
    const ranked = matchClips([vague, full], [candidate()], MAPPED).matched.get('fx-1');
    expect(ranked?.map((c) => c.externalId)).toEqual(['2', '1']);
  });
});

describe('the budget', () => {
  const inner: Transport = {
    request: () => Promise.resolve({ status: 200, body: {}, receivedAt: 'x' }),
  };

  it('answers 429 once the day’s ceiling is spent and starts again the next UTC day', async () => {
    let now = new Date('2026-10-03T23:59:00Z');
    const budget = new DailyBudgetTransport(inner, 2, () => now);
    expect((await budget.request('u')).status).toBe(200);
    expect((await budget.request('u')).status).toBe(200);
    expect((await budget.request('u')).status).toBe(429);
    expect(budget.used).toBe(2);
    now = new Date('2026-10-04T00:00:01Z');
    expect(budget.used).toBe(0);
    expect((await budget.request('u')).status).toBe(200);
  });
});

/** A scripted provider: each URL pattern answers in turn. */
class Provider implements Transport {
  readonly urls: string[] = [];
  constructor(private readonly answer: (url: string) => TransportResponse) {}
  request(url: string): Promise<TransportResponse> {
    this.urls.push(url);
    return Promise.resolve(this.answer(url));
  }
}

const ok = (body: unknown): TransportResponse => ({ status: 200, body, receivedAt: 'x' });

function listBody(items: object[]): object {
  return { data: items, pagination: { totalCount: items.length, offset: 0, limit: 40 } };
}

function rawItem(id: number, over: object = {}): object {
  return {
    id,
    type: 'VERIFIED',
    title: `Clip ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    channel: 'LaLiga',
    category: 'match-highlights',
    match: {
      id: 9001,
      date: KICKOFF.toISOString(),
      homeTeam: { id: 501, name: 'Home FC' },
      awayTeam: { id: 502, name: 'Away FC' },
      league: { id: 119924, name: 'La Liga', season: 2026 },
    },
    ...over,
  };
}

function service(
  env: NodeJS.ProcessEnv,
  transport: Transport,
  candidates: FeedCandidate[] = [candidate()],
): { feed: HighlightFeedService; stored: [string, FeedClip][]; resolved: string[] } {
  const stored: [string, FeedClip][] = [];
  const resolved: string[] = [];
  const store = {
    candidates: () => Promise.resolve(candidates),
    store: (fixtureId: string, value: FeedClip) => {
      stored.push([fixtureId, value]);
      return Promise.resolve(true);
    },
  } as unknown as PostgresHighlightFeedStore;
  const resolver = {
    resolve: (ref: { externalId: string }) => {
      resolved.push(ref.externalId);
      const internalId = MAPPED.get(ref.externalId);
      return Promise.resolve(
        internalId == null
          ? { kind: 'queued', unresolvedId: 'u', seenCount: 1 }
          : { kind: 'resolved', internalId },
      );
    },
  } as unknown as EntityResolverService;
  const failures = { watch: () => undefined } as unknown as FailureCountsService;
  return {
    feed: new HighlightFeedService(feedConfig(env), transport, store, resolver, failures),
    stored,
    resolved,
  };
}

describe('the feed', () => {
  it('without a key: no request, no row, no queue, and the health endpoint says so', async () => {
    const provider = new Provider(() => ok({}));
    const { feed, stored } = service({}, provider);
    const before = { ...process.env };
    process.env.INGESTION_SCHEDULE = 'on';
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    try {
      await feed.onModuleInit();
    } finally {
      process.env.INGESTION_SCHEDULE = before.INGESTION_SCHEDULE;
      process.env.REDIS_URL = before.REDIS_URL;
      if (before.INGESTION_SCHEDULE === undefined) delete process.env.INGESTION_SCHEDULE;
      if (before.REDIS_URL === undefined) delete process.env.REDIS_URL;
    }
    expect(await feed.run()).toBeNull();
    expect(provider.urls).toEqual([]);
    expect(stored).toEqual([]);
    expect(feed.health()).toEqual({
      feed: 'absent',
      scheduled: false,
      daily_budget: null,
      requests_today: null,
      last_run: null,
    });
    await feed.onApplicationShutdown();
  });

  it('keeps the best verified clip whose territories are known, with its rule', async () => {
    const provider = new Provider((url) => {
      if (url.includes('/geo-restrictions/7')) return ok({ state: 'Unknown restrictions' });
      if (url.includes('/geo-restrictions/8')) {
        return ok({ state: 'Blocked countries restriction', blockedCountries: ['IR'] });
      }
      return ok(
        listBody([
          rawItem(6, { type: 'UNVERIFIED' }),
          rawItem(8, { category: undefined }),
          rawItem(7),
        ]),
      );
    });
    const { feed, stored, resolved } = service({ HIGHLIGHTLY_KEY: 'k' }, provider);
    const run = await feed.run();
    expect(stored).toEqual([
      [
        'fx-1',
        {
          url: 'https://www.youtube.com/watch?v=8',
          title: 'Clip 8',
          publisher: 'LaLiga',
          allowed: [],
          blocked: ['IR'],
        },
      ],
    ]);
    expect(resolved.sort()).toEqual(['501', '502']);
    expect(run).toMatchObject({
      waiting: 1,
      questions: 1,
      stored: 1,
      no_territory_rule: 1,
      requests: 3,
      stopped: null,
    });
    expect(feed.health()).toMatchObject({ feed: 'configured', requests_today: 3 });
  });

  it('stops where it is when the day’s ceiling is spent', async () => {
    const provider = new Provider(() => ok(listBody([rawItem(7)])));
    const { feed, stored } = service(
      { HIGHLIGHTLY_KEY: 'k', HIGHLIGHTS_DAILY_BUDGET: '1' },
      provider,
      [candidate(), candidate({ fixtureId: 'fx-2', leagueExternalId: '2' })],
    );
    const run = await feed.run();
    expect(provider.urls).toHaveLength(1);
    expect(stored).toEqual([]);
    expect(run).toMatchObject({ stopped: 'quota', requests: 2 });
  });

  it('reports a clip whose team is unmapped, and asks nothing more about it', async () => {
    const provider = new Provider(() =>
      ok(
        listBody([
          rawItem(7, {
            match: {
              ...(rawItem(7) as { match: object }).match,
              homeTeam: { id: 999, name: 'Stranger' },
            },
          }),
        ]),
      ),
    );
    const { feed, stored, resolved } = service({ HIGHLIGHTLY_KEY: 'k' }, provider);
    const run = await feed.run();
    expect(resolved).toContain('999');
    expect(stored).toEqual([]);
    expect(run?.unmatched).toEqual({ team_unmapped: 1, no_fixture: 0, ambiguous: 0 });
    expect(provider.urls).toHaveLength(1);
  });
});
