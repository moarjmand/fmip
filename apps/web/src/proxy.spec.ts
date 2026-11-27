import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSOLE_HEADERS, consoleContentPolicy, consoleNonce } from '@/lib/console-headers';

vi.mock('@/lib/api', () => ({
  fetchHeldLocales: async () => ({ ok: true, data: { held: [] } }),
}));
const { config, proxy } = await import('./proxy');

/**
 * The proxy's console rules (T-1881): every console answer, under its own
 * host and under the site's path, carries the frame, cache, referrer and
 * index headers and the enforced content policy with a nonce; a site page
 * carries none of them; and no path under `/console`, with a file extension
 * or without, is served on the site's host.
 */

const SITE = 'traveltohormuz.ir';
const CONSOLE = 'agents.traveltohormuz.ir';

const ask = (host: string, path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`https://${host}${path}`, { headers: { host, ...headers } }));

/** The nonce a policy names in `script-src`. */
const nonceOf = (policy: string | null): string =>
  /script-src [^;]*'nonce-([^']+)'/.exec(policy ?? '')?.[1] ?? '';

/** Whether Next hands a path to the proxy: any of the matcher's entries, whole. */
const matched = (path: string): boolean =>
  config.matcher.some((source) => new RegExp(`^${source}$`).test(path));

beforeEach(() => {
  vi.stubEnv('CONSOLE_HOST', CONSOLE);
  vi.stubEnv('CONSOLE_PATH', '/agents');
  vi.stubEnv('NODE_ENV', 'production');
});
afterEach(() => vi.unstubAllEnvs());

