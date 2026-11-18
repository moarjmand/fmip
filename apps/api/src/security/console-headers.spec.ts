import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_API_HEADERS,
  isConsoleAddress,
  registerConsoleHeaders,
  withFramingRefused,
} from './console-headers';

/**
 * The agents console's answers from the API (T-1881): never framed, kept,
 * indexed or a referrer, whatever the route answers, and nothing else of the
 * API changes.
 */

describe('the console’s address', () => {
  it('is /console and what is under it, with a query or without', () => {
    for (const url of [
      '/console',
      '/console/',
      '/console/session',
      '/console/model?x=1',
      '/console?x',
    ])
      expect(isConsoleAddress(url), url).toBe(true);
    for (const url of [
      '/consoles',
      '/admin/console',
      '/fixtures/console',
      '/',
      '/health?to=/console/',
    ])
      expect(isConsoleAddress(url), url).toBe(false);
  });
});

describe('a policy with framing refused', () => {
  it('adds to a route’s own policy, and stands alone without one', () => {
    expect(withFramingRefused(undefined)).toBe("frame-ancestors 'none'");
    expect(withFramingRefused('')).toBe("frame-ancestors 'none'");
    expect(withFramingRefused("default-src 'none'; sandbox")).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    );
    expect(withFramingRefused("default-src 'none'; frame-ancestors 'none'")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });
});

describe('the console headers on the API', () => {
  async function served() {
    const fastify = Fastify();
    registerConsoleHeaders(fastify);
    fastify.get('/console/snapshot', (_request, reply) => reply.send({ ok: true }));
    fastify.post('/console/session', (_request, reply) =>
      reply.status(401).send({ error: 'unauthorized' }),
    );
    fastify.get('/console/requests/:id/images/:imageId', (_request, reply) =>
      reply
        .header('content-type', 'image/webp')
        .header('cache-control', 'private, max-age=3600')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(Buffer.from('RIFF')),
    );
    fastify.get('/fixtures', (_request, reply) => reply.send([]));
    return fastify;
  }

  it('are on every console answer: a page’s data, a refusal, a missing route', async () => {
    const fastify = await served();
    for (const [method, url] of [
      ['GET', '/console/snapshot'],
      ['POST', '/console/session'],
      ['GET', '/console/nothing-here.md'],
    ] as const) {
      const answer = await fastify.inject({ method, url });
      for (const [name, value] of Object.entries(CONSOLE_API_HEADERS))
        expect(answer.headers[name], `${url} ${name}`).toBe(value);
      expect(answer.headers['cache-control'], url).toBe('private, no-store');
      expect(answer.headers['content-security-policy'], url).toBe("frame-ancestors 'none'");
    }
    await fastify.close();
  });

  it('keep a picture’s own policy and cache line, with framing refused as well', async () => {
    const fastify = await served();
    const answer = await fastify.inject({ method: 'GET', url: '/console/requests/1/images/2' });
    expect(answer.headers['cache-control']).toBe('private, max-age=3600');
    expect(answer.headers['content-security-policy']).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    );
    expect(answer.headers['x-frame-options']).toBe('DENY');
    expect(answer.headers['referrer-policy']).toBe('no-referrer');
    await fastify.close();
  });

  it('leave every other route as it was', async () => {
    const fastify = await served();
    const answer = await fastify.inject({ method: 'GET', url: '/fixtures' });
    expect(answer.statusCode).toBe(200);
    for (const name of [
      ...Object.keys(CONSOLE_API_HEADERS),
      'cache-control',
      'content-security-policy',
    ])
      expect(answer.headers[name], name).toBeUndefined();
    await fastify.close();
  });
});
