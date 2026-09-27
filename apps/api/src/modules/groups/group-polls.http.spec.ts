import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { GroupPoll, GroupPollResponse, GroupPollsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { IdentityModule } from '../identity/identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { GroupsModule } from './groups.module';

/**
 * Group polls over HTTP, against the real schema (T-643, D-091).
 *
 * What it holds the surface to: **members only** (a stranger is 403, and an
 * invite-only group is still 404); **counts, never names**, and none before
 * the member has voted; **votes change until the poll closes**; **three open
 * polls a group**; closing is the creator's or the owner's; removal is the
 * owner's or a moderator's, with a reason and an `audit_log` row; and what
 * was asked is never rewritten, by the API or by a direct write.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const options: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: 'http://web.test',
  cookieSecure: false,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('group polls over HTTP', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const ada = `gp_${RUN}a`; // owner
  const bo = `gp_${RUN}b`; // member, asks
  const cass = `gp_${RUN}c`; // moderator
  const stranger = `gp_${RUN}s`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const slug = `gp-${RUN}`.toLowerCase();
  const hidden = `gp-${RUN}-x`.toLowerCase();
  const base = `/groups/${slug}/polls`;

  const as = (who?: string) =>
    who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
  const send = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    who?: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: as(who),
      payload: payload as Record<string, unknown> | undefined,
    });

  const create = async (who: string, question: string, answers = ['Home', 'Draw', 'Away']) => {
    const response = await send('POST', base, who, { question, options: answers });
    return response;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IdentityModule, GroupsModule],
    })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue(options)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const username of [ada, bo, cass, stranger]) {
      const response = await send('POST', '/auth/register', undefined, {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      });
      expect(response.statusCode).toBe(201);
      cookies.set(username, cookieValue(response.headers['set-cookie']));
      const { rows } = await pool.query<{ id: string }>(
        `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
        [username],
      );
      ids.set(username, rows[0]?.id ?? '');
    }
    for (const [s, visibility] of [
      [slug, 'public'],
      [hidden, 'invite_only'],
    ] as const) {
      const made = await send('POST', '/groups', ada, { slug: s, name: `Polls ${s}`, visibility });
      expect(made.statusCode).toBe(201);
    }
    for (const who of [bo, cass])
      expect((await send('POST', `/groups/${slug}/members`, who)).statusCode).toBe(204);
    expect(
      (await send('PUT', `/groups/${slug}/members/${cass}/role`, ada, { role: 'moderator' }))
        .statusCode,
    ).toBe(204);
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
      await client.query(
        `DELETE FROM group_poll_vote WHERE poll_id IN
           (SELECT p.id FROM group_poll p JOIN user_group g ON g.id = p.group_id
             WHERE g.created_by = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(
        `DELETE FROM group_poll_option WHERE poll_id IN
           (SELECT p.id FROM group_poll p JOIN user_group g ON g.id = p.group_id
             WHERE g.created_by = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(
        `DELETE FROM group_poll WHERE group_id IN
           (SELECT id FROM user_group WHERE created_by = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(
        `DELETE FROM group_member WHERE user_id = ANY($1::uuid[])
            OR group_id IN (SELECT id FROM user_group WHERE created_by = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(`DELETE FROM user_group WHERE created_by = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
    });
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`gp_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  let first: GroupPoll;

  it('is for the group’s members: a guest signs in, a stranger is refused, a hidden group is not there', async () => {
    expect((await send('GET', base)).statusCode).toBe(401);
    expect((await send('GET', base, stranger)).statusCode).toBe(403);
    expect((await create(stranger, 'Anyone?')).statusCode).toBe(403);
    expect((await send('GET', `/groups/${hidden}/polls`, stranger)).statusCode).toBe(404);
    const empty = (await send('GET', base, bo)).json() as GroupPollsResponse;
    expect(empty.polls).toEqual([]);
  });

  it('names every bad field of a poll at once', async () => {
    const response = await send('POST', base, bo, {
      question: 'x'.repeat(201),
      options: ['Home', 'home'],
      closes_in_hours: 24 * 31,
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { fields: Record<string, string> };
    expect(Object.keys(body.fields).sort()).toEqual(['closes_in_hours', 'options', 'question']);
  });

  it('opens a poll with no counts until the member votes, closing in seven days', async () => {
    const response = await create(bo, 'Who wins on Saturday?');
    expect(response.statusCode).toBe(201);
    first = (response.json() as GroupPollResponse).poll;
    expect(first).toMatchObject({
      question: 'Who wins on Saturday?',
      created_by: bo,
      status: 'open',
      my_vote: null,
      total_votes: null,
      closed_at: null,
      may_close: true,
      may_remove: false,
    });
    expect(first.options.map((o) => [o.label, o.votes])).toEqual([
      ['Home', null],
      ['Draw', null],
      ['Away', null],
    ]);
    const days =
      (Date.parse(first.closes_at) - Date.parse(first.created_at)) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 5);

    const owner = ((await send('GET', base, ada)).json() as GroupPollsResponse).polls[0];
    expect(owner).toMatchObject({ id: first.id, may_close: true, may_remove: true });
    const moderator = ((await send('GET', base, cass)).json() as GroupPollsResponse).polls[0];
    expect(moderator).toMatchObject({ may_close: false, may_remove: true });
  });

  it('counts a vote, lets it change, and never says whose it was', async () => {
    const [home, draw] = first.options;
    const vote = (who: string, optionId: string) =>
      send('PUT', `${base}/${first.id}/vote`, who, { option_id: optionId });

    let response = await vote(ada, home!.id);
    expect(response.statusCode).toBe(200);
    let poll = (response.json() as GroupPollResponse).poll;
    expect(poll.options.map((o) => o.votes)).toEqual([1, 0, 0]);
    expect(poll.my_vote).toBe(home!.id);

    response = await vote(bo, home!.id);
    response = await vote(bo, draw!.id);
    poll = (response.json() as GroupPollResponse).poll;
    expect(poll.options.map((o) => o.votes)).toEqual([1, 1, 0]);
    expect(poll.total_votes).toBe(2);
    expect(poll.my_vote).toBe(draw!.id);
    // Nothing in the answer names a voter: ada voted and is not the creator.
    expect(JSON.stringify(poll)).not.toContain(ada);
    expect(JSON.stringify(poll)).not.toContain(ids.get(ada)!);

    // A member who has not voted still sees no counts.
    const unseen = ((await send('GET', base, cass)).json() as GroupPollsResponse).polls[0];
    expect(unseen?.total_votes).toBeNull();

    expect((await vote(bo, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(400);
    expect((await vote(bo, 'not-an-id')).statusCode).toBe(400);
    expect((await vote(stranger, home!.id)).statusCode).toBe(403);
    expect(
      (
        await send('PUT', `${base}/00000000-0000-4000-8000-000000000000/vote`, bo, {
          option_id: home!.id,
        })
      ).statusCode,
    ).toBe(404);

    // Taking it back hides the counts again for that member.
    const back = (
      (await send('DELETE', `${base}/${first.id}/vote`, bo)).json() as GroupPollResponse
    ).poll;
    expect(back.my_vote).toBeNull();
    expect(back.total_votes).toBeNull();
    expect((await vote(bo, draw!.id)).statusCode).toBe(200);
  });

  it('holds at most three open polls in a group', async () => {
    expect((await create(bo, 'Second?')).statusCode).toBe(201);
    expect((await create(cass, 'Third?')).statusCode).toBe(201);
    const fourth = await create(ada, 'Fourth?');
    expect(fourth.statusCode).toBe(409);
    expect((fourth.json() as { message: string }).message).toMatch(/three open polls/);
  });

  it('is closed early by its creator or the owner, and then shows everyone the counts', async () => {
    expect((await send('POST', `${base}/${first.id}/close`, cass)).statusCode).toBe(403);
    const response = await send('POST', `${base}/${first.id}/close`, bo);
    expect(response.statusCode).toBe(200);
    expect((response.json() as GroupPollResponse).poll).toMatchObject({ status: 'closed' });

    const seen = ((await send('GET', base, cass)).json() as GroupPollsResponse).polls.find(
      (p) => p.id === first.id,
    );
    expect(seen).toMatchObject({ status: 'closed', total_votes: 2, my_vote: null });
    // Open polls are listed first.
    const order = ((await send('GET', base, cass)).json() as GroupPollsResponse).polls;
    expect(order.at(-1)?.id).toBe(first.id);

    expect(
      (await send('PUT', `${base}/${first.id}/vote`, cass, { option_id: first.options[0]!.id }))
        .statusCode,
    ).toBe(409);
    expect((await send('DELETE', `${base}/${first.id}/vote`, bo)).statusCode).toBe(409);
    expect((await send('POST', `${base}/${first.id}/close`, bo)).statusCode).toBe(409);
    // One closed: room for another.
    expect((await create(ada, 'Fourth, now?')).statusCode).toBe(201);
  });

  it('is removed by the owner or a moderator with a reason, and the audit log says what it was', async () => {
    const url = `${base}/${first.id}/removal`;
    expect((await send('POST', url, bo, { reason: 'mine' })).statusCode).toBe(403);
    expect((await send('POST', url, cass, { reason: '  ' })).statusCode).toBe(400);
    expect(
      (await send('POST', url, cass, { reason: 'Off topic for this group.' })).statusCode,
    ).toBe(204);
    const polls = ((await send('GET', base, bo)).json() as GroupPollsResponse).polls;
    expect(polls.some((p) => p.id === first.id)).toBe(false);
    expect((await send('POST', url, ada, { reason: 'again' })).statusCode).toBe(404);

    const { rows } = await pool.query<{
      actor_id: string;
      reason: string;
      previous: { question: string; total_votes: number; options: { label: string }[] };
    }>(
      `SELECT actor_id, reason, previous FROM audit_log
        WHERE action = 'group_poll.remove' AND target_type = 'group_poll' AND target_id = $1::text`,
      [first.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: ids.get(cass),
      reason: 'Off topic for this group.',
      previous: { question: 'Who wins on Saturday?', total_votes: 2 },
    });
    expect(rows[0]!.previous.options.map((o) => o.label)).toEqual(['Home', 'Draw', 'Away']);
  });

  it('never rewrites what was asked, even by a direct write', async () => {
    const poll = ((await send('GET', base, bo)).json() as GroupPollsResponse).polls[0]!;
    const refusal = (sql: string, params: unknown[]) =>
      pool.query(sql, params).then(
        () => 'accepted',
        (error: { code?: string }) => error.code,
      );
    expect(
      await refusal(`UPDATE group_poll SET question = 'Changed' WHERE id = $1::uuid`, [poll.id]),
    ).toBe('PL007');
    expect(
      await refusal(`UPDATE group_poll_option SET label = 'Changed' WHERE poll_id = $1::uuid`, [
        poll.id,
      ]),
    ).toBe('PL007');
    expect(
      await refusal(
        `INSERT INTO group_poll_option (poll_id, position, label) VALUES ($1::uuid, 6, 'Late')`,
        [poll.id],
      ),
    ).toBe('PL007');
    // A poll with one option is refused when its transaction commits.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO group_poll (group_id, created_by, question, closes_at)
         SELECT id, $2::uuid, 'Lonely?', now() + interval '1 day' FROM user_group WHERE slug = $1
         RETURNING id`,
        [hidden, ids.get(ada)],
      );
      await client.query(
        `INSERT INTO group_poll_option (poll_id, position, label) VALUES ($1::uuid, 1, 'Only')`,
        [rows[0]!.id],
      );
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
