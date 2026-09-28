import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  AdapterResult,
  NormalisedAbsence,
  NormalisedLineup,
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
 * Team news and line-up alerts through the line-ups job (T-832, D-100),
 * against the real schema: the real job, writers, derivation, notifications
 * and carrier, with a scripted provider and a capturing push channel.
 *
 * One match twenty minutes from kick-off. The provider first reports who
 * will miss it, then one side's line-up, then both, then the same again.
 * Both kinds are opt-in: only the member who switched them on hears them,
 * once each, and a team mute silences them like any match alert.
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
const RICE = randomUUID();
const PALMER = randomUUID();
const FIXTURE = randomUUID();
const X = (name: string): string => `t832-${RUN}-${name}`;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'team news alerts',
  { timeout: 30_000 },
  () => {
    let pool: Pool;
    let jobs: IngestionJobsService;
    let notifications: NotificationsService;
    let close: () => Promise<void>;
    const pushes: OutboundPush[] = [];
    const members = new Map<string, string>();
    const startedAt = new Date();

    let lineup: NormalisedLineup | null = null;
    let absences: NormalisedAbsence[] | null = null;
    const kickoff = new Date(Date.now() + 20 * 60_000).toISOString();

    const player = (id: string, name: string) => ({
      externalId: X(id),
      name,
      role: 'starter' as const,
      shirtNumber: null,
      position: null,
      isCaptain: false,
    });
    const side = (players: ReturnType<typeof player>[]) => ({
      formation: null,
      coach: null,
      players,
    });
    const absence = (
      id: string,
      name: string,
      team: 'home' | 'away',
      status: 'out' | 'doubtful',
    ): NormalisedAbsence => ({
      fixtureExternalId: X('fixture'),
      team: { externalId: X(team), name: team === 'home' ? 'News Home' : 'News Away' },
      player: { externalId: X(id), name },
      status,
      kind: status === 'out' ? 'injury' : null,
      reason: status === 'out' ? 'Knee Injury' : null,
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
      getLive: () => Promise.resolve(unsupported()),
      // Only about this match: another suite's fixtures are polled by the same
      // job, and are answered with nobody -- not a refusal, which would make
      // this run `partial` and the newest failure a parallel suite reads.
      // Before the line-ups are out, this match's answer is nobody too.
      getLineup: (id: string) =>
        Promise.resolve(
          ok(
            (id === X('fixture') ? lineup : null) ?? {
              fixtureExternalId: id,
              home: side([]),
              away: side([]),
            },
          ),
        ),
      getStandings: () => Promise.resolve(unsupported()),
      getFixtureDetail: () => Promise.resolve(unsupported()),
      getAvailability: (id: string) =>
        Promise.resolve(absences === null || id !== X('fixture') ? unsupported() : ok(absences)),
    } as unknown as ProviderAdapter;
    const sources: IngestionSources = {
      kind: 'live',
      reason: null,
      forJob: () => ({ provider: PROVIDER, adapter }),
    };

    async function member(label: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, $2, $3, $4, 'en', 'Europe/London', now(), now())
         RETURNING id`,
        [`tn${label}${RUN}`, `News ${label}`, `tn${label}${RUN}@example.test`, ENGLAND],
      );
      const id = rows[0]!.id;
      members.set(label, id);
      await pool.query(
        `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
        [id, HOME],
      );
      return id;
    }
    const map = (entityType: string, externalId: string, internalId: string) =>
      pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ($1, $2, $3, $4)`,
        [PROVIDER, entityType, externalId, internalId],
      );
    async function heard(label: string): Promise<string[]> {
      const rows = await notifications.inbox(members.get(label)!, 100);
      return rows
        .filter((row) => row.subject_id === FIXTURE)
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
        [COMPETITION, ENGLAND, `News League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2026/27', DATE '2026-08-01', DATE '2027-05-31', true)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, 'News Home', 'club', 'men'),
                                                         ($2, 'News Away', 'club', 'men')`,
        [HOME, AWAY],
      );
      await pool.query(
        `INSERT INTO person (id, full_name, known_as) VALUES
           ($1, 'Bukayo Saka', 'Saka'), ($2, 'Reece James', 'James'),
           ($3, 'Declan Rice', 'Rice'), ($4, 'Cole Palmer', 'Palmer')`,
        [SAKA, JAMES, RICE, PALMER],
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
      await map('person', X('rice'), RICE);
      await map('person', X('palmer'), PALMER);
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

      const on = await member('on');
      await notifications.setPreference(on, 'match_availability', true);
      await notifications.setPreference(on, 'match_lineups', true);
      await member('default');
      const muted = await member('muted');
      await notifications.setPreference(muted, 'match_availability', true);
      await notifications.setPreference(muted, 'match_lineups', true);
      await notifications.mute(muted, 'team', HOME);
    });

    afterAll(async () => {
      await close?.();
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`tn%${RUN}`]);
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
      await pool.query(`DELETE FROM provider_mapping WHERE provider = $1 AND external_id LIKE $2`, [
        PROVIDER,
        `t832-${RUN}-%`,
      ]);
      await pool.query(
        `DELETE FROM unresolved_entity WHERE provider = $1 AND external_id LIKE $2`,
        [PROVIDER, `t832-${RUN}-%`],
      );
      await pool.query(`DELETE FROM ingest_run WHERE provider = $1 AND started_at >= $2`, [
        PROVIDER,
        startedAt,
      ]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [
        [SAKA, JAMES, RICE, PALMER],
      ]);
      await pool.query(`DELETE FROM team WHERE id IN ($1, $2)`, [HOME, AWAY]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.end();
    });

    it('a player ruled out: told to the member who asked, doubtful players are not news', async () => {
      absences = [
        absence('saka', 'Saka', 'home', 'out'),
        absence('james', 'James', 'away', 'doubtful'),
      ];
      await jobs.lineups();
      const news =
        'match_availability: Team news: Saka (News Home) will miss News Home v News Away, injured.';
      expect(await heard('on')).toEqual([news]);
      expect(await heard('default')).toEqual([]);
      expect(await heard('muted')).toEqual([]);
      expect(pushesTo('on')).toEqual([
        {
          userId: members.get('on'),
          title: 'FMIP',
          body: 'Team news: Saka (News Home) will miss News Home v News Away, injured.',
          url: `/en/match/${FIXTURE}#lineups`,
        },
      ]);
    });

    it('one side announced is not the line-ups', async () => {
      lineup = {
        fixtureExternalId: X('fixture'),
        home: side([player('rice', 'Rice')]),
        away: side([]),
      };
      await jobs.lineups();
      expect(await heard('on')).toHaveLength(1);
    });

    it('both sides announced: the line-ups, once, opening the line-ups', async () => {
      lineup = {
        fixtureExternalId: X('fixture'),
        home: side([player('rice', 'Rice')]),
        away: side([player('palmer', 'Palmer')]),
      };
      await jobs.lineups();
      expect((await heard('on')).at(-1)).toBe(
        'match_lineups: Line-ups are in: News Home v News Away.',
      );
      expect(pushesTo('on').at(-1)?.url).toBe(`/en/match/${FIXTURE}#lineups`);
      expect(await heard('default')).toEqual([]);
      expect(await heard('muted')).toEqual([]);
    });

    it('the same answers again reach nobody twice', async () => {
      const count = pushes.length;
      await pool.query(`DELETE FROM fixture_availability_fetch WHERE fixture_id = $1`, [FIXTURE]);
      await jobs.lineups();
      expect(await heard('on')).toHaveLength(2);
      expect(pushes.length).toBe(count);
      const { rows } = await pool.query<{ event_key: string }>(
        `SELECT event_key FROM match_alert WHERE fixture_id = $1 ORDER BY event_key`,
        [FIXTURE],
      );
      expect(rows.map((r) => r.event_key)).toEqual([
        `${FIXTURE}:lineups`,
        `${FIXTURE}:out:${SAKA}`,
      ]);
    });
  },
);
