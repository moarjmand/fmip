import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ConversationSummary, GroupThreadsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { GroupsModule } from '../groups/groups.module';
import { IdentityModule } from '../identity/identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { ConversationsModule } from './conversations.module';

/**
 * Match threads inside a group (T-244), against the real schema.
 *
 * **"A thread is a conversation about a fixture, and says which."** Both
 * clauses are tested for what they actually claim. *A conversation*: it arrives
 * in the ordinary conversation list, a group member who never touched it can
 * write in it, and somebody removed from the group loses it at once — none of
 * which is code written for threads, and all of which would have to be if a
 * thread were its own kind of place. *Says which*: the fixture is on the row and
 * comes back as it stands **now**, so a thread about a match that has since
 * kicked off does not still say it is scheduled (rule 4).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const ESTEGHLAL = '00000000-0000-4000-8000-000000000605';
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('group threads', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const ada = `gt_${RUN}a`;
  const bo = `gt_${RUN}b`;
  const outsider = `gt_${RUN}o`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let competition = '';
  let season = '';
  let fixture = '';
  let other = '';
  let slug = '';

  const as = (who?: string) =>
    who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
  const get = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: as(who) });
  const post = (url: string, payload: unknown, who?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      headers: as(who),
    });

  const register = async (username: string) => {
    const response = await post('/auth/register', {
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
  };

  const newFixture = async (kickoff: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO fixture (season_id, kickoff_at, status)
       VALUES ($1, $2::timestamptz, 'scheduled') RETURNING id`,
      [season, kickoff],
    );
    const id = rows[0]?.id ?? '';
    for (const [side, team] of [
      ['home', LIVERPOOL],
      ['away', ESTEGHLAL],
    ] as const) {
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, $3)`,
        [id, team, side],
      );
    }
    return id;
  };

  const threads = async (who: string): Promise<ConversationSummary[]> => {
    const response = await get(`/groups/${slug}/threads`, who);
    expect(response.statusCode).toBe(200);
    return (response.json() as GroupThreadsResponse).threads;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IdentityModule, ConversationsModule, GroupsModule],
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

    for (const username of [ada, bo, outsider]) await register(username);

    const { rows: competitions } = await pool.query<{ id: string }>(
      `INSERT INTO competition (country_id, name, kind, scope, gender)
       VALUES ($1, $2, 'league', 'domestic', 'men') RETURNING id`,
      [ENGLAND, `Thread League ${RUN}`],
    );
    competition = competitions[0]?.id ?? '';
    const { rows: seasons } = await pool.query<{ id: string }>(
      `INSERT INTO season (competition_id, label, start_date, end_date, is_current)
       VALUES ($1, '2025/26', DATE '2025-08-01', DATE '2026-05-31', false) RETURNING id`,
      [competition],
    );
    season = seasons[0]?.id ?? '';
    fixture = await newFixture('2099-03-01T15:00:00Z');
    other = await newFixture('2099-04-01T15:00:00Z');

    slug = `gt-${RUN}`.toLowerCase();
    expect(
      (await post('/groups', { slug, name: `Thread Group ${RUN}`, visibility: 'public' }, ada))
        .statusCode,
    ).toBe(201);
    expect((await post(`/groups/${slug}/members`, {}, bo)).statusCode).toBe(204);
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM message WHERE author_id = ANY($1::uuid[])`, [everyone]);
      await client.query(
        `DELETE FROM conversation WHERE group_id IN
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
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`gt_${RUN}%`]);
    if (season !== '') {
      await pool.query(
        `DELETE FROM fixture_score WHERE fixture_id IN (SELECT id FROM fixture WHERE season_id = $1)`,
        [season],
      );
      await pool.query(`DELETE FROM fixture WHERE season_id = $1`, [season]);
    }
    if (competition !== '') {
      await pool.query(`DELETE FROM season WHERE competition_id = $1`, [competition]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
    }
    await pool.end();
    await app.close();
  });

  it('opens a thread about a fixture and says which', async () => {
    const opened = await post(`/groups/${slug}/threads`, { fixture_id: fixture }, ada);
    expect(opened.statusCode).toBe(201);

    const [thread] = await threads(ada);
    expect(thread?.kind).toBe('group_thread');
    expect(thread?.group?.slug).toBe(slug);
    // The whole second clause of the acceptance criterion: it says which match,
    // by naming it rather than by a title somebody typed.
    expect(thread?.fixture?.id).toBe(fixture);
    expect(thread?.fixture?.home).toBe('Liverpool');
    expect(thread?.fixture?.last_updated_at).toBeTypeOf('string');
    // Its membership is the group's, so there is no member list of its own to
    // name a subset of the group (D-058).
    expect(thread?.members).toEqual([]);
  });

  it('gives two members reaching for the same match the same room', async () => {
    const first = await post(`/groups/${slug}/threads`, { fixture_id: other }, ada);
    const second = await post(`/groups/${slug}/threads`, { fixture_id: other }, bo);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect((second.json() as { id: string }).id).toBe((first.json() as { id: string }).id);
    expect((await threads(ada)).filter((t) => t.fixture?.id === other)).toHaveLength(1);
  });

  it('says the score the match has now, not the one it had when the thread opened', async () => {
    const opened = await post(`/groups/${slug}/threads`, { fixture_id: fixture }, ada);
    expect(opened.statusCode).toBe(201);
    const before = (await threads(ada)).find((t) => t.fixture?.id === fixture);
    expect(before?.fixture?.score).toBeNull();

    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'current', 2, 1)`,
      [fixture],
    );

    const after = (await threads(ada)).find((t) => t.fixture?.id === fixture);
    expect(after?.fixture?.score).toEqual({ home: 2, away: 1 });
  });

  it('is a conversation: a member who never touched it can write in it', async () => {
    const opened = await post(`/groups/${slug}/threads`, { fixture_id: fixture }, ada);
    const room = (opened.json() as { id: string }).id;

    // Bo has no participant row in this thread and never will until they read
    // or mute it. The write guard asks the group, which is why this works and
    // why nothing had to be written to make it work.
    const said = await post(`/me/conversations/${room}/messages`, { body: 'up the reds' }, bo);
    expect(said.statusCode).toBe(201);

    // And it is in the ordinary conversation list, not a separate listing.
    const listed = await get('/me/conversations', bo);
    expect(listed.statusCode).toBe(200);
    const all = (listed.json() as { conversations: ConversationSummary[] }).conversations;
    expect(all.some((c) => c.id === room && c.kind === 'group_thread')).toBe(true);
  });

  it('refuses somebody outside the group, without pretending the group is gone', async () => {
    const refused = await post(`/groups/${slug}/threads`, { fixture_id: fixture }, outsider);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/not in this group/);
    expect((await get(`/groups/${slug}/threads`, outsider)).statusCode).toBe(403);
  });

  it('refuses a thread opened from outside the group at the database', async () => {
    // The API check above is the courteous answer; this is the guard. A thread
    // that existed in a group its opener is not in would be a room they could
    // write in, because the write guard asks the group and not the row.
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM user_group WHERE slug = $1`, [
      slug,
    ]);
    await expect(
      pool.query(
        `INSERT INTO conversation (kind, group_id, fixture_id, opened_by)
         VALUES ('group_thread', $1, $2, $3)`,
        [rows[0]?.id ?? '', other, ids.get(outsider) ?? ''],
      ),
    ).rejects.toMatchObject({ code: 'PL012' });
  });

  it('takes the thread away from a member who leaves the group, at once', async () => {
    const opened = await post(`/groups/${slug}/threads`, { fixture_id: fixture }, ada);
    const room = (opened.json() as { id: string }).id;
    expect((await get('/me/conversations', bo)).json().conversations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: room })]),
    );

    expect(
      (await app.inject({ method: 'DELETE', url: `/groups/${slug}/members/me`, headers: as(bo) }))
        .statusCode,
    ).toBe(204);

    // Nothing was written to the thread to make this true: its membership is
    // the group's, so leaving the group is leaving the thread (D-058).
    const after = (await get('/me/conversations', bo)).json().conversations;
    expect(after.some((c: ConversationSummary) => c.id === room)).toBe(false);
    expect(
      (await post(`/me/conversations/${room}/messages`, { body: 'still here?' }, bo)).statusCode,
    ).toBe(404);
  });

  it('refuses a thread about a fixture that does not exist, and names the field', async () => {
    const refused = await post(
      `/groups/${slug}/threads`,
      { fixture_id: '00000000-0000-4000-8000-0000000000ff' },
      ada,
    );
    expect(refused.statusCode).toBe(400);
    expect(refused.json().fields).toEqual({ fixture_id: 'No such fixture.' });
  });
});
