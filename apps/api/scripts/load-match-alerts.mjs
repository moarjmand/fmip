// Load measurement for match alerts (T-834, D-098): a Saturday of goals
// across many competitions through the real live-job path -- the ingestion
// job, the writers, the alert derivation, `NotificationsService.emit` and the
// carrier -- against a SCRATCH database, with a scripted provider in place
// of the network and a capturing push channel in place of Web Push.
//
// It creates C competitions with M simultaneous matches each, N members who
// follow teams and competitions, plays a kick-off tick and then G goal ticks
// (each tick a burst of goals in B matches at once), and measures per tick:
// the job's duration, the alerts recorded, the notifications written, the
// pushes handed to the carrier during the tick and their time from the
// tick's start, and the database's work (pg_stat_database deltas). What the
// tick does not carry is then drained with the five-minute timer's own call
// (`carry()`), pass by pass, so the report says how many timer passes -- and
// so how many five-minute waits -- the rest of the pushes would take.
//
// Needs the API built (`pnpm exec turbo run build --filter=@fmip/api`) and
// its dev dependencies (`@nestjs/testing`). Never against production: it
// refuses a database named `fmip` unless told `--database-is-scratch`, and it
// deletes what it made at the end (a scratch database is simpler to drop).
//
//   DATABASE_URL=postgresql://.../fmip_load SESSION_SECRET=... MODEL_SERVICE_URL=none \
//     node apps/api/scripts/load-match-alerts.mjs --competitions 15 --matches 6 \
//       --members 10000 --teams-per-member 2 --competition-share 0.3 \
//       --ticks 5 --goals-per-tick 10 --push-ms 0
//
// `--queue` (T-835) sends the alerts through BullMQ as production does: the
// live job records and hands over, and a worker in this process expands and
// carries. It needs REDIS_URL pointing at a throwaway Redis (the queue is
// emptied). A tick then reports `job_ms` (the live job alone) and
// `alerts_done_ms` (until the worker has nothing left).
//
// `--push-reads` (T-902) makes the captured push use the database as the Web
// Push channel does: it reads the member's devices before the send and
// touches them after, through the API's own `pg` pool (10 connections). Each
// tick then reports `api_pool`: the most requests waiting for a connection,
// and the share of 10 ms samples in which any waited. With it,
// `NOTIFICATION_SEND_CONCURRENCY` can be sized against the pool on the
// numbers (docs/08-load-test.md, "T-902"). The members have no devices, so
// both statements find nothing; they cost what a device's would, less the
// rows.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { clearInterval, setInterval } from 'node:timers';

const require = createRequire(import.meta.url);
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) =>
      a.startsWith('--')
        ? [
            a.slice(2),
            all[i + 1] === undefined || all[i + 1].startsWith('--') ? 'true' : all[i + 1],
          ]
        : null,
    )
    .filter(Boolean),
);
const COMPETITIONS = Number(args.competitions ?? 15);
const MATCHES = Number(args.matches ?? 6);
const MEMBERS = Number(args.members ?? 10000);
const TEAMS_PER_MEMBER = Number(args['teams-per-member'] ?? 2);
const COMPETITION_SHARE = Number(args['competition-share'] ?? 0.3);
const TICKS = Number(args.ticks ?? 5);
const GOALS_PER_TICK = Number(args['goals-per-tick'] ?? 10);
const PUSH_MS = Number(args['push-ms'] ?? 0);
const QUEUE = args.queue === 'true';
const PUSH_READS = args['push-reads'] === 'true';
const MAX_DRAIN_PASSES = Number(args['max-drain-passes'] ?? 500);
const PROVIDER = 'highlightly';
const RUN = `t834${Date.now().toString(36)}`;
const X = (name) => `${RUN}-${name}`;
const ENGLAND = '00000000-0000-4000-8000-000000000101';

// The notifications timer is a production concern; here every pass is ours.
process.env.NODE_ENV = 'test';
delete process.env.INGESTION_SCHEDULE;

