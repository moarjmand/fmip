// Load test for the match centre's live modules (T-1815, D-409 point 6): many
// readers of one live match on the web server, each holding the page's stream
// open (`/api/fixtures/:id/stream`, proxied to the API) and, like `LiveMatch`,
// calling the read-only server function `refreshLiveModules` after a random
// 0-3 s when a snapshot brings an event. Measures how fast each event reaches
// every reader, how long the calls take, how many match reads reach the API,
// how responsive the web server stays meanwhile (a probe request every
// 250 ms), and the web process's CPU time. No dependency.
//
// The API is a stand-in, so the run measures the web server alone: it serves
// one live fixture (a full payload: line-ups, statistics, player tables),
// its stream, and counts every read of the match.
//
//   node scripts/load-live-modules.mjs --serve-api 3957          # terminal 1: the stand-in API
//   API_BASE_URL=http://127.0.0.1:3957 node node_modules/next/dist/bin/next start -p 3958
//                                                                 # terminal 2: the built web, one process
//   node scripts/load-live-modules.mjs --web http://127.0.0.1:3958 --api http://127.0.0.1:3957 \
//     --clients 1000 --goals 15,35,55 --stats 25 --seconds 70 --web-pid <pid>
//
// The server function's id is read from the build (`.next/server/
// server-reference-manifest.json`); a call is the POST the browser makes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
const FIXTURE = '00000000-0000-4000-8000-000000000901';

// ------------------------------------------------------------ the stand-in API

function standInApi(port) {
  const started = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const kickoff = started - 30 * 60_000;
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const team = (id, name, formation) => ({
    id,
    name,
    short_name: null,
    code: null,
    formation,
    coach: null,
  });
  const positions = [
    'goalkeeper',
    ...Array(4).fill('defender'),
    ...Array(4).fill('midfielder'),
    'forward',
    'forward',
  ];
  const squad = (side, base) =>
    Array.from({ length: 18 }, (_, i) => ({
      id: uuid(base + i),
      name: `${side === 'home' ? 'Home' : 'Away'} Player ${i + 1}`,
      role: i < 11 ? 'starter' : 'bench',
      shirt_number: i + 1,
      position: i < 11 ? positions[i] : 'midfielder',
      is_captain: i === 4,
      grid: null,
    }));
  const lineups = { home: squad('home', 1000), away: squad('away', 2000) };
  const playerStats = [...lineups.home, ...lineups.away]
    .filter((p) => p.role === 'starter')
    .map((p, i) => ({
      id: p.id,
      name: p.name,
      side: i < 11 ? 'home' : 'away',
      stats: {
        minutes: 30,
        rating: 6 + (i % 20) / 10,
        goals: 0,
        assists: 0,
        shots: i % 3,
        key_passes: 1,
        tackles: 2,
      },
    }));
  const statistics = [
    ['possession_pct', 55, 45],
    ['shots', 7, 4],
    ['shots_on_target', 3, 2],
    ['corners', 4, 2],
    ['fouls', 6, 8],
    ['passes', 210, 180],
    ['yellow_cards', 1, 0],
  ].map(([metric, home, away]) => ({ metric, home, away }));
  const covered = (data, at) => ({ coverage: 'available', last_updated_at: at, data });
  const state = { minute: 30, statsAt: iso(started), incidents: [], reads: 0, streams: new Set() };
  const centre = () => ({
    fixture: {
      id: FIXTURE,
      kickoff_at: iso(kickoff),
      status: 'live',
      minute: state.minute,
      competition: { id: uuid(101), name: 'Premier League', short_name: null, country_id: null },
      season: { id: uuid(201), label: '2026/27' },
      stage: null,
      round: 'Regular Season - 12',
      group_name: null,
      leg: null,
      home: team(uuid(301), 'Liverpool', '4-4-2'),
      away: team(uuid(302), 'Chelsea', '4-4-2'),
      scores: {
        current: {
          home: state.incidents.filter((i) => i.side === 'home').length,
          away: state.incidents.filter((i) => i.side === 'away').length,
        },
        half_time: null,
        full_time: null,
        extra_time: null,
        penalties: null,
        aggregate: null,
      },
      venue: null,
      is_neutral_venue: false,
      referee: null,
      attendance: null,
      periods: [
        {
          kind: 'first_half',
          sequence: 1,
          started_at: iso(kickoff),
          ended_at: null,
          added_minutes: null,
        },
      ],
      last_updated_at: iso(Date.now()),
      live_answered_at: iso(Date.now()),
      freshness: null,
    },
    timeline: covered(state.incidents, iso(started)),
    statistics: covered(statistics, state.statsAt),
    lineups: covered(lineups, iso(started)),
    availability: { coverage: 'available', last_updated_at: iso(started), data: [], gap: null },
    player_statistics: covered(playerStats, state.statsAt),
    player_expected_goals: {
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
      source: 'highlightly',
      unplaced: 0,
    },
    form: { home: covered([], iso(started)), away: covered([], iso(started)) },
    head_to_head: covered([], iso(started)),
    coverage: {
      scores: 'available',
      incidents: 'available',
      lineups: 'available',
      statistics: 'available',
      standings: 'available',
      availability: 'available',
      advanced_statistics: 'not_supplied',
    },
  });
  const send = (res, event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = () => {
    const body = centre();
    for (const res of state.streams) send(res, 'snapshot', body);
  };
  setInterval(() => {
    for (const res of state.streams) send(res, 'heartbeat', { at: iso(Date.now()) });
  }, 15_000);
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/__ctl/goal') {
      const n = state.incidents.length + 1;
      state.incidents.push({
        id: uuid(5000 + n),
        sequence: n,
        minute: state.minute,
        added_time: null,
        kind: 'goal',
        side: n % 2 ? 'home' : 'away',
        player: {
          id: lineups[n % 2 ? 'home' : 'away'][9].id,
          name: lineups[n % 2 ? 'home' : 'away'][9].name,
        },
        related_player: null,
        detail: null,
      });
      broadcast();
      res.end('ok');
      return;
    }
    if (path === '/__ctl/stats') {
      state.statsAt = iso(Date.now());
      broadcast();
      res.end('ok');
      return;
    }
    if (path === '/__ctl/clock') {
      state.minute += 1;
      broadcast();
      res.end('ok');
      return;
    }
    if (path === '/__ctl/reads') {
      res.end(String(state.reads));
      return;
    }
    if (path === `/fixtures/${FIXTURE}/stream`) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      state.streams.add(res);
      send(res, 'snapshot', centre());
      req.on('close', () => state.streams.delete(res));
      return;
    }
    if (path === `/fixtures/${FIXTURE}`) {
      state.reads += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(centre()));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not_found","message":"stand-in"}');
  });
  server.maxConnections = 20_000;
  server.listen(port, '127.0.0.1', () => process.stdout.write(`stand-in API on ${port}\n`));
}

