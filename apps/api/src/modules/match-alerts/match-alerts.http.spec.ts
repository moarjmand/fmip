import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  AdapterResult,
  NormalisedFixtureDetail,
  NormalisedIncident,
  NormalisedLiveFixture,
  ProviderAdapter,
} from '@fmip/ingestion';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { OUTBOUND_DELIVERY, type OutboundPush } from '../delivery/delivery.port';
import { IngestionJobsService } from '../ingestion/ingestion-jobs.service';
import { IngestionModule } from '../ingestion/ingestion.module';
import { INGESTION_SOURCES, type IngestionSources } from '../ingestion/internal/sources';
import { NotificationsService, WEB_ORIGIN } from '../notifications/notifications.service';
import { MatchAlertsStore } from './internal/match-alerts-store';
import { MATCH_ALERTS_QUEUE, MatchAlertsService } from './match-alerts.service';

/**
 * Match alerts through the live job (T-830, D-098), against the real schema:
 * the real jobs, writers, alert derivation, notifications and carrier, with a
 * scripted provider in place of the network and a capturing push channel.
 *
 * One match, followed by nine members in nine ways, is played tick by tick:
 * kick-off, a goal and a red card in the same minute, the same answer again
 * (a retry), the goal taken off the board, the half-time interval, and the
 * match leaving the live list at the whistle. What each member hears is what
 * their follows, switches, mutes and quiet hours allow -- once per event, one
 * push per tick, and a correction only to those told of the goal. T-945
 * (D-116) adds a member following the match itself, and one following it
 * four ways at once (the match, both teams and the competition), who still
 * hears each event once; the match follow ends three hours after full-time.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PROVIDER = 'highlightly' as const;

const COMPETITION = randomUUID();
const SEASON = randomUUID();
const HOME = randomUUID();
const AWAY = randomUUID();
const SAKA = randomUUID();
const JAMES = randomUUID();
const FIXTURE = randomUUID();
const X = (name: string): string => `t830-${RUN}-${name}`;

// Each tick is a real job run over the real schema; the first pays for the module's warm-up.
describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'match alerts',
  { timeout: 30_000 },
  () => {
    let pool: Pool;
    let jobs: IngestionJobsService;
    let notifications: NotificationsService;
    let store: MatchAlertsStore;
    let close: () => Promise<void>;
    const pushes: OutboundPush[] = [];
    const members = new Map<string, string>();
    const startedAt = new Date();

    /** What the scripted provider answers next. */
    let live: NormalisedLiveFixture[] = [];
    let detail: NormalisedFixtureDetail | null = null;

    const kickoff = new Date(Date.now() - 5 * 60_000).toISOString();
    function fixture(
      status: 'live' | 'finished',
      score: [number, number],
      incidents: NormalisedIncident[] | undefined,
      halfTimeBreak?: boolean,
    ): NormalisedLiveFixture {
      return {
        externalId: X('fixture'),
        competition: { externalId: X('competition'), name: 'Alert League' },
        season: { label: '2026/27', startYear: 2026 },
        stage: null,
        round: null,
        kickoffAt: kickoff,
        status,
        minute: status === 'live' ? 30 : null,
        home: { externalId: X('home'), name: 'Alert Home' },
        away: { externalId: X('away'), name: 'Alert Away' },
        venue: null,
        referee: null,
        scores: {
          current: { home: score[0], away: score[1] },
          halfTime: null,
          fullTime: status === 'finished' ? { home: score[0], away: score[1] } : null,
          extraTime: null,
          penalties: null,
          aggregate: null,
        },
        lastUpdatedAt: new Date().toISOString(),
        ...(incidents === undefined ? {} : { incidents }),
        ...(halfTimeBreak === undefined ? {} : { halfTimeBreak }),
      };
    }
    const goal: NormalisedIncident = {
      fixtureExternalId: X('fixture'),
      sequence: 1,
      minute: 21,
      addedTime: null,
      kind: 'goal',
      side: 'home',
      player: { externalId: X('saka'), name: 'Saka' },
      relatedPlayer: null,
      detail: null,
    };
    const sendingOff: NormalisedIncident = {
      fixtureExternalId: X('fixture'),
      sequence: 2,
      minute: 21,
      addedTime: null,
      kind: 'red_card',
      side: 'away',
      player: { externalId: X('james'), name: 'James' },
      relatedPlayer: null,
      detail: null,
    };

    const ok = <T>(data: T): AdapterResult<T> => ({
      ok: true,
      data,
      requests: 1,
      fetchedAt: new Date().toISOString(),
    });
    const unsupported = <T>(): AdapterResult<T> => ({
      ok: false,
      error: { kind: 'unsupported', message: 'not scripted' },
      requests: 0,
    });
    const adapter = {
      manifest: {} as ProviderAdapter['manifest'],
      listFixtures: () => Promise.resolve(unsupported()),
      getLive: () => Promise.resolve(ok(live)),
      getLineup: () => Promise.resolve(unsupported()),
      getStandings: () => Promise.resolve(unsupported()),
      getFixtureDetail: (id: string) =>
        Promise.resolve(id === X('fixture') && detail !== null ? ok(detail) : unsupported()),
      getAvailability: () => Promise.resolve(unsupported()),
    } as unknown as ProviderAdapter;
    const sources: IngestionSources = {
      kind: 'live',
      reason: null,
      forJob: () => ({ provider: PROVIDER, adapter }),
    };

    async function member(label: string, timezone = 'Europe/London'): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, $2, $3, $4, 'en', $5, now(), now())
       RETURNING id`,
        [
          `ma${label}${RUN}`,
          `Alerted ${label}`,
          `ma${label}${RUN}@example.test`,
          ENGLAND,
          timezone,
        ],
      );
      const id = rows[0]!.id;
      members.set(label, id);
      return id;
    }
    const follow = (userId: string, type: 'team' | 'competition' | 'fixture', entity: string) =>
      pool.query(
        `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, $2, $3)`,
        [userId, type, entity],
      );
    const map = (entityType: string, externalId: string, internalId: string) =>
      pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ($1, $2, $3, $4)`,
        [PROVIDER, entityType, externalId, internalId],
      );

    /** What one member's inbox holds about the match, oldest first. */
    async function heard(label: string): Promise<string[]> {
      const rows = await notifications.inbox(members.get(label)!, 100);
      return rows
        .filter((row) => row.subject_type === 'fixture' && row.subject_id === FIXTURE)
        .reverse()
        .map((row) => `${row.kind}: ${row.headline ?? ''}`);
    }
    const pushesTo = (label: string): OutboundPush[] =>
      pushes.filter((push) => push.userId === members.get(label));

    beforeAll(async () => {
      delete process.env.INGESTION_SCHEDULE;
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender, age_group, tier)
       VALUES ($1, $2, $3, 'league', 'domestic', 'men', 'senior', 9)`,
        [COMPETITION, ENGLAND, `Alert League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2026/27', DATE '2026-08-01', DATE '2027-05-31', true)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, 'Alert Home', 'club', 'men'),
                                                       ($2, 'Alert Away', 'club', 'men')`,
        [HOME, AWAY],
      );
      await pool.query(
        `INSERT INTO person (id, full_name, known_as) VALUES ($1, 'Bukayo Saka', 'Saka'),
                                                          ($2, 'Reece James', 'James')`,
        [SAKA, JAMES],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
        [FIXTURE, SEASON, kickoff],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [FIXTURE, HOME, AWAY],
      );
      await map('competition', X('competition'), COMPETITION);
      await map('team', X('home'), HOME);
      await map('team', X('away'), AWAY);
      await map('person', X('saka'), SAKA);
      await map('person', X('james'), JAMES);
      await map('fixture', X('fixture'), FIXTURE);

      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, IngestionModule],
      })
        .overrideProvider(INGESTION_SOURCES)
        .useValue(sources)
        .overrideProvider(OUTBOUND_DELIVERY)
        .useValue({
          email: null,
          push: {
            provider: 'capture',
            send: (push: OutboundPush) => {
              pushes.push(push);
              return Promise.resolve();
            },
          },
        })
        .overrideProvider(WEB_ORIGIN)
        .useValue('http://web.test')
        .compile();
      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      close = () => app.close();
      jobs = app.get(IngestionJobsService);
      notifications = app.get(NotificationsService);
      store = app.get(MatchAlertsStore, { strict: false });

      // Seven members, seven ways of following the match.
      await follow(await member('home'), 'team', HOME); // the defaults
      const comp = await member('comp');
      await follow(comp, 'competition', COMPETITION);
      await notifications.setPreference(comp, 'match_red_card', true);
      await notifications.setPreference(comp, 'match_half_time', true);
      const muted = await member('muted');
      await follow(muted, 'team', AWAY);
      await notifications.mute(muted, 'team', AWAY);
      const category = await member('cat');
      await follow(category, 'team', HOME);
      await notifications.mute(category, 'category', 'match');
      await member('none');
      const asleep = await member('asleep', 'Etc/UTC');
      await follow(asleep, 'team', HOME);
      const hour = new Date().getUTCHours();
      const hh = (h: number): string => `${String((h + 24) % 24).padStart(2, '0')}:00`;
      await notifications.setQuietHours(asleep, hh(hour - 1), hh(hour + 2));
      const noGoals = await member('nogoals');
      await follow(noGoals, 'team', HOME);
      await notifications.setPreference(noGoals, 'match_goal', false);
      // T-945: the match itself, and the match four ways at once.
      await follow(await member('match'), 'fixture', FIXTURE);
      const every = await member('every');
      await follow(every, 'fixture', FIXTURE);
      await follow(every, 'team', HOME);
      await follow(every, 'team', AWAY);
      await follow(every, 'competition', COMPETITION);
    });

    afterAll(async () => {
      await close?.();
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`ma%${RUN}`]);
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
      await pool.query(`DELETE FROM provider_mapping WHERE provider = $1 AND external_id LIKE $2`, [
        PROVIDER,
        `t830-${RUN}-%`,
      ]);
      await pool.query(
        `DELETE FROM unresolved_entity WHERE provider = $1 AND external_id LIKE $2`,
        [PROVIDER, `t830-${RUN}-%`],
      );
      await pool.query(`DELETE FROM ingest_run WHERE provider = $1 AND started_at >= $2`, [
        PROVIDER,
        startedAt,
      ]);
      await pool.query(`DELETE FROM person WHERE id IN ($1, $2)`, [SAKA, JAMES]);
      await pool.query(`DELETE FROM team WHERE id IN ($1, $2)`, [HOME, AWAY]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.end();
    });

    it('kick-off: told to the followers the switches allow, one push each', async () => {
      live = [fixture('live', [0, 0], [])];
      await jobs.live();
      const line = 'match_kickoff: Kick-off: Alert Home v Alert Away.';
      expect(await heard('home')).toEqual([line]);
      expect(await heard('comp')).toEqual([line]);
      expect(await heard('nogoals')).toEqual([line]);
      expect(await heard('match')).toEqual([line]);
      expect(await heard('every')).toEqual([line]);
      expect(pushesTo('every')).toHaveLength(1);
      for (const label of ['muted', 'cat', 'none']) expect(await heard(label)).toEqual([]);
      // Held by quiet hours, so written and not yet in the inbox or on a device.
      expect(await heard('asleep')).toEqual([]);
      expect(pushesTo('asleep')).toEqual([]);
      expect(pushesTo('home')).toEqual([
        {
          userId: members.get('home'),
          title: 'FMIP',
          body: 'Kick-off: Alert Home v Alert Away.',
          url: `/en/match/${FIXTURE}`,
        },
      ]);
    });

    it('a goal and a red card in one minute: the scorer named, one push for both', async () => {
      live = [fixture('live', [1, 0], [goal, sendingOff])];
      const before = pushesTo('comp').length;
      await jobs.live();
      const scored = "match_goal: Goal for Alert Home (Saka 21'): Alert Home 1–0 Alert Away.";
      const red = "match_red_card: Red card: James (Alert Away) 21'. Alert Home 1–0 Alert Away.";
      expect((await heard('home')).slice(1)).toEqual([scored]);
      expect((await heard('comp')).slice(1)).toEqual([scored, red]);
      expect((await heard('nogoals')).slice(1)).toEqual([]);
      expect((await heard('match')).slice(1)).toEqual([scored]);
      // Following the match, both teams and the competition: told once.
      expect((await heard('every')).slice(1)).toEqual([scored]);
      expect(pushesTo('every')).toHaveLength(2);
      const burst = pushesTo('comp').slice(before);
      expect(burst).toHaveLength(1);
      expect(burst[0]?.body).toBe(
        "Goal for Alert Home (Saka 21'): Alert Home 1–0 Alert Away.\nRed card: James (Alert Away) 21'. Alert Home 1–0 Alert Away.",
      );
    });

    it('the same answer again reaches nobody twice', async () => {
      const count = pushes.length;
      const rows = await pool.query(
        `SELECT count(*)::int AS n FROM notification WHERE subject_id = $1`,
        [FIXTURE],
      );
      await jobs.live();
      const again = await pool.query(
        `SELECT count(*)::int AS n FROM notification WHERE subject_id = $1`,
        [FIXTURE],
      );
      expect(again.rows[0]).toEqual(rows.rows[0]);
      expect(pushes.length).toBe(count);
    });

    it('a disallowed goal is a correction, only to those told of the goal', async () => {
      live = [fixture('live', [0, 0], [{ ...sendingOff, sequence: 1 }])];
      await jobs.live();
      const correction = 'match_goal: Goal disallowed for Alert Home: Alert Home 0–0 Alert Away.';
      expect((await heard('home')).at(-1)).toBe(correction);
      expect((await heard('comp')).at(-1)).toBe(correction);
      // Never told of the goal, so nothing to correct.
      expect(await heard('nogoals')).toEqual(['match_kickoff: Kick-off: Alert Home v Alert Away.']);
      const { rows } = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM notification WHERE dedupe_key LIKE '%:goal-void:%' AND subject_id = $1`,
        [FIXTURE],
      );
      // The member asleep was told of the goal too (held, not dropped), so the
      // correction waits beside it.
      expect(rows.map((r) => r.user_id).sort()).toEqual(
        ['home', 'comp', 'asleep', 'match', 'every'].map((label) => members.get(label)).sort(),
      );
    });

    it('half-time is sent where the feed says so and the member asked for it', async () => {
      live = [fixture('live', [0, 0], [{ ...sendingOff, sequence: 1 }], true)];
      await jobs.live();
      expect((await heard('comp')).at(-1)).toBe(
        'match_half_time: Half-time: Alert Home 0–0 Alert Away.',
      );
      expect((await heard('home')).some((line) => line.startsWith('match_half_time'))).toBe(false);
    });

    it('full-time when the match leaves the live list, asked for by id', async () => {
      live = [];
      detail = {
        fixture: fixture('finished', [0, 0], undefined),
        incidents: [{ ...sendingOff, sequence: 1 }],
        lineup: null,
        statistics: [],
        playerStatistics: null,
        periods: [],
      };
      await jobs.live();
      const full = 'match_full_time: Full-time: Alert Home 0–0 Alert Away.';
      expect((await heard('home')).at(-1)).toBe(full);
      expect((await heard('comp')).at(-1)).toBe(full);
      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM fixture WHERE id = $1`,
        [FIXTURE],
      );
      expect(rows[0]?.status).toBe('finished');
      // And the member asleep: every alert still waiting, nothing thrown away.
      const held = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification
        WHERE user_id = $1 AND subject_id = $2 AND deliver_after > now()`,
        [members.get('asleep'), FIXTURE],
      );
      expect(held.rows[0]?.n).toBe(4);
      expect((await heard('match')).at(-1)).toBe(full);
      expect((await heard('every')).filter((l) => l === full)).toHaveLength(1);
    });

    it('a match follow ends three hours after full-time, and a team follow does not', async () => {
      const match = members.get('match')!;
      const every = members.get('every')!;
      expect(await store.followers(FIXTURE)).toEqual(expect.arrayContaining([match, every]));
      // Full-time (no periods recorded: two hours after kick-off) two hours ago: still open.
      await pool.query(`UPDATE fixture SET kickoff_at = now() - interval '4 hours' WHERE id = $1`, [
        FIXTURE,
      ]);
      expect(await store.followers(FIXTURE)).toContain(match);
      // The last period ended three hours and a minute ago: closed.
      await pool.query(
        `INSERT INTO fixture_period (fixture_id, kind, sequence, started_at, ended_at)
         VALUES ($1, 'second_half', 2, now() - interval '4 hours', now() - interval '181 minutes')`,
        [FIXTURE],
      );
      const after = await store.followers(FIXTURE);
      expect(after).not.toContain(match);
      // Still a follower through the teams and the competition, and once.
      expect(after.filter((id) => id === every)).toEqual([every]);
    });
  },
);

