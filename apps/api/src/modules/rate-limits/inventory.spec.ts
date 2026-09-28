import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { CEILINGS, EXEMPT, coverageOf, refusalCountedOnResponse } from './inventory';
import { daysUpTo, reportOf } from './rate-limits.service';
import { registerRefusalCounter } from './refusal-counter';

/**
 * The inventory's own logic (T-811). That it covers every route the router
 * has is the console security spec's to prove, against the booted app.
 */
describe('the rate-limit inventory', () => {
  it('says what holds a write: its ceilings, its exemption, the console, or nothing', () => {
    expect(coverageOf('POST /auth/login')).toEqual({
      kind: 'limited',
      actions: ['login_failure_account', 'login_failure_ip'],
    });
    expect(coverageOf('POST /reports')).toMatchObject({ kind: 'exempt' });
    expect(coverageOf('POST /admin/campaigns/:id/send')).toMatchObject({ kind: 'exempt' });
    expect(coverageOf('POST /administer')).toEqual({ kind: 'missing' });
    expect(coverageOf('POST /something-new')).toEqual({ kind: 'missing' });
  });

  it('counts a 429 on the response only for a route held by one database ceiling', () => {
    expect(refusalCountedOnResponse('POST', '/me/friend-requests/:username')).toBe(
      'friend_request',
    );
    expect(refusalCountedOnResponse('POST', '/groups')).toBe('group_create');
    // The API-enforced ones count where they decide, never twice.
    expect(refusalCountedOnResponse('POST', '/auth/login')).toBeNull();
    expect(refusalCountedOnResponse('POST', '/me/briefing')).toBeNull();
    expect(refusalCountedOnResponse('POST', undefined)).toBeNull();
  });

  it('names every ceiling once', () => {
    const actions = CEILINGS.map((c) => c.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('is written down in docs/02-architecture.md, route by route', () => {
    const doc = readFileSync(join(__dirname, '../../../../../docs/02-architecture.md'), 'utf8');
    const start = doc.indexOf('## Rate limits');
    expect(start).toBeGreaterThan(-1);
    const next = doc.indexOf('\n## ', start + 1);
    const section = doc.slice(start, next === -1 ? undefined : next);
    const routes = [...CEILINGS.flatMap((c) => c.routes), ...Object.keys(EXEMPT)];
    expect(routes.filter((r) => !section.includes(`\`${r}\``))).toEqual([]);
    expect(CEILINGS.map((c) => c.action).filter((a) => !section.includes(`\`${a}\``))).toEqual([]);
  });
});

describe('the report', () => {
  it('lists the last days oldest first, in UTC', () => {
    expect(daysUpTo(new Date('2026-03-02T23:30:00Z'), 3)).toEqual([
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('gives every ceiling a count for every day, and says a missing row is no ceiling', () => {
    const days = ['2026-09-27', '2026-09-28'];
    const report = reportOf(
      new Map([['friend_request', 20]]),
      [{ action: 'friend_request', day: '2026-09-28', count: 4 }],
      days,
      new Date('2026-09-28T12:00:00Z'),
    );
    const friend = report.ceilings.find((c) => c.action === 'friend_request');
    expect(friend?.per_hour).toBe(20);
    expect(friend?.refusals).toEqual([
      { day: '2026-09-27', count: 0 },
      { day: '2026-09-28', count: 4 },
    ]);
    expect(report.ceilings.find((c) => c.action === 'message')?.per_hour).toBeNull();
    expect(report.exempt).toHaveLength(Object.keys(EXEMPT).length);
    expect(report.days).toEqual(days);
  });
});

describe('the refusal counter on the response', () => {
  it("counts a trigger's refusal under its ceiling, and nothing else", async () => {
    const seen: string[] = [];
    const fastify = Fastify();
    registerRefusalCounter(fastify, {
      recordRefusal: (action) => {
        seen.push(action);
        return Promise.resolve();
      },
    });
    fastify.post('/groups', (_request, reply) => reply.status(429).send({ error: 'rate_limited' }));
    fastify.post('/auth/login', (_request, reply) => reply.status(429).send({}));
    fastify.post('/me/friend-requests/:username', (_request, reply) => reply.status(201).send({}));
    await fastify.inject({ method: 'POST', url: '/groups' });
    await fastify.inject({ method: 'POST', url: '/auth/login' });
    await fastify.inject({ method: 'POST', url: '/me/friend-requests/someone' });
    await fastify.close();
    expect(seen).toEqual(['group_create']);
  });
});