if (args['serve-api'] !== undefined) {
  standInApi(Number(args['serve-api']));
} else {
  await run();
}

// ------------------------------------------------------------------- the run

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}
function stats(values) {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length === 0 ? null : Math.round(Math.max(...values)),
  };
}

function actionId() {
  const web = join(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(
    readFileSync(join(web, '.next', 'server', 'server-reference-manifest.json'), 'utf8'),
  );
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    const names = JSON.stringify(entry);
    if (names.includes('refreshLiveModules')) return id;
  }
  throw new Error('refreshLiveModules not found in the build');
}

function cpuSeconds(pid) {
  if (pid === undefined) return null;
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).CPU`],
    {
      encoding: 'utf8',
    },
  );
  return Number(out.trim());
}

async function run() {
  const WEB = args.web ?? 'http://127.0.0.1:3958';
  const API = args.api ?? 'http://127.0.0.1:3957';
  const CLIENTS = Number(args.clients ?? 1000);
  const SECONDS = Number(args.seconds ?? 70);
  const GOALS = (args.goals ?? '15,35,55').split(',').map(Number);
  const STATS = (args.stats ?? '25').split(',').filter(Boolean).map(Number);
  const LOCALE = args.locale ?? 'en';
  // `--calls off`: the stream alone, the baseline the calls are measured against.
  const CALLS = args.calls !== 'off';
  const why = {};
  const ZONE = args.zone ?? 'Europe/London';
  const ID = args['action-id'] ?? actionId();
  const page = `/${LOCALE}/match/${FIXTURE}`;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

  const connect = [];
  const propagation = [];
  const calls = [];
  const callBytes = [];
  const probes = [];
  let callErrors = 0;
  let dropped = 0;
  let goalAt = null;

  const get = (url) =>
    new Promise((resolve) => {
      http.get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      });
    });

  const callAction = (parts) =>
    new Promise((resolve) => {
      const started = performance.now();
      const body = JSON.stringify([FIXTURE, LOCALE, ZONE, parts]);
      const req = http.request(
        `${WEB}${page}`,
        {
          method: 'POST',
          agent,
          headers: {
            accept: 'text/x-component',
            // As a browser asks: the bytes counted are the compressed ones.
            'accept-encoding': 'gzip',
            'next-action': ID,
            'content-type': 'text/plain;charset=UTF-8',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let bytes = 0;
          res.on('data', (c) => (bytes += c.length));
          res.on('end', () => {
            if (res.statusCode !== 200) callErrors += 1;
            else {
              calls.push(performance.now() - started);
              callBytes.push(bytes);
            }
            resolve();
          });
        },
      );
      req.on('error', () => {
        callErrors += 1;
        resolve();
      });
      req.end(body);
    });

  const client = (stopAt) =>
    new Promise((settle) => {
      let done = false;
      const resolve = () => {
        if (!done) settle((done = true));
      };
      const started = performance.now();
      let first = true;
      let drawnEvents = null;
      let seenGoal = 0;
      const req = http.get(
        `${WEB}/api/fixtures/${FIXTURE}/stream?locale=${LOCALE}`,
        { agent: false, headers: { accept: 'text/event-stream' } },
        (res) => {
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            buffer += chunk;
            let at;
            while ((at = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, at);
              buffer = buffer.slice(at + 2);
              if (!block.startsWith('event: snapshot')) continue;
              const data = JSON.parse(block.slice(block.indexOf('data: ') + 6));
              const events = JSON.stringify(data.timeline.data);
              if (first) {
                first = false;
                connect.push(performance.now() - started);
                drawnEvents = events;
                seenGoal = data.timeline.data.length;
                continue;
              }
              // A new goal: how long since the stand-in wrote it.
              if (goalAt !== null && data.timeline.data.length > seenGoal) {
                seenGoal = data.timeline.data.length;
                propagation.push(performance.now() - goalAt);
              }
              // As `LiveMatch`: an event is drawn after a random 0-3 s.
              if (events !== drawnEvents) {
                drawnEvents = events;
                if (CALLS) setTimeout(() => void callAction(['events']), Math.random() * 3_000);
              }
            }
          });
          res.on('close', () => {
            if (performance.now() < stopAt - 50) {
              dropped += 1;
              why[`closed ${res.statusCode}`] = (why[`closed ${res.statusCode}`] ?? 0) + 1;
            }
            resolve();
          });
        },
      );
      req.on('error', (error) => {
        if (performance.now() < stopAt - 50) {
          dropped += 1;
          why[error.code ?? error.message] = (why[error.code ?? error.message] ?? 0) + 1;
        }
        resolve();
      });
      req.on('close', resolve);
      setTimeout(() => req.destroy(), Math.max(0, stopAt - performance.now()));
    });

  const t0 = performance.now();
  const stopAt = t0 + SECONDS * 1_000;
  const readsBefore = Number(await get(`${API}/__ctl/reads`));
  const cpuBefore = cpuSeconds(args['web-pid']);
  const running = [];
  // The web server's responsiveness: a cheap request every 250 ms.
  let probeErrors = 0;
  const probe = setInterval(() => {
    const started = performance.now();
    http
      .get(`${WEB}/robots.txt`, { agent }, (res) => {
        res.resume();
        res.on('end', () => probes.push([performance.now() - t0, performance.now() - started]));
      })
      .on('error', () => (probeErrors += 1));
  }, 250);
  // Fifty connections every `--ramp-ms` (200: 250 a second). Faster than
  // about 500 a second the Windows listen backlog refuses some (docs/08).
  const RAMP_MS = Number(args['ramp-ms'] ?? 200);
  for (let i = 0; i < CLIENTS; i += 1) {
    running.push(client(stopAt));
    if (i % 50 === 49) await new Promise((r) => setTimeout(r, RAMP_MS));
  }
  for (const s of GOALS) {
    setTimeout(
      () => {
        goalAt = performance.now();
        void get(`${API}/__ctl/goal`);
      },
      s * 1_000 - (performance.now() - t0),
    );
  }
  for (const s of STATS) {
    setTimeout(() => void get(`${API}/__ctl/stats`), s * 1_000 - (performance.now() - t0));
  }
  await Promise.all(running);
  clearInterval(probe);
  await new Promise((r) => setTimeout(r, 4_000));
  const readsAfter = Number(await get(`${API}/__ctl/reads`));
  const cpuAfter = cpuSeconds(args['web-pid']);
  const burst = probes.filter(([at]) => GOALS.some((g) => at >= g * 1_000 && at < (g + 4) * 1_000));
  process.stdout.write(
    `${JSON.stringify(
      {
        clients: CLIENTS,
        seconds: SECONDS,
        goals: GOALS.length,
        dropped,
        droppedWhy: why,
        probeErrors,
        calls: CALLS,
        connectFirstSnapshotMs: stats(connect),
        goalReachesReadersMs: stats(propagation),
        callMs: stats(calls),
        callErrors,
        callResponseBytes: stats(callBytes),
        apiMatchReads: readsAfter - readsBefore,
        webCpuSeconds: cpuBefore === null ? null : Math.round((cpuAfter - cpuBefore) * 10) / 10,
        probeMsDuringGoalBursts: stats(burst.map(([, ms]) => ms)),
        probeMsWholeRun: stats(probes.map(([, ms]) => ms)),
      },
      null,
      2,
    )}\n`,
  );
  agent.destroy();
  process.exit(0);
}
