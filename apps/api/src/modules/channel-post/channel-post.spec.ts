import type { ForecastListEntry, ScoreCard, ScoresFilters, ScoresResponse } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import type { FixturesService } from '../fixtures/fixtures.service';
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
  readonly rows = new Map<string, ChannelPostRecord>();

  async get(day: string): Promise<ChannelPostRecord | null> {
    return this.rows.get(day) ?? null;
  }
  async latest(): Promise<ChannelPostRecord | null> {
    return [...this.rows.values()].sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null;
  }
  async claim(post: DailyPost): Promise<boolean> {
    const existing = this.rows.get(post.day);
    if (existing !== undefined && existing.state !== 'refused') return false;
    this.rows.set(post.day, {
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
  async delivered(day: string): Promise<void> {
    const row = this.rows.get(day);
    if (row !== undefined) row.delivered += 1;
  }
  async finish(day: string, state: ChannelPostRecord['state'], failure?: string): Promise<void> {
    const row = this.rows.get(day);
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

function harness(cards: ScoreCard[], postHour = DEFAULT_POST_HOUR) {
  const store = new MemoryStore();
  const channel = new FakeChannel();
  const asked: ScoresFilters[] = [];
  const fixtures = {
    scores: async (filters: ScoresFilters, viewer: string | null) => {
      asked.push(filters);
      expect(viewer).toBeNull();
      const response = {
        filters,
        generated_at: '',
        total: cards.length,
        pinned: [],
        groups:
          cards.length === 0
            ? []
            : [
                {
                  country: { id: 'e', name: 'England', code: 'ENG' },
                  competition: { id: 'c', name: 'Premier League', short_name: null },
                  fixtures: cards,
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
  const service = new ChannelPostService(
    { publisher: channel, postHour, origin: 'https://fmip.example' },
    store as unknown as PostgresChannelPostStore,
    fixtures,
    forecasts,
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
