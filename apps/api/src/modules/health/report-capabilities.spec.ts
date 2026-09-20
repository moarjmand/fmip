import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const SCRIPT = join(__dirname, '..', '..', '..', '..', '..', 'deploy', 'report-capabilities.mjs');

/**
 * `deploy/report-capabilities.mjs` (T-075) as it actually ships: the file is
 * run, not a copy of its logic, because it runs on the server through
 * `node -` inside the container and nothing else would catch it drifting.
 *
 * The test that matters most is the last one. The report exists to be pasted
 * to whoever is helping with a deployment, so a secret reaching its output
 * would be a leak into a chat window, a ticket or a screenshot.
 */
describe('report-capabilities', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server !== null) {
      const closing = server;
      server = null;
      await new Promise<void>((resolve) => closing.close(() => resolve()));
    }
  });

  /** A stand-in API answering the four health endpoints. */
  async function serve(bodies: Record<string, unknown>): Promise<string> {
    server = createServer((request, response) => {
      const body = bodies[(request.url ?? '').split('?')[0] ?? ''];
      if (body === undefined) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${address.port}`;
  }

  /** The script's output, parsed back into the map a shell reads line by line. */
  async function report(
    base: string,
    env: Record<string, string> = {},
  ): Promise<Map<string, string>> {
    const { stdout } = await run(process.execPath, [SCRIPT], {
      // A minimal environment: whatever this developer happens to have exported
      // must not decide what the report says.
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        SELF_BASE_URL: base,
        ...env,
      },
    });
    return new Map(
      stdout
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at), line.slice(at + 1)] as const;
        }),
    );
  }

  it('names the provider behind each channel that is configured', async () => {
    const base = await serve({
      '/health': { status: 'ok', uptime_seconds: 42.7 },
      '/health/delivery': {
        email: { state: 'configured', provider: 'smtp' },
        push: { state: 'configured', provider: 'webpush' },
        in_product_only: false,
      },
      '/health/intelligence': {
        language_model: { state: 'configured', provider: 'mistral', model: 'ministral-14b-latest' },
        absent: false,
      },
      '/health/chat': { bus: 'connected' },
    });

    const lines = await report(base);

    expect(lines.get('api')).toBe('ok');
    expect(lines.get('api_uptime_seconds')).toBe('43');
    expect(lines.get('email')).toBe('configured');
    expect(lines.get('email_provider')).toBe('smtp');
    expect(lines.get('push')).toBe('configured');
    expect(lines.get('push_provider')).toBe('webpush');
    expect(lines.get('language_model')).toBe('configured');
    expect(lines.get('language_model_provider')).toBe('mistral');
    expect(lines.get('language_model_name')).toBe('ministral-14b-latest');
    expect(lines.get('in_product_only')).toBe('false');
    expect(lines.get('chat_bus')).toBe('connected');
  });

  it('reports an absent channel as absent and names no provider for it', async () => {
    const base = await serve({
      '/health': { status: 'ok', uptime_seconds: 1 },
      '/health/delivery': {
        email: { state: 'absent' },
        push: { state: 'absent' },
        in_product_only: true,
      },
      '/health/intelligence': { language_model: { state: 'absent' }, absent: true },
      '/health/chat': { bus: 'connected' },
    });

    const lines = await report(base);

    expect(lines.get('email')).toBe('absent');
    expect(lines.get('email_provider')).toBe('');
    expect(lines.get('push')).toBe('absent');
    expect(lines.get('language_model')).toBe('absent');
    expect(lines.get('language_model_name')).toBe('');
    expect(lines.get('in_product_only')).toBe('true');
  });

  it('says so rather than inventing a state when the API does not answer', async () => {
    // A port nothing is listening on: the shape a stopped or crash-looping
    // container presents to this script.
    const lines = await report('http://127.0.0.1:1');

    expect(lines.get('api')).toBe('unreachable');
    expect(lines.get('email')).toBe('unknown');
    expect(lines.get('push')).toBe('unknown');
    expect(lines.get('language_model')).toBe('unknown');
    expect(lines.get('chat_bus')).toBe('unknown');
  });

  it('reports a switch left at its default beside the credential it needs', async () => {
    const base = await serve({
      '/health': { status: 'ok', uptime_seconds: 1 },
      '/health/delivery': {
        email: { state: 'absent' },
        push: { state: 'absent' },
        in_product_only: true,
      },
      '/health/intelligence': { language_model: { state: 'absent' }, absent: true },
      '/health/chat': { bus: 'connected' },
    });

    const lines = await report(base, {
      SMTP_URL: 'smtps://someone:secret@mail.example:465',
      DELIVERY_EMAIL_PROVIDER: 'off',
      // Present but empty is the same as unset: that is how the API reads it.
      DELIVERY_EMAIL_FROM: '   ',
    });

    expect(lines.get('env_SMTP_URL')).toBe('set');
    expect(lines.get('env_DELIVERY_EMAIL_FROM')).toBe('empty');
    expect(lines.get('delivery_email_provider')).toBe('off');
    expect(lines.get('email')).toBe('absent');
  });

  it('never prints the value of a secret', async () => {
    const base = await serve({
      '/health': { status: 'ok', uptime_seconds: 1 },
      '/health/delivery': {
        email: { state: 'absent' },
        push: { state: 'absent' },
        in_product_only: true,
      },
      '/health/intelligence': { language_model: { state: 'absent' }, absent: true },
      '/health/chat': { bus: 'connected' },
    });
    const secrets = {
      SMTP_URL: 'smtps://user:hunter2-smtp@mail.example:465',
      MISTRAL_API_KEY: 'mistral-key-do-not-print',
      ANTHROPIC_API_KEY: 'anthropic-key-do-not-print',
      INTELLIGENCE_API_KEY: 'compatible-key-do-not-print',
      VAPID_PRIVATE_KEY: 'vapid-private-do-not-print',
      VAPID_PUBLIC_KEY: 'vapid-public-do-not-print',
      SESSION_SECRET: 'session-secret-do-not-print',
      API_FOOTBALL_KEY: 'football-key-do-not-print',
      FOOTBALL_DATA_ORG_KEY: 'football-data-key-do-not-print',
      HIGHLIGHTLY_KEY: 'highlightly-key-do-not-print',
    };

    const { stdout } = await run(process.execPath, [SCRIPT], {
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        SELF_BASE_URL: base,
        ...secrets,
      },
    });

    for (const value of Object.values(secrets)) {
      expect(stdout).not.toContain(value);
    }
    for (const name of Object.keys(secrets)) {
      expect(stdout).toContain(`env_${name}=set`);
    }
  });
});
