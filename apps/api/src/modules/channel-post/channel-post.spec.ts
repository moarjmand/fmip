import type {
  ChannelPostKind,
  ForecastListEntry,
  PublicModelAccuracyResponse,
  ScoreCard,
  ScoresFilters,
  ScoresResponse,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import type { FixturesService } from '../fixtures/fixtures.service';
import type { CountedEvaluation, EvaluationService } from '../forecast/evaluation.service';
import type { ForecastService } from '../forecast/forecast.service';
import {
  ChannelRefusal,
  type ChannelPublisher,
  DEFAULT_POST_HOUR,
  channelPostConfigFromEnv,
  postHourFromEnv,
} from './channel-post.port';
import { ChannelPostService } from './channel-post.service';
import type { ChannelPostRecord, PostgresChannelPostStore } from './internal/channel-post-store';
import type { DailyPost } from './internal/daily-post';

const FAKE_TOKEN = `123456:${'x'.repeat(35)}`;
const AFTER_POST_HOUR = new Date('2026-09-27T06:41:00Z');

/** The store's rules without a database; `channel-post.http.spec.ts` proves the SQL keeps them. */
class MemoryStore {
  /** By day for the forecast post, by `kind:day` for the others. */
  readonly rows = new Map<string, ChannelPostRecord>();
  private key(kind: ChannelPostKind, day: string): string {
    return kind === 'forecast' ? day : `${kind}:${day}`;
  }

  async get(kind: ChannelPostKind, day: string): Promise<ChannelPostRecord | null> {
    return this.rows.get(this.key(kind, day)) ?? null;
  }
  async latest(kind: ChannelPostKind): Promise<ChannelPostRecord | null> {
    return (
      [...this.rows.values()]
        .filter((row) => row.kind === kind)
        .sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null
    );
  }
  async claim(kind: ChannelPostKind, post: DailyPost): Promise<boolean> {
    const existing = this.rows.get(this.key(kind, post.day));
    if (existing !== undefined && existing.state !== 'refused') return false;
    this.rows.set(this.key(kind, post.day), {
      kind,
      day: post.day,
      state: 'sending',
      messages: post.messages,
      delivered: 0,
      attempts: (existing?.attempts ?? 0) + 1,
      finishedAt: null,
      failure: null,
    });
    return true;
  }
  async delivered(kind: ChannelPostKind, day: string): Promise<void> {
    const row = this.rows.get(this.key(kind, day));
    if (row !== undefined) row.delivered += 1;
  }
  async finish(
    kind: ChannelPostKind,
    day: string,
    state: ChannelPostRecord['state'],
    failure?: string,
  ): Promise<void> {
    const row = this.rows.get(this.key(kind, day));
    if (row === undefined) return;
    row.state = state;
    row.failure = failure ?? null;
    row.finishedAt = new Date().toISOString();
  }
}

class FakeChannel implements ChannelPublisher {
  readonly provider = 'fake';
  readonly posted: string[] = [];
  /** Answers for the next posts, in order; a post with none left succeeds. */
  readonly answers: (Error | null)[] = [];

  async post(text: string): Promise<void> {
    const answer = this.answers.shift() ?? null;
    if (answer !== null) throw answer;
    this.posted.push(text);
  }
}

function card(id: string, kickoff = '2026-09-27T14:00:00.000Z'): ScoreCard {
  return {
    id,
    kickoff_at: kickoff,
    status: 'scheduled',
    minute: null,
    competition: { id: 'c', name: 'Premier League', short_name: null, country_id: 'e' },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'Arsenal', short_name: null, code: null },
    away: { id: 'a', name: 'Chelsea', short_name: null, code: null },
    scores: {
      current: null,
      half_time: null,
      full_time: null,
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: null,
    coverage: 'available',
    last_updated_at: '2026-09-26T00:00:00.000Z',
    freshness: null,
    pinned: false,
  };
}

/** A finished card, home win 2-1 unless told otherwise. */
function finished(id: string, kickoff = '2026-09-26T14:00:00.000Z'): ScoreCard {
  const c = card(id, kickoff);
  return {
    ...c,
    status: 'finished',
    scores: { ...c.scores, full_time: { home: 2, away: 1 } },
  };
}

/** The stored evaluation the accuracy figures count, as `EvaluationService.countedFor` answers. */
function scored(fixtureId: string, correct: boolean): CountedEvaluation {
  return {
    hasForecast: true,
    evaluation: {
      id: `e-${fixtureId}`,
      forecast_id: `f-${fixtureId}`,
      fixture_id: fixtureId,
      version_number: 2,
      kind: 'early',
      model_version: 'dixon-coles@1.0.0',
      computed_at: '2026-09-26T08:00:00.000Z',
      evaluated_at: '2026-09-26T16:00:00.000Z',
      pre_kickoff: true,
      actual: { home: 2, away: 1 },
      outcome: 'home',
      p_outcome: correct ? 0.5 : 0.2,
      log_loss: 0.7,
      brier: 0.4,
      rps: 0.15,
      correct,
      scoreline_hit: false,
      probabilities: correct
        ? { home: 0.5, draw: 0.3, away: 0.2 }
        : { home: 0.2, draw: 0.3, away: 0.5 },
    },
  };
}

function accuracyFor(weekStart: string, matches: number): PublicModelAccuracyResponse {
  const point = {
    period: '2026-W39',
    period_start: weekStart,
    forecasts: matches,
    matches,
    coverage: 'limited' as const,
    log_loss: 0.98,
    brier: 0.58,
    rps: 0.2,
    accuracy: 0.5,
    uniform_rps: 0.23,
  };
  return {
    period: 'week',
    minimum_matches: 30,
    reference: { uniform_log_loss: 1.0986, uniform_brier: 0.6667, uniform_accuracy: 1 / 3 },
    overall: {
      competition: null,
      model_versions: ['dixon-coles@1.0.0'],
      total: point,
      points: matches === 0 ? [] : [point],
    },
    competitions: [],
    last_updated_at: null,
  };
}

function harness(
  cards: ScoreCard[],
  postHour = DEFAULT_POST_HOUR,
  {
    /** Other days' scores lists, by day: the results post asks for the day before. */
    lists = {} as Record<string, ScoreCard[]>,
    counted = new Map<string, CountedEvaluation>(),
    accuracy = null as PublicModelAccuracyResponse | null,
  } = {},
) {
  const store = new MemoryStore();
  const channel = new FakeChannel();
  const asked: ScoresFilters[] = [];
  const fixtures = {
    scores: async (filters: ScoresFilters, viewer: string | null) => {
      asked.push(filters);
      expect(viewer).toBeNull();
      const list = lists[filters.from ?? ''] ?? (filters.from === '2026-09-27' ? cards : []);
      const response = {
        filters,
        generated_at: '',
        total: list.length,
        pinned: [],
        groups:
          list.length === 0
            ? []
            : [
                {
                  country: { id: 'e', name: 'England', code: 'ENG' },
                  competition: { id: 'c', name: 'Premier League', short_name: null },
                  fixtures: list,
                },
              ],
      } as unknown as ScoresResponse;
      return { kind: 'ok' as const, response };
    },
  } as unknown as FixturesService;
  const forecasts = {
    latestFor: async (ids: string[]): Promise<ForecastListEntry[]> =>
      ids.map((id) => ({ fixture_id: id, latest: null })),
  } as unknown as ForecastService;
  const evaluations = {
    countedFor: async (ids: string[]) => new Map([...counted].filter(([id]) => ids.includes(id))),
    publicAccuracy: async (period: string) => {
      expect(period).toBe('week');
      if (accuracy === null) throw new Error('the accuracy was not expected to be asked for');
      return accuracy;
    },
  } as unknown as EvaluationService;
  const service = new ChannelPostService(
    { publisher: channel, postHour, origin: 'https://fmip.example' },
    store as unknown as PostgresChannelPostStore,
    fixtures,
    forecasts,
    evaluations,
  );
  return { service, store, channel, asked };
}

describe('the configuration', () => {
  it('is off with nothing set, and links to WEB_BASE_URL', () => {
    const config = channelPostConfigFromEnv({ WEB_BASE_URL: 'https://fmip.example/' });
    expect(config).toEqual({
      publisher: null,
      postHour: DEFAULT_POST_HOUR,
      origin: 'https://fmip.example',
    });
  });

  it('drives Telegram when both values are set, without the rest of the module knowing', () => {
    const config = channelPostConfigFromEnv({
      TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
      TELEGRAM_CHANNEL: '@fmip_daily',
    });
    expect(config.publisher?.provider).toBe('telegram');
  });

  it('reads the post hour as a whole UTC hour and refuses anything else', () => {
    expect(postHourFromEnv({})).toBe(6);
    expect(postHourFromEnv({ CHANNEL_POST_HOUR: '0' })).toBe(0);
    expect(postHourFromEnv({ CHANNEL_POST_HOUR: ' 18 ' })).toBe(18);
    for (const bad of ['24', '-1', '6.5', 'six']) {
      expect(() => postHourFromEnv({ CHANNEL_POST_HOUR: bad })).toThrow(/CHANNEL_POST_HOUR/);
    }
  });
});

describe('ChannelPostService.run', () => {
  it('does nothing at all when no channel is configured', async () => {
    const { store, asked } = harness([card('f1')]);
    const off = new ChannelPostService(
      { publisher: null, postHour: 6, origin: 'https://fmip.example' },
      store as unknown as PostgresChannelPostStore,
      {} as FixturesService,
      {} as ForecastService,
      {} as EvaluationService,
    );
    expect(await off.run(AFTER_POST_HOUR)).toEqual({ kind: 'off' });
    expect(asked).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it('waits for the post hour', async () => {
    const { service, channel } = harness([card('f1')], 7);
    expect(await service.run(AFTER_POST_HOUR)).toEqual({ kind: 'too_early', day: '2026-09-27' });
    expect(channel.posted).toHaveLength(0);
  });

  it("asks for the UTC day's list as a guest, posts it once, and records it", async () => {
    const { service, store, channel, asked } = harness([card('f1')]);
    expect(await service.run(AFTER_POST_HOUR)).toEqual({
      kind: 'sent',
      day: '2026-09-27',
      messages: 1,
    });
    expect(asked[0]).toMatchObject({ from: '2026-09-27', to: '2026-09-27', timezone: 'UTC' });
    expect(channel.posted).toHaveLength(1);
    expect(channel.posted[0]).toContain("The statistical model's forecast");
    expect(channel.posted[0]).toContain('https://fmip.example/en/match/f1');
    expect(store.rows.get('2026-09-27')).toMatchObject({ state: 'sent', delivered: 1 });

    // Every later tick that day finds it on record.
    expect(await service.run(new Date('2026-09-27T07:41:00Z'))).toEqual({
      kind: 'already',
      day: '2026-09-27',
      state: 'sent',
    });
    expect(channel.posted).toHaveLength(1);
  });

  it('posts nothing and records nothing on a day with no match', async () => {
    const { service, store, channel } = harness([]);
    expect(await service.run(AFTER_POST_HOUR)).toEqual({ kind: 'nothing', day: '2026-09-27' });
    expect(channel.posted).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it('posts nothing when every match of the day has already kicked off', async () => {
    const { service, store } = harness([card('f1', '2026-09-27T02:00:00.000Z')]);
    expect(await service.run(AFTER_POST_HOUR)).toEqual({ kind: 'nothing', day: '2026-09-27' });
    expect(store.rows.size).toBe(0);
  });

  it('tries a refused day again later, because nothing went out', async () => {
    const { service, store, channel } = harness([card('f1')]);
    channel.answers.push(new ChannelRefusal('telegram refused (403): not an administrator'));
    expect(await service.run(AFTER_POST_HOUR)).toMatchObject({ kind: 'refused' });
    expect(store.rows.get('2026-09-27')).toMatchObject({ state: 'refused', delivered: 0 });

    expect(await service.run(new Date('2026-09-27T07:41:00Z'))).toMatchObject({ kind: 'sent' });
    expect(channel.posted).toHaveLength(1);
    expect(store.rows.get('2026-09-27')).toMatchObject({ state: 'sent', attempts: 2 });
  });

  it('never tries a failed day again: a timeout does not say whether the message went out', async () => {
    const { service, store, channel } = harness([card('f1')]);
    channel.answers.push(new Error('telegram unreachable: TimeoutError'));
    expect(await service.run(AFTER_POST_HOUR)).toMatchObject({ kind: 'failed', delivered: 0 });
    expect(await service.run(new Date('2026-09-27T07:41:00Z'))).toMatchObject({
      kind: 'already',
      state: 'failed',
    });
    expect(channel.posted).toHaveLength(0);
    expect(store.rows.get('2026-09-27')?.failure).toBe('telegram unreachable: TimeoutError');
  });

  it('treats a refusal after the first message as final, so no message is repeated', async () => {
    const many = Array.from({ length: 40 }, (_, i) => card(`f${i}`));
    const { service, store, channel } = harness(many);
    channel.answers.push(null, new ChannelRefusal('telegram refused (429): Too Many Requests'));
    const outcome = await service.run(AFTER_POST_HOUR);
    expect(outcome).toMatchObject({ kind: 'failed', delivered: 1 });
    expect(store.rows.get('2026-09-27')).toMatchObject({ state: 'failed', delivered: 1 });
    expect(await service.run(new Date('2026-09-27T08:41:00Z'))).toMatchObject({ kind: 'already' });
    expect(channel.posted).toHaveLength(1);
  });
});

// 2026-09-28 is a Monday: the results post recaps Sunday 27, the weekly post
// the week of Monday 21.
const MONDAY_POST_HOUR = new Date('2026-09-28T06:41:00Z');

describe('ChannelPostService.tick (T-1430)', () => {
  it("posts yesterday's results, then the week, then today's forecasts, each once", async () => {
    const { service, store, channel } = harness([], DEFAULT_POST_HOUR, {
      lists: {
        '2026-09-27': [
          finished('r1', '2026-09-27T14:00:00.000Z'),
          finished('r2', '2026-09-27T16:00:00.000Z'),
        ],
        '2026-09-28': [card('f1', '2026-09-28T19:00:00.000Z')],
      },
      counted: new Map([
        ['r1', scored('r1', true)],
        ['r2', scored('r2', false)],
      ]),
      accuracy: accuracyFor('2026-09-21', 12),
    });
    const outcome = await service.tick(MONDAY_POST_HOUR);
    expect(outcome).toEqual({
      results: { kind: 'sent', day: '2026-09-27', messages: 1 },
      weekly: { kind: 'sent', day: '2026-09-21', messages: 1 },
      forecast: { kind: 'sent', day: '2026-09-28', messages: 1 },
    });
    expect(channel.posted).toHaveLength(3);
    expect(channel.posted[0]).toContain(
      "The statistical model's results · Sunday 27 September 2026",
    );
    expect(channel.posted[0]).toContain(
      "The model's most likely outcome happened in 1 of 2 matches.",
    );
    expect(channel.posted[1]).toContain(
      "The statistical model's accuracy · Week of Monday 21 September 2026",
    );
    expect(channel.posted[1]).toContain('https://fmip.example/en/model-accuracy?period=week');
    expect(channel.posted[2]).toContain("The statistical model's forecast");
    expect(store.rows.get('results:2026-09-27')).toMatchObject({ state: 'sent', delivered: 1 });
    expect(store.rows.get('weekly_accuracy:2026-09-21')).toMatchObject({ state: 'sent' });
    expect(store.rows.get('2026-09-28')).toMatchObject({ state: 'sent' });

    const again = await service.tick(new Date('2026-09-28T07:41:00Z'));
    expect(again.results).toMatchObject({ kind: 'already', state: 'sent' });
    expect(again.weekly).toMatchObject({ kind: 'already', state: 'sent' });
    expect(again.forecast).toMatchObject({ kind: 'already', state: 'sent' });
    expect(channel.posted).toHaveLength(3);
  });

  it('posts the week on Mondays only, from the post hour', async () => {
    const { service } = harness([]);
    expect(await service.runWeekly(AFTER_POST_HOUR)).toEqual({
      kind: 'not_due',
      day: '2026-09-14',
    });
    expect(await service.runWeekly(new Date('2026-09-28T05:41:00Z'))).toEqual({
      kind: 'too_early',
      day: '2026-09-21',
    });
  });

  it('posts nothing for a week with no scored match, and records nothing', async () => {
    const { service, store, channel } = harness([], DEFAULT_POST_HOUR, {
      accuracy: accuracyFor('2026-09-21', 0),
    });
    expect(await service.runWeekly(MONDAY_POST_HOUR)).toEqual({
      kind: 'nothing',
      day: '2026-09-21',
    });
    expect(channel.posted).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it('posts no results on a day with no finished match, or none the model forecast', async () => {
    const unforecast = harness([], DEFAULT_POST_HOUR, {
      lists: { '2026-09-27': [finished('r1', '2026-09-27T14:00:00.000Z')] },
    });
    expect(await unforecast.service.runResults(MONDAY_POST_HOUR)).toEqual({
      kind: 'nothing',
      day: '2026-09-27',
    });
    const empty = harness([]);
    expect(await empty.service.runResults(MONDAY_POST_HOUR)).toEqual({
      kind: 'nothing',
      day: '2026-09-27',
    });
    expect(unforecast.channel.posted).toHaveLength(0);
    expect(unforecast.store.rows.size).toBe(0);
  });

  it('waits for a forecast to be scored, then posts it as not scored yet; the week waits too', async () => {
    const pending: CountedEvaluation = { hasForecast: true, evaluation: null };
    const { service, channel } = harness([], DEFAULT_POST_HOUR, {
      lists: {
        '2026-09-27': [
          finished('r1', '2026-09-27T14:00:00.000Z'),
          finished('r2', '2026-09-27T23:30:00.000Z'),
        ],
      },
      counted: new Map([
        ['r1', scored('r1', true)],
        ['r2', pending],
      ]),
      accuracy: accuracyFor('2026-09-21', 12),
    });
    const early = await service.tick(MONDAY_POST_HOUR);
    expect(early.results).toEqual({ kind: 'waiting', day: '2026-09-27', pending: 1 });
    expect(early.weekly).toEqual({ kind: 'waiting', day: '2026-09-21', pending: 1 });
    expect(channel.posted).toHaveLength(0);

    const late = await service.tick(new Date('2026-09-28T12:41:00Z'));
    expect(late.results).toMatchObject({ kind: 'sent' });
    expect(late.weekly).toMatchObject({ kind: 'sent' });
    expect(channel.posted[0]).toContain('1 more is not scored yet and not counted.');
    expect(channel.posted[0]).toContain("The model's forecast is not scored yet");
  });

  it('keeps the others going when one read throws, then fails the job', async () => {
    const { service, channel } = harness([], DEFAULT_POST_HOUR, {
      lists: { '2026-09-28': [card('f1', '2026-09-28T19:00:00.000Z')] },
    });
    // No accuracy answer: the weekly read throws.
    await expect(service.tick(MONDAY_POST_HOUR)).rejects.toThrow(/accuracy/);
    expect(channel.posted).toHaveLength(1);
    expect(channel.posted[0]).toContain("The statistical model's forecast");
  });

  it('reports the newest post of each kind on the health answer', async () => {
    const { service } = harness([card('f1')], DEFAULT_POST_HOUR, {
      lists: { '2026-09-26': [finished('r1')] },
      counted: new Map([['r1', scored('r1', true)]]),
    });
    await service.tick(AFTER_POST_HOUR);
    const health = await service.health(AFTER_POST_HOUR);
    expect(health.last).toMatchObject({ day: '2026-09-27', state: 'sent' });
    expect(health.results_last).toMatchObject({ day: '2026-09-26', state: 'sent' });
    expect(health.weekly_accuracy_last).toBeNull();
  });
});