require('reflect-metadata');
const pg = require('pg');
const { Test } = require('@nestjs/testing');
const dist = (path) => require(`../dist/${path}`);
const { DatabaseModule, PG_POOL } = dist('database/database.module');
const { sendConcurrencyFromEnv } = dist('modules/notifications/internal/send-pool');
const { IngestionModule } = dist('modules/ingestion/ingestion.module');
const { IngestionJobsService } = dist('modules/ingestion/ingestion-jobs.service');
const { INGESTION_SOURCES } = dist('modules/ingestion/internal/sources');
const { OUTBOUND_DELIVERY } = dist('modules/delivery/delivery.port');
const { NotificationsService, WEB_ORIGIN } = dist('modules/notifications/notifications.service');
const { MATCH_ALERTS_QUEUE, MatchAlertsService } = dist(
  'modules/match-alerts/match-alerts.service',
);
const { Queue } = require('bullmq');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}
const stats = (values) => ({
  n: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: values.length === 0 ? null : Math.round(Math.max(...values)),
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- the world -----------------------------------------------------------------

const competitions = []; // { id, ext, seasonId }
const matches = []; // { id, ext, comp, home: {id, ext}, away: {id, ext}, score: [h, a] }
const kickoff = new Date(Date.now() - 5 * 60_000).toISOString();
// Rows the run's jobs write are found by this; minus a day for the database's clock.
const startedAt = new Date(Date.now() - 86_400_000).toISOString();

async function guard() {
  const { rows } = await pool.query(`SELECT current_database() AS db`);
  const db = rows[0].db;
  if (db === 'fmip' && args['database-is-scratch'] !== 'true') {
    throw new Error(
      `refusing to load database "${db}": it is the product's name. Point DATABASE_URL at a scratch database (docs/08-load-test.md), or pass --database-is-scratch if it really is one.`,
    );
  }
  return db;
}

async function setUp() {
  const mappings = [];
  for (let c = 0; c < COMPETITIONS; c += 1) {
    const comp = { id: randomUUID(), ext: X(`c${c}`), seasonId: randomUUID() };
    competitions.push(comp);
    await pool.query(
      `INSERT INTO competition (id, country_id, name, kind, scope, gender, age_group, tier)
       VALUES ($1, $2, $3, 'league', 'domestic', 'men', 'senior', 9)`,
      [comp.id, ENGLAND, `Load League ${RUN} ${c}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2026/27', DATE '2026-08-01', DATE '2027-05-31', true)`,
      [comp.seasonId, comp.id],
    );
    mappings.push(['competition', comp.ext, comp.id]);
    for (let m = 0; m < MATCHES; m += 1) {
      const home = { id: randomUUID(), ext: X(`c${c}m${m}h`) };
      const away = { id: randomUUID(), ext: X(`c${c}m${m}a`) };
      const match = { id: randomUUID(), ext: X(`c${c}m${m}`), comp, home, away, score: [0, 0] };
      matches.push(match);
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, $2, 'club', 'men'), ($3, $4, 'club', 'men')`,
        [home.id, `Load Home ${RUN} ${c}-${m}`, away.id, `Load Away ${RUN} ${c}-${m}`],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
        [match.id, comp.seasonId, kickoff],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [match.id, home.id, away.id],
      );
      mappings.push(['team', home.ext, home.id], ['team', away.ext, away.id]);
      mappings.push(['fixture', match.ext, match.id]);
    }
  }
  await pool.query(
    `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
     SELECT $1, t, e, i::uuid FROM unnest($2::text[], $3::text[], $4::text[]) AS m (t, e, i)`,
    [PROVIDER, mappings.map((m) => m[0]), mappings.map((m) => m[1]), mappings.map((m) => m[2])],
  );

  // Members, in one statement: verified, rules accepted, London time (no
  // quiet hours set, so nothing is held: the measurement is of the path, not
  // of a member's sleep).
  await pool.query(
    `INSERT INTO user_account
       (username, display_name, email, country_id, preferred_language, timezone,
        accepted_rules_at, email_verified_at)
     SELECT $1 || n, 'Load ' || n, $1 || n || '@example.test', $2, 'en', 'Europe/London', now(), now()
       FROM generate_series(1, $3) AS n`,
    [`${RUN}_`, ENGLAND, MEMBERS],
  );
  const { rows: members } = await pool.query(
    `SELECT id FROM user_account WHERE username LIKE $1 ORDER BY username`,
    [`${RUN}\\_%`],
  );
  // Follows: each member a few teams at random, and a share of them a
  // competition too. A team follow is the default audience of D-098.
  const teams = matches.flatMap((m) => [m.home.id, m.away.id]);
  const users = [];
  const types = [];
  const ids = [];
  let seed = 834;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (const { id } of members) {
    const chosen = new Set();
    while (chosen.size < Math.min(TEAMS_PER_MEMBER, teams.length)) {
      chosen.add(teams[Math.floor(random() * teams.length)]);
    }
    for (const team of chosen) (users.push(id), types.push('team'), ids.push(team));
    if (random() < COMPETITION_SHARE) {
      (users.push(id), types.push('competition'));
      ids.push(competitions[Math.floor(random() * competitions.length)].id);
    }
  }
  await pool.query(
    `INSERT INTO followed_entity (user_id, entity_type, entity_id)
     SELECT u::uuid, t, e::uuid FROM unnest($1::text[], $2::text[], $3::text[]) AS f (u, t, e)`,
    [users, types, ids],
  );
  return { members: members.length, follows: users.length };
}

async function tearDown() {
  const fixtureIds = matches.map((m) => m.id);
  await pool.query(
    `DELETE FROM notification WHERE user_id IN (SELECT id FROM user_account WHERE username LIKE $1)`,
    [`${RUN}\\_%`],
  );
  await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`${RUN}\\_%`]);
  await pool.query(`DELETE FROM match_alert WHERE fixture_id = ANY($1::uuid[])`, [fixtureIds]);
  await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtureIds]);
  await pool.query(`DELETE FROM provider_mapping WHERE provider = $1 AND external_id LIKE $2`, [
    PROVIDER,
    `${RUN}-%`,
  ]);
  await pool.query(`DELETE FROM ingest_run WHERE provider = $1 AND started_at >= $2`, [
    PROVIDER,
    startedAt,
  ]);
  await pool.query(`DELETE FROM unresolved_entity WHERE provider = $1 AND external_id LIKE $2`, [
    PROVIDER,
    `${RUN}-%`,
  ]);
  await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [
    matches.flatMap((m) => [m.home.id, m.away.id]),
  ]);
  for (const comp of competitions) {
    await pool.query(`DELETE FROM coverage_profile WHERE season_id = $1`, [comp.seasonId]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [comp.seasonId]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [comp.id]);
  }
}

// --- the provider, scripted ------------------------------------------------------

function liveFixture(match) {
  return {
    externalId: match.ext,
    competition: { externalId: match.comp.ext, name: 'Load League' },
    season: { label: '2026/27', startYear: 2026 },
    stage: null,
    round: null,
    kickoffAt: kickoff,
    status: 'live',
    minute: 30,
    home: { externalId: match.home.ext, name: 'Load Home' },
    away: { externalId: match.away.ext, name: 'Load Away' },
    venue: null,
    referee: null,
    scores: {
      current: { home: match.score[0], away: match.score[1] },
      halfTime: null,
      fullTime: null,
      extraTime: null,
      penalties: null,
      aggregate: null,
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}
const ok = (data) => ({ ok: true, data, requests: 1, fetchedAt: new Date().toISOString() });
const unsupported = () => ({
  ok: false,
  error: { kind: 'unsupported', message: 'not scripted' },
  requests: 0,
});
const adapter = {
  manifest: {},
  listFixtures: () => Promise.resolve(unsupported()),
  getLive: ({ fixtureExternalIds }) => {
    const wanted = new Set(fixtureExternalIds);
    return Promise.resolve(ok(matches.filter((m) => wanted.has(m.ext)).map(liveFixture)));
  },
  getLineup: () => Promise.resolve(unsupported()),
  getStandings: () => Promise.resolve(unsupported()),
  getFixtureDetail: () => Promise.resolve(unsupported()),
  getAvailability: () => Promise.resolve(unsupported()),
};

// --- the carrier, captured -------------------------------------------------------

const pushes = []; // { at, userId }
// The API's own pool, once the module is compiled (--push-reads).
let apiPool = null;
const outbound = {
  email: null,
  push: {
    provider: 'capture',
    send: async (push) => {
      // A real Web Push send is an HTTPS request per device; --push-ms stands
      // in for it, sent as the carrier sends them (since T-836, sixteen at a
      // time: NOTIFICATION_SEND_CONCURRENCY). With --push-reads, the
      // channel's own statements around it (T-902).
      if (PUSH_READS) {
        await apiPool.query(
          `SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE user_id = $1 ORDER BY created_at`,
          [push.userId],
        );
      }
      if (PUSH_MS > 0) await sleep(PUSH_MS);
      if (PUSH_READS) {
        await apiPool.query(
          `UPDATE push_subscription SET last_used_at = now() WHERE user_id = $1`,
          [push.userId],
        );
      }
      pushes.push({ at: performance.now(), userId: push.userId });
    },
  },
};

// How the API's pool held up during a tick: the most requests waiting for a
// connection, and the share of 10 ms samples in which any waited (T-902).
function samplePool() {
  if (apiPool === null) return () => null;
  let samples = 0;
  let waited = 0;
  let most = 0;
  const timer = setInterval(() => {
    samples += 1;
    const waiting = apiPool.waitingCount;
    if (waiting > 0) waited += 1;
    most = Math.max(most, waiting);
  }, 10);
  return () => {
    clearInterval(timer);
    return {
      size: apiPool.options.max,
      waiting_max: most,
      waiting_share: samples === 0 ? 0 : Math.round((waited / samples) * 1000) / 1000,
    };
  };
}

async function dbCounters() {
  const { rows } = await pool.query(
    `SELECT xact_commit + xact_rollback AS xacts, tup_inserted, tup_updated, tup_fetched,
            blks_read, blks_hit
       FROM pg_stat_database WHERE datname = current_database()`,
  );
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}
const minus = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] - b[k]]));

// Totals, compared tick to tick: the database's clock is not the script's.
async function counts() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM match_alert WHERE fixture_id = ANY($1::uuid[]))::int AS alerts,
            (SELECT count(*) FROM notification n WHERE n.subject_type = 'fixture'
                AND n.subject_id = ANY($2::text[]))::int AS notifications`,
    [matches.map((m) => m.id), matches.map((m) => m.id)],
  );
  return rows[0];
}

// --- the run ---------------------------------------------------------------------

async function main() {
  const database = await guard();
  const setUpStarted = performance.now();
  const world = await setUp();
  const setUpMs = Math.round(performance.now() - setUpStarted);

  const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, IngestionModule] })
    .overrideProvider(INGESTION_SOURCES)
    .useValue({ kind: 'live', reason: null, forJob: () => ({ provider: PROVIDER, adapter }) })
    .overrideProvider(OUTBOUND_DELIVERY)
    .useValue(outbound)
    .overrideProvider(WEB_ORIGIN)
    .useValue('http://load.test')
    .compile();
  await moduleRef.init();
  const jobs = moduleRef.get(IngestionJobsService);
  const notifications = moduleRef.get(NotificationsService);
  apiPool = moduleRef.get(PG_POOL);

  // With --queue (T-835), the alerts go through BullMQ as in production: the
  // live job records and hands over, and a worker in this process expands
  // and carries. Needs REDIS_URL, a throwaway Redis: the queue is emptied.
  let queue = null;
  if (QUEUE) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('--queue needs REDIS_URL (a throwaway Redis)');
    queue = new Queue(MATCH_ALERTS_QUEUE, { connection: { url, maxRetriesPerRequest: null } });
    await queue.obliterate({ force: true });
    await moduleRef.get(MatchAlertsService).start(url);
  }
  const fixtureIds = matches.map((m) => m.id);
  async function settle() {
    for (;;) {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
      const busy = Object.values(counts).reduce((n, c) => n + c, 0);
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM match_alert
          WHERE fixture_id = ANY($1::uuid[]) AND expanded_at IS NULL`,
        [fixtureIds],
      );
      if (busy === 0 && rows[0].n === 0) return;
      await sleep(25);
    }
  }

  // What a tick did not carry leaves on the five-minute timer, one `carry()`
  // a pass. Drained after every tick, so each tick is measured on its own and
  // the report says how many timer passes -- five minutes each -- it needed.
  const drain = async () => {
    const before = pushes.length;
    let passes = 0;
    for (; passes < MAX_DRAIN_PASSES; passes += 1) {
      const pass = await notifications.carry();
      if (pass.due === 0) break;
    }
    return { passes, pushes: pushes.length - before };
  };
  const ticks = [];
  let order = 834834;
  const pick = () => {
    order = (order * 1103515245 + 12345) % 2147483648;
    return order;
  };
  // Tick 0 is every match kicking off at once (three o'clock); ticks 1..T
  // are bursts of goals in B matches.
  for (let t = 0; t <= TICKS; t += 1) {
    const scored = new Set();
    if (t > 0) {
      while (scored.size < Math.min(GOALS_PER_TICK, matches.length)) {
        scored.add(matches[pick() % matches.length]);
      }
      for (const match of scored) match.score[pick() % 2] += 1;
    }
    const had = await counts();
    const before = await dbCounters();
    const pushesBefore = pushes.length;
    const stopSampling = samplePool();
    const started = performance.now();
    const report = await jobs.live();
    const ended = performance.now();
    // Through the queue (T-835), the tick ends when it has recorded and
    // handed over; the alerts are done when the worker has nothing left.
    if (queue !== null) await settle();
    const settled = performance.now();
    const apiPoolDuringTick = stopSampling();
    const after = await dbCounters();
    const tickPushes = pushes.slice(pushesBefore);
    const timer = await drain();
    const now = await counts();
    const made = {
      alerts: now.alerts - had.alerts,
      notifications: now.notifications - had.notifications,
    };
    ticks.push({
      tick: t,
      kind: t === 0 ? 'kick-off' : 'goals',
      goals: scored.size,
      job_ms: Math.round(ended - started),
      job_partial: report.partial ?? null,
      alerts_done_ms: Math.round(settled - started),
      alerts_recorded: made.alerts,
      notifications_written: made.notifications,
      pushes_in_tick: tickPushes.length,
      push_from_tick_start_ms: stats(tickPushes.map((p) => p.at - started)),
      pushes_left_for_the_timer: timer.pushes,
      timer_passes: timer.passes,
      api_pool: apiPoolDuringTick,
      db: minus(after, before),
    });
  }

  const { rows: undelivered } = await pool.query(
    `SELECT count(*)::int AS n FROM notification n
       LEFT JOIN notification_delivery d ON d.notification_id = n.id
      WHERE n.subject_type = 'fixture' AND n.subject_id = ANY($1::text[]) AND d.notification_id IS NULL`,
    [matches.map((m) => m.id)],
  );
  const inTicks = ticks.reduce((n, t) => n + t.pushes_in_tick, 0);
  const written = ticks.reduce((n, t) => n + t.notifications_written, 0);

  await moduleRef.close();
  if (queue !== null) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  await tearDown();
  await pool.end();

  console.log(
    JSON.stringify(
      {
        run: RUN,
        database,
        shape: {
          competitions: COMPETITIONS,
          matches: matches.length,
          members: world.members,
          follows: world.follows,
          teams_per_member: TEAMS_PER_MEMBER,
          competition_share: COMPETITION_SHARE,
          goal_ticks: TICKS,
          goals_per_tick: GOALS_PER_TICK,
          push_ms: PUSH_MS,
          push_reads: PUSH_READS,
          send_concurrency: sendConcurrencyFromEnv(),
          queue: QUEUE,
        },
        set_up_ms: setUpMs,
        ticks,
        totals: {
          notifications_written: written,
          pushes_in_ticks: inTicks,
          pushes_left_for_the_timer: pushes.length - inTicks,
          timer_passes: ticks.reduce((n, t) => n + t.timer_passes, 0),
          undelivered_after_drain: undelivered[0].n,
        },
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  console.error(error);
  try {
    await tearDown();
  } catch {
    // the scratch database is dropped anyway
  }
  process.exit(1);
});
