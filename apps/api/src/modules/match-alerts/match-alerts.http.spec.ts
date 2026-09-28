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
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { OUTBOUND_DELIVERY, type OutboundPush } from '../delivery/delivery.port';
import { IngestionJobsService } from '../ingestion/ingestion-jobs.service';
import { IngestionModule } from '../ingestion/ingestion.module';
import { INGESTION_SOURCES, type IngestionSources } from '../ingestion/internal/sources';
import { NotificationsService, WEB_ORIGIN } from '../notifications/notifications.service';

/**
 * Match alerts through the live job (T-830, D-096), against the real schema:
 * the real jobs, writers, alert derivation, notifications and carrier, with a
 * scripted provider in place of the network and a capturing push channel.
 *
 * One match, followed by seven members in seven ways, is played tick by tick:
 * kick-off, a goal and a red card in the same minute, the same answer again
 * (a retry), the goal taken off the board, the half-time interval, and the
 * match leaving the live list at the whistle. What each member hears is what
 * their follows, switches, mutes and quiet hours allow -- once per event, one
 * push per tick, and a correction only to those told of the goal.
 */
const DATABASE_URL = process.env.DATABASE_URL;
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
        [members.get('home'), members.get('comp'), members.get('asleep')].sort(),
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
    });
  },
);