/**
 * Match alerts through the queue (T-835), against the real schema and a
 * real Redis: the live job → `match_alert` → a BullMQ job → a worker's
 * set-based insert → the carrier.
 *
 * Two API instances share the database and the queue, as two processes
 * would: A runs the live job, and both run a worker. The live job must only
 * record and hand over; the workers must write each follower's notification
 * once and send each once, however they race, and a worker that stopped
 * part-way must be made good without anybody hearing twice.
 */
describe.skipIf(!DATABASE_URL || !REDIS_URL)(
  'match alerts through the queue',
  { timeout: 60_000 },
  () => {
    const COMPETITION = randomUUID();
    const SEASON = randomUUID();
    const HOME = randomUUID();
    const AWAY = randomUUID();
    const FIXTURE = randomUUID();
    const X = (name: string): string => `t835-${RUN}-${name}`;
    let pool: Pool;
    let queue: Queue;
    const members = new Map<string, string>();
    const startedAt = new Date();
    const kickoff = new Date(Date.now() - 5 * 60_000).toISOString();
    let score: [number, number] = [0, 0];

    const liveFixture = (): NormalisedLiveFixture => ({
      externalId: X('fixture'),
      competition: { externalId: X('competition'), name: 'Queue League' },
      season: { label: '2026/27', startYear: 2026 },
      stage: null,
      round: null,
      kickoffAt: kickoff,
      status: 'live',
      minute: 30,
      home: { externalId: X('home'), name: 'Queue Home' },
      away: { externalId: X('away'), name: 'Queue Away' },
      venue: null,
      referee: null,
      scores: {
        current: { home: score[0], away: score[1] },
        halfTime: null,
        fullTime: null,
        extraTime: null,
        penalties: null,
        aggregate: null,
      },
      lastUpdatedAt: new Date().toISOString(),
    });
    const ok = <T>(data: T): AdapterResult<T> => ({
      ok: true,
      data,
      requests: 1,
      fetchedAt: new Date().toISOString(),
    });
    const unsupported = <T>(): AdapterResult<T> => ({
      ok: false,
      error: { kind: 'unsupported', message: 'not scripted' },
      requests: 0,
    });
    const adapter = {
      manifest: {} as ProviderAdapter['manifest'],
      listFixtures: () => Promise.resolve(unsupported()),
      getLive: () => Promise.resolve(ok([liveFixture()])),
      getLineup: () => Promise.resolve(unsupported()),
      getStandings: () => Promise.resolve(unsupported()),
      getFixtureDetail: () => Promise.resolve(unsupported()),
      getAvailability: () => Promise.resolve(unsupported()),
    } as unknown as ProviderAdapter;
    const sources: IngestionSources = {
      kind: 'live',
      reason: null,
      forJob: () => ({ provider: PROVIDER, adapter }),
    };

    interface Instance {
      jobs: IngestionJobsService;
      alerts: MatchAlertsService;
      notifications: NotificationsService;
      pushes: OutboundPush[];
      close: () => Promise<void>;
    }
    let a: Instance;
    let b: Instance;
    const sent: OutboundPush[] = [];

    async function boot(): Promise<Instance> {
      const pushes: OutboundPush[] = [];
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, IngestionModule],
      })
        .overrideProvider(INGESTION_SOURCES)
        .useValue(sources)
        .overrideProvider(OUTBOUND_DELIVERY)
        .useValue({
          email: null,
          push: {
            provider: 'capture',
            send: (push: OutboundPush) => {
              pushes.push(push);
              sent.push(push);
              return Promise.resolve();
            },
          },
        })
        .overrideProvider(WEB_ORIGIN)
        .useValue('http://web.test')
        .compile();
      await moduleRef.init();
      return {
        jobs: moduleRef.get(IngestionJobsService),
        alerts: moduleRef.get(MatchAlertsService),
        notifications: moduleRef.get(NotificationsService),
        pushes,
        close: () => moduleRef.close(),
      };
    }

    async function member(label: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, $1, $1 || '@example.test', $2, 'en', 'Europe/London', now(), now())
         RETURNING id`,
        [`mq${label}${RUN}`, ENGLAND],
      );
      members.set(label, rows[0]!.id);
      return rows[0]!.id;
    }
    const follow = (userId: string, type: 'team' | 'competition', entity: string) =>
      pool.query(
        `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, $2, $3)`,
        [userId, type, entity],
      );
    const map = (entityType: string, externalId: string, internalId: string) =>
      pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ($1, $2, $3, $4)`,
        [PROVIDER, entityType, externalId, internalId],
      );

    // Both instances' pushes, in the order they were sent.
    const pushes = (): OutboundPush[] => sent;
    const pushesTo = (label: string): OutboundPush[] =>
      pushes().filter((p) => p.userId === members.get(label));
    /** Per dedupe key, who holds it, sorted. */
    const holders = async (keyLike: string): Promise<string[]> => {
      const { rows } = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM notification WHERE subject_id = $1 AND dedupe_key LIKE $2`,
        [FIXTURE, keyLike],
      );
      const label = (id: string) => [...members].find(([, v]) => v === id)?.[0] ?? id;
      return rows.map((r) => label(r.user_id)).sort();
    };
    const pending = async (): Promise<number> => {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM match_alert WHERE fixture_id = $1 AND expanded_at IS NULL`,
        [FIXTURE],
      );
      return rows[0]!.n;
    };
    async function until(what: string, check: () => Promise<boolean>): Promise<void> {
      const deadline = Date.now() + 20_000;
      while (!(await check())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    beforeAll(async () => {
      delete process.env.INGESTION_SCHEDULE;
      pool = new Pool({ connectionString: DATABASE_URL });
      queue = new Queue(MATCH_ALERTS_QUEUE, {
        connection: { url: REDIS_URL, maxRetriesPerRequest: null },
      });
      await queue.obliterate({ force: true });

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender, age_group, tier)
         VALUES ($1, $2, $3, 'league', 'domestic', 'men', 'senior', 9)`,
        [COMPETITION, ENGLAND, `Queue League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2026/27', DATE '2026-08-01', DATE '2027-05-31', true)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender)
         VALUES ($1, 'Queue Home', 'club', 'men'), ($2, 'Queue Away', 'club', 'men')`,
        [HOME, AWAY],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
        [FIXTURE, SEASON, kickoff],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [FIXTURE, HOME, AWAY],
      );
      await map('competition', X('competition'), COMPETITION);
      await map('team', X('home'), HOME);
      await map('team', X('away'), AWAY);
      await map('fixture', X('fixture'), FIXTURE);

      a = await boot();
      b = await boot();
      await follow(await member('home'), 'team', HOME);
      await follow(await member('comp'), 'competition', COMPETITION);
      const muted = await member('muted');
      await follow(muted, 'team', AWAY);
      await a.notifications.mute(muted, 'team', AWAY);
      await member('none');

      // A fills the queue; nobody works it yet.
      await a.alerts.start(REDIS_URL!, { worker: false });
    });

    afterAll(async () => {
      await a?.close();
      await b?.close();
      await queue?.obliterate({ force: true });
      await queue?.close();
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`mq%${RUN}`]);
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
      await pool.query(`DELETE FROM provider_mapping WHERE provider = $1 AND external_id LIKE $2`, [
        PROVIDER,
        `t835-${RUN}-%`,
      ]);
      await pool.query(`DELETE FROM ingest_run WHERE provider = $1 AND started_at >= $2`, [
        PROVIDER,
        startedAt,
      ]);
      await pool.query(`DELETE FROM team WHERE id IN ($1, $2)`, [HOME, AWAY]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.end();
    });

    it('the live job records the kick-off and hands it to the queue; nobody is told in the tick', async () => {
      await a.jobs.live();
      const { rows } = await pool.query<{ event_key: string; expanded_at: Date | null }>(
        `SELECT event_key, expanded_at FROM match_alert WHERE fixture_id = $1`,
        [FIXTURE],
      );
      expect(rows).toEqual([{ event_key: `${FIXTURE}:kickoff`, expanded_at: null }]);
      expect(await holders('%')).toEqual([]);
      expect(pushes()).toEqual([]);
      const waiting = await queue.getWaiting();
      expect(waiting.some((job) => job.data.events?.includes(`${FIXTURE}:kickoff`))).toBe(true);
    });

    it('two workers take it: one notification and one push per follower the switches allow', async () => {
      a.alerts.startWorker(REDIS_URL!);
      b.alerts.startWorker(REDIS_URL!);
      await until('the kick-off to be carried', async () => (await pending()) === 0);
      await until('two pushes', () => Promise.resolve(pushes().length >= 2));
      expect(await holders(`${FIXTURE}:kickoff`)).toEqual(['comp', 'home']);
      expect(pushesTo('home')).toHaveLength(1);
      expect(pushesTo('comp')).toHaveLength(1);
      expect(pushes()).toHaveLength(2);
      expect(pushesTo('home')[0]?.body).toBe('Kick-off: Queue Home v Queue Away.');
    });

    it('a goal through the queue, with the workers running: once each', async () => {
      score = [1, 0];
      const before = pushes().length;
      await a.jobs.live();
      await until('the goal to be carried', async () => (await pending()) === 0);
      await until('two more pushes', () => Promise.resolve(pushes().length >= before + 2));
      expect(await holders(`${FIXTURE}:goal:%`)).toEqual(['comp', 'home']);
      expect(
        pushes()
          .slice(before)
          .map((p) => p.body),
      ).toEqual([
        'Goal for Queue Home: Queue Home 1–0 Queue Away.',
        'Goal for Queue Home: Queue Home 1–0 Queue Away.',
      ]);
    });

    it('a worker that stopped part-way, then three expansions racing: written once, sent once', async () => {
      const key = `${FIXTURE}:full-time`;
      await pool.query(
        `INSERT INTO match_alert (event_key, fixture_id, kind, line)
         VALUES ($1, $2, 'match_full_time', 'Full-time: Queue Home 1–0 Queue Away.')`,
        [key, FIXTURE],
      );
      // The stopped worker: it wrote one member's notification, carried
      // nothing, and its lease ran out.
      await a.notifications.emitToAudience(
        { kind: 'match_full_time', subjectType: 'fixture', subjectId: FIXTURE, dedupeKey: key },
        [members.get('home')!],
      );
      await pool.query(
        `UPDATE match_alert SET claimed_at = now() - interval '3 minutes' WHERE event_key = $1`,
        [key],
      );
      const before = pushes().length;
      const runs = await Promise.all([
        a.alerts.expandPending([key], true),
        b.alerts.expandPending([key], true),
        a.alerts.expandPending([key], true),
      ]);
      expect(runs.map((r) => r.events).sort()).toEqual([0, 0, 1]);
      expect(await holders(key)).toEqual(['comp', 'home']);
      // The member the stopped worker wrote is carried too, and once.
      const carried = pushes().slice(before);
      expect(carried.map((p) => p.userId).sort()).toEqual(
        [members.get('comp'), members.get('home')].sort(),
      );
      const { rows } = await pool.query<{ n: number; carried: number }>(
        `SELECT count(*)::int AS n, count(d.carried_at)::int AS carried
           FROM notification n JOIN notification_delivery d ON d.notification_id = n.id
          WHERE n.dedupe_key = $1`,
        [key],
      );
      expect(rows[0]).toEqual({ n: 2, carried: 2 });
      expect(await pending()).toBe(0);
    });

    it('the same events handed over again reach nobody twice', async () => {
      const count = pushes().length;
      await a.alerts.dispatch([`${FIXTURE}:kickoff`, `${FIXTURE}:full-time`]);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await until('the queue to drain', async () => {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
        return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) === 0;
      });
      expect(pushes().length).toBe(count);
      expect(await holders(`${FIXTURE}:kickoff`)).toEqual(['comp', 'home']);
    });
  },
);
