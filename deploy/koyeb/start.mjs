// Entry point for the Koyeb preview image (T-086, D-051).
//
// One container has to hold the two processes a free Instance cannot hold as
// two services, so this is a supervisor, not an init system, and it is
// deliberately strict about it: if either process dies the container dies with
// its exit code, so the platform restarts a whole known-good pair rather than
// leaving a half-running service answering requests it cannot serve.
//
// Order matters. Migrations first, because a web app served against a schema
// from last week is worse than a web app that did not start. Then the API, and
// only once `/health` answers does the web app start — Next.js renders its first
// page by calling the API, and a page rendered against a connection refused is
// an error page cached by nobody's fault but ours.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const API_PORT = process.env.API_PORT ?? '3001';
const WEB_PORT = process.env.PORT ?? '8000';
const HEALTH_URL = `http://127.0.0.1:${API_PORT}/health`;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 500;

/** Structured, one object per line, the same shape the API logs (D-044). */
function log(event, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({ event, message, ...extra })}\n`);
}

function die(message, extra = {}) {
  log('preview.fatal', message, extra);
  process.exit(1);
}

/** Runs a command to completion. Resolves with its exit code. */
function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function migrate() {
  if ((process.env.RUN_MIGRATIONS ?? 'on').toLowerCase() === 'off') {
    log('preview.migrations_skipped', 'RUN_MIGRATIONS=off');
    return;
  }
  log('preview.migrating', 'applying migrations');
  const code = await run('node', [
    'migrator/node_modules/node-pg-migrate/bin/node-pg-migrate.js',
    '--migrations-dir',
    'migrations',
    '--migrations-table',
    'schema_migration',
    'up',
  ]);
  if (code !== 0) die('migrations failed', { code });
}

async function seedPreview() {
  if ((process.env.PREVIEW_SEED ?? 'off').toLowerCase() !== 'on') return;
  // The seed runner refuses a production database on purpose, and this is not
  // one: it is a preview whose whole content is development fixture data. The
  // override is a named variable and this line, so nothing about it is quiet.
  log(
    'preview.seeding',
    'PREVIEW_SEED=on: loading development fixture data. This is not product data.',
  );
  const code = await run('node', ['dist/seed.js'], { NODE_ENV: 'preview' });
  if (code !== 0) die('seeding failed', { code });
}

async function waitForApi(child) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) die('the API exited before it became healthy');
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(HEALTH_INTERVAL_MS);
  }
  die('the API did not answer /health in time', { timeout_ms: HEALTH_TIMEOUT_MS });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    die('DATABASE_URL is not set; the preview has nothing to read. See docs/11-koyeb.md.');
  }

  process.chdir('/app/db');
  await migrate();
  await seedPreview();
  process.chdir('/app');

  const children = [];
  let shuttingDown = false;

  const stopAll = (signal) => {
    shuttingDown = true;
    for (const child of children) child.kill(signal);
  };

  const supervise = (name, child) => {
    children.push(child);
    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      log('preview.child_exited', `${name} exited; stopping the container`, { code, signal });
      shuttingDown = true;
      for (const other of children) {
        if (other !== child) other.kill('SIGTERM');
      }
      process.exit(code ?? 1);
    });
    return child;
  };

  log('preview.starting_api', 'starting the API', { port: API_PORT });
  const api = supervise(
    'api',
    spawn('node', ['api/dist/main.js'], {
      stdio: 'inherit',
      env: { ...process.env, API_PORT },
    }),
  );
  await waitForApi(api);
  log('preview.api_healthy', 'the API answered /health');

  log('preview.starting_web', 'starting the web app', { port: WEB_PORT });
  supervise(
    'web',
    spawn('node', ['web/apps/web/server.js'], {
      stdio: 'inherit',
      env: { ...process.env, PORT: WEB_PORT, HOSTNAME: '0.0.0.0' },
    }),
  );

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      log('preview.stopping', `received ${signal}`);
      stopAll(signal);
    });
  }
}

await main();
