// Load test for the live path (T-073, D-047): many concurrent server-sent-
// event clients on one API process. Opens N clients on the scores stream for
// one day, measures connect + first snapshot, then changes a temporary
// fixture's score in the database and measures how long every client takes
// to receive the new snapshot; watches heartbeats and disconnects for the
// whole run; reports percentiles as JSON. No dependency beyond `pg`, which
// the API already has.
//
//   DATABASE_URL=... node scripts/load-sse.mjs --url http://127.0.0.1:3151 --clients 500 --seconds 60 --changes 10,25,40
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
const URL_BASE = args.url ?? 'http://127.0.0.1:3001';
const CLIENTS = Number(args.clients ?? 500);
const SECONDS = Number(args.seconds ?? 60);
const CHANGE_AT_SECONDS = (args.changes ?? '10,25,40').split(',').map(Number);
// A day nothing else uses, in the seeded current season, between two seeded clubs.
const DAY = '2087-01-05';
const SEASON = '00000000-0000-4000-8000-000000000302';
const HOME = '00000000-0000-4000-8000-000000000602';
const AWAY = '00000000-0000-4000-8000-000000000601';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const fixtureId = randomUUID();

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}
const stats = (values) => ({
  n: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  p99: percentile(values, 99),
  max: values.length === 0 ? null : Math.round(Math.max(...values)),
});

async function setUp() {
  await pool.query(
    `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3::timestamptz, 'live')`,
    [fixtureId, SEASON, `${DAY}T15:00:00Z`],
  );
  await pool.query(
    `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
    [fixtureId, HOME, AWAY],
  );
  await pool.query(
    `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'current', 0, 0)`,
    [fixtureId],
  );
}

async function tearDown() {
  await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixtureId]);
  await pool.end();
}

/** The home goals of our fixture in a scores snapshot, or null when it is not there. */
function homeGoalsIn(snapshot) {
  const cards = [...(snapshot.pinned ?? []), ...(snapshot.groups ?? []).flatMap((g) => g.fixtures)];
  const card = cards.find((c) => c.id === fixtureId);
  return card?.scores?.current?.home ?? null;
}

/** One SSE client: feeds per-event timings into the shared collectors. */
function client(index, collectors, stopAt) {
  return new Promise((resolve) => {
    const started = performance.now();
    let firstSnapshotAt = null;
    let lastEventAt = started;
    let buffer = '';
    let seenGoals = 0;
    let stopping = false;
    const req = http.request(
      `${URL_BASE}/scores/stream?from=${DAY}&to=${DAY}&tz=UTC`,
      { method: 'GET', headers: { accept: 'text/event-stream' }, agent: false },
      (res) => {
        if (res.statusCode !== 200) {
          collectors.failures.push(`client ${index}: HTTP ${res.statusCode}`);
          resolve();
          return;
        }
        collectors.connected += 1;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          const now = performance.now();
          buffer += chunk;
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = /^event: (.+)$/m.exec(frame)?.[1];
            if (event === 'snapshot') {
              if (firstSnapshotAt === null) {
                firstSnapshotAt = now;
                collectors.firstSnapshotMs.push(now - started);
              } else {
                collectors.laterSnapshots += 1;
                let goals = null;
                try {
                  goals = homeGoalsIn(JSON.parse(/^data: (.+)$/m.exec(frame)?.[1] ?? '{}'));
                } catch {
                  collectors.badFrames += 1;
                }
                if (goals !== null && goals > seenGoals) {
                  seenGoals = goals;
                  const changedAt = collectors.changes[goals - 1];
                  if (changedAt !== undefined) collectors.propagationMs.push(now - changedAt);
                }
              }
            } else if (event === 'heartbeat') {
              collectors.heartbeatGapMs.push(now - lastEventAt);
            } else if (event === 'stale') {
              collectors.stale += 1;
            }
            lastEventAt = now;
          }
        });
        res.on('end', () => {
          if (!stopping) collectors.disconnects += 1;
          resolve();
        });
        res.on('error', () => {
          if (!stopping) collectors.disconnects += 1;
          resolve();
        });
        setTimeout(
          () => {
            stopping = true;
            req.destroy();
          },
          Math.max(0, stopAt - performance.now()),
        );
      },
    );
    req.on('error', (error) => {
      if (!stopping) collectors.failures.push(`client ${index}: ${error.message}`);
      resolve();
    });
    req.end();
  });
}

async function main() {
  await setUp();
  const collectors = {
    connected: 0,
    disconnects: 0,
    stale: 0,
    badFrames: 0,
    laterSnapshots: 0,
    failures: [],
    firstSnapshotMs: [],
    propagationMs: [],
    heartbeatGapMs: [],
    changes: [],
  };
  const stopAt = performance.now() + SECONDS * 1000;
  const health = async () => {
    const r = await fetch(`${URL_BASE}/health/live`);
    return r.ok ? (await r.json()).stream_subscribers : null;
  };
  const clients = [];
  const rampStart = performance.now();
  for (let i = 0; i < CLIENTS; i += 1) {
    clients.push(client(i, collectors, stopAt));
    // A steady ramp of ~1000 connections per second: faster overflows the listen backlog.
    if (i % 10 === 9) await new Promise((r) => setTimeout(r, 10));
  }
  const rampMs = performance.now() - rampStart;

  const subscribersAt = {};
  for (const second of CHANGE_AT_SECONDS) {
    await new Promise((r) => setTimeout(r, second * 1000 - (performance.now() - rampStart)));
    subscribersAt[second] = await health();
    const home = collectors.changes.length + 1;
    collectors.changes.push(performance.now());
    await pool.query(
      `UPDATE fixture_score SET home = $2 WHERE fixture_id = $1 AND kind = 'current'`,
      [fixtureId, home],
    );
  }
  await Promise.all(clients);
  const memory = process.memoryUsage();
  await tearDown();

  const expected = collectors.changes.length * collectors.connected;
  const report = {
    url: URL_BASE,
    clients: CLIENTS,
    seconds: SECONDS,
    ramp_ms: Math.round(rampMs),
    connected: collectors.connected,
    failures: collectors.failures.length,
    failure_samples: collectors.failures.slice(0, 5),
    disconnects_before_end: collectors.disconnects,
    stale_events: collectors.stale,
    bad_frames: collectors.badFrames,
    subscribers_seen_by_health: subscribersAt,
    first_snapshot_ms: stats(collectors.firstSnapshotMs),
    changes_sent: collectors.changes.length,
    later_snapshots: collectors.laterSnapshots,
    propagations_received: collectors.propagationMs.length,
    propagations_expected: expected,
    change_propagation_ms: stats(collectors.propagationMs),
    heartbeat_gap_ms: stats(collectors.heartbeatGapMs),
    load_tool_rss_mb: Math.round(memory.rss / 1024 / 1024),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