describe('the console content policy', () => {
  it('names only what the console loads, and no inline or evaluated script', () => {
    expect(consoleContentPolicy('N0nce')).toBe(
      "default-src 'self'; script-src 'self' 'nonce-N0nce' 'strict-dynamic'; " +
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; " +
        "connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; " +
        "form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
    );
    const scripts = /script-src ([^;]*)/.exec(consoleContentPolicy('N0nce'))![1]!;
    expect(scripts).not.toContain('unsafe-inline');
    expect(scripts).not.toContain('unsafe-eval');
    expect(consoleContentPolicy('N0nce')).not.toMatch(/https?:|\*/);
  });

  it('allows evaluation only under the development server', () => {
    const development = consoleContentPolicy('N0nce', true);
    expect(development).toContain(
      "script-src 'self' 'nonce-N0nce' 'strict-dynamic' 'unsafe-eval';",
    );
    expect(development.replace(" 'unsafe-eval'", '')).toBe(consoleContentPolicy('N0nce'));
  });

  it('makes a nonce of 128 random bits, new each time', () => {
    const seen = new Set(Array.from({ length: 200 }, consoleNonce));
    expect(seen.size).toBe(200);
    for (const nonce of seen) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('a console answer', () => {
  const forms: Array<[string, string, string, string, string]> = [
    ['under the path on the site’s host', SITE, '/agents/login', '/console/login', '/agents'],
    ['under the path itself', SITE, '/agents', '/console', '/agents'],
    ['on the console’s own host', CONSOLE, '/login', '/console/login', ''],
    ['on the console’s host, a dotted path', CONSOLE, '/console/a.md', '/console/a.md', ''],
  ];

  it.each(forms)('%s is never framed, kept, indexed or a referrer', async (_n, host, path) => {
    const response = await ask(host, path);
    for (const [name, value] of Object.entries(CONSOLE_HEADERS))
      expect(response.headers.get(name), name).toBe(value);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  });

  it.each(forms)('%s carries the enforced policy, its nonce handed to Next', async (...form) => {
    const [, host, path, rewritten, base] = form;
    const response = await ask(host, path, {
      // What a browser sends under these names is never passed on.
      'content-security-policy': "script-src 'nonce-chosen-by-the-client'",
      'x-fmip-console-base': '/elsewhere',
    });
    const policy = response.headers.get('Content-Security-Policy');
    expect(policy).toBe(consoleContentPolicy(nonceOf(policy)));
    expect(nonceOf(policy)).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(response.headers.has('Content-Security-Policy-Report-Only')).toBe(false);
    // `NextResponse.rewrite` names the route and the request headers it overrides.
    expect(new URL(response.headers.get('x-middleware-rewrite')!).pathname).toBe(rewritten);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(response.headers.get('x-middleware-request-x-fmip-console-base')).toBe(base);
  });

  it.each([
    [SITE, '/agents/request-images/1/2'],
    [CONSOLE, '/request-images/1'],
  ])('keeps a request picture’s own policy on %s%s: nothing loads or runs', async (host, path) => {
    const response = await ask(host, path);
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    );
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('has a nonce of its own on every request', async () => {
    const first = nonceOf(
      (await ask(SITE, '/agents/board')).headers.get('Content-Security-Policy'),
    );
    const second = nonceOf(
      (await ask(SITE, '/agents/board')).headers.get('Content-Security-Policy'),
    );
    expect(first).not.toBe('');
    expect(second).not.toBe(first);
  });
});

describe('the console’s routes on the site’s host', () => {
  it.each([
    '/console',
    '/console/login',
    '/console/agents/security.md',
    '/console/request-images/a.png',
    '/console/reminders-worker.js',
    // Next's other addresses of the same routes: their payload, their segments.
    '/console.rsc',
    '/console/login.rsc',
    '/console.segments/_tree.segment.rsc',
    '/console.txt',
  ])('%s is a 404 that is never framed, kept or indexed', async (path) => {
    expect(matched(path)).toBe(true);
    const response = await ask(SITE, path, { 'x-fmip-console-base': '/agents' });
    expect(response.status).toBe(404);
    expect(response.headers.has('x-middleware-rewrite')).toBe(false);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  });

  it('is a 404 with no console configured at all', async () => {
    vi.stubEnv('CONSOLE_HOST', '');
    vi.stubEnv('CONSOLE_PATH', '');
    expect((await ask(SITE, '/console/agents/security.md')).status).toBe(404);
    expect((await ask(SITE, '/agents/login')).headers.has('Content-Security-Policy')).toBe(false);
  });
});

describe('the matcher', () => {
  it('hands the proxy every path under /console, with an extension or without', () => {
    for (const path of [
      '/console',
      '/console/',
      '/console/board',
      '/console/a/b.c/d.e',
      '/console.rsc',
      '/console.segments/_tree.segment.rsc',
    ])
      expect(matched(path), path).toBe(true);
  });

  it('still leaves the site’s files, assets, API routes and health to Next', () => {
    for (const path of ['/en/scores', '/', '/agents', '/agents/login', '/consoles'])
      expect(matched(path), path).toBe(true);
    for (const path of [
      '/_next/static/chunks/a.js',
      '/api/live/stream',
      '/health',
      '/favicon.ico',
      '/icons/icon-192.png',
      '/sw.js',
      '/consoles/a.md',
      '/en/console/a.md',
    ])
      expect(matched(path), path).toBe(false);
  });
});

describe('a site page', () => {
  it.each(['/en/scores', '/fa', '/en/console'])('%s gets none of the console’s', async (path) => {
    const response = await ask(SITE, path);
    expect(response.status).toBe(200);
    expect(response.headers.has('Content-Security-Policy')).toBe(false);
    expect(response.headers.has('x-middleware-request-content-security-policy')).toBe(false);
    expect(response.headers.has('X-Frame-Options')).toBe(false);
    expect(response.headers.has('Referrer-Policy')).toBe(false);
    expect(response.headers.has('Cache-Control')).toBe(false);
  });

  it.each(['/en/privacy', '/fa/privacy', '/x-rtl/privacy'])(
    '%s is never indexed while the trial is private (T-1969, D-465)',
    async (path) => {
      const response = await ask(SITE, path);
      expect(response.status).toBe(200);
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    },
  );

  it.each(['/en/rules', '/fa/scores', '/en/privacy-policy'])(
    '%s carries no X-Robots-Tag',
    async (path) => {
      const response = await ask(SITE, path);
      expect(response.headers.has('X-Robots-Tag')).toBe(false);
    },
  );

  it('is redirected to its language without them either', async () => {
    const response = await ask(SITE, '/scores');
    expect(response.status).toBe(307);
    expect(response.headers.has('Content-Security-Policy')).toBe(false);
    expect(response.headers.has('X-Frame-Options')).toBe(false);
  });
});

describe('the edge (deploy/Caddyfile)', () => {
  const root = join(__dirname, '..', '..', '..');
  const caddyfile = readFileSync(join(root, 'deploy', 'Caddyfile'), 'utf8');
  const compose = readFileSync(join(root, 'deploy', 'docker-compose.prod.yml'), 'utf8');
  /** A `header` block's lines, from its opening line to its closing brace. */
  const block = (opening: string, from = 0): string => {
    const start = caddyfile.indexOf(opening, from);
    expect(start, opening).toBeGreaterThan(-1);
    return caddyfile.slice(start, caddyfile.indexOf('\n\t}', start) + 1);
  };
  const strict = [
    'X-Frame-Options "DENY"',
    'Referrer-Policy "no-referrer"',
    'X-Robots-Tag "noindex, nofollow"',
    'Cache-Control "private, no-store"',
    `+Content-Security-Policy "frame-ancestors 'none'"`,
    'defer',
  ];

  it('gives the path the compose file serves the console under the console’s headers', () => {
    const path = /^\s+CONSOLE_PATH: \$\{CONSOLE_PATH-(\/[a-z0-9-]+)\}$/m.exec(compose)?.[1];
    expect(path).toBe('/agents');
    expect(caddyfile).toContain(
      `\t@console path ${path} ${path}/* /console /console/* /console.*\n`,
    );
    const headers = block('\theader @console {');
    for (const line of strict) expect(headers, line).toContain(`\t\t${line}\n`);
  });

  it('gives the console’s own host the same', () => {
    const site = caddyfile.indexOf('{$CONSOLE_HOST:console.invalid} {');
    expect(site).toBeGreaterThan(-1);
    const headers = block('\theader {', site);
    for (const line of strict) expect(headers, line).toContain(`\t\t${line}\n`);
  });

  it('answers 404 for the console’s routes on the site’s host, and leaves the site’s policy alone', () => {
    expect(caddyfile).toContain(
      '\t@console_routes path /console /console/* /console.*\n\thandle @console_routes {\n\t\trespond "Not found" 404\n\t}',
    );
    const general = block('\theader {');
    expect(general).toContain('X-Frame-Options "SAMEORIGIN"');
    expect(general).toContain("Content-Security-Policy-Report-Only \"default-src 'self';");
    expect(general).not.toContain('\t\tContent-Security-Policy "');
  });
});
