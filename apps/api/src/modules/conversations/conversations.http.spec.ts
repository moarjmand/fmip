import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { SocialModule } from '../social/social.module';
import { ConversationsModule } from './conversations.module';

/**
 * The acceptance criterion for T-221, over HTTP with real sessions and the real
 * schema: **a blocked or sanctioned member cannot send, and every conversation
 * can be left.**
 *
 * `SocialModule` is here because a direct conversation needs a friendship to
 * open, and a block is what ends one. The two boundaries meet on this surface
 * and the test is where that meeting is checked.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const ESTEGHLAL = '00000000-0000-4000-8000-000000000605';
const SALAH = '00000000-0000-4000-8000-000000000701';
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('conversations', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const ada = `ct_${RUN}a`;
  const bo = `ct_${RUN}b`;
  const stranger = `ct_${RUN}s`;
  const moderator = `ct_${RUN}m`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let room = '';
  // A fixture of this suite's own, so the score can be changed underneath a
  // shared card without touching anything another suite is reading.
  let competition = '';
  let season = '';
  let fixture = '';

  const register = async (username: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    cookies.set(username, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(username, rows[0]?.id ?? '');
  };

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
  const del = (url: string, who?: string) =>
    app.inject({ method: 'DELETE', url, headers: as(who) });
  const put = (url: string, who?: string) => app.inject({ method: 'PUT', url, headers: as(who) });

  const befriend = async (a: string, b: string) => {
    expect((await post(`/me/friend-requests/${b}`, null, a)).statusCode).toBe(204);
    expect((await post(`/me/friend-requests/${a}/accept`, null, b)).statusCode).toBe(204);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IdentityModule, ConversationsModule, SocialModule],
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

    for (const username of [ada, bo, stranger, moderator]) await register(username);
    await befriend(ada, bo);

    const { rows: competitions } = await pool.query<{ id: string }>(
      `INSERT INTO competition (country_id, name, kind, scope, gender)
       VALUES ($1, $2, 'league', 'domestic', 'men') RETURNING id`,
      [ENGLAND, `Card League ${RUN}`],
    );
    competition = competitions[0]?.id ?? '';
    const { rows: seasons } = await pool.query<{ id: string }>(
      `INSERT INTO season (competition_id, label, start_date, end_date, is_current)
       VALUES ($1, '2025/26', DATE '2025-08-01', DATE '2026-05-31', false) RETURNING id`,
      [competition],
    );
    season = seasons[0]?.id ?? '';
    const { rows: fixtures } = await pool.query<{ id: string }>(
      `INSERT INTO fixture (season_id, kickoff_at, status)
       VALUES ($1, TIMESTAMPTZ '2099-03-01T15:00:00Z', 'scheduled') RETURNING id`,
      [season],
    );
    fixture = fixtures[0]?.id ?? '';
    for (const [side, team] of [
      ['home', LIVERPOOL],
      ['away', ESTEGHLAL],
    ] as const) {
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, $3)`,
        [fixture, team, side],
      );
    }
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM conversation_pin WHERE pinned_by = ANY($1::uuid[])`, [
        everyone,
      ]);
      await client.query(`DELETE FROM message_reaction WHERE user_id = ANY($1::uuid[])`, [
        everyone,
      ]);
      await client.query(`DELETE FROM message_mention WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM message WHERE author_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM sanction WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM moderation_decision WHERE moderator_id = ANY($1::uuid[])`, [
        everyone,
      ]);
    } finally {
      await client.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE user_id = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(`DELETE FROM user_prediction WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`ct_${RUN}%`]);
    if (season !== '') await pool.query(`DELETE FROM fixture WHERE season_id = $1`, [season]);
    if (competition !== '') {
      await pool.query(`DELETE FROM season WHERE competition_id = $1`, [competition]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
    }
    await pool.end();
    await app.close();
  });

  it('tells a guest to sign in', async () => {
    for (const response of await Promise.all([
      get('/me/conversations'),
      post(`/me/conversations/direct/${bo}`, null),
    ])) {
      expect(response.statusCode).toBe(401);
    }
  });

  it('opens a direct conversation only with a friend, and only once', async () => {
    // Blueprint 8.1 gives "start a direct conversation" to friends. Taking it
    // literally is what removes the direct-message spam surface: nobody can put
    // words in front of somebody who has not agreed to hear from them.
    const refused = await post(`/me/conversations/direct/${stranger}`, null, ada);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/friends/i);

    expect((await post(`/me/conversations/direct/${ada}`, null, ada)).statusCode).toBe(400);
    expect((await post(`/me/conversations/direct/nobody_${RUN}`, null, ada)).statusCode).toBe(404);

    const opened = await post(`/me/conversations/direct/${bo}`, null, ada);
    expect(opened.statusCode).toBe(201);
    room = opened.json().id;

    // Both members, and the same conversation from either side: two rows would
    // be two histories for one pair.
    const fromTheOtherSide = await post(`/me/conversations/direct/${ada}`, null, bo);
    expect(fromTheOtherSide.json().id).toBe(room);
  });

  it('keeps the order the store decided, and pages backwards by sequence', async () => {
    for (const [who, text] of [
      [ada, 'are you watching this'],
      [bo, 'both of us are'],
      [ada, 'that was never a foul'],
    ] as const) {
      const sent = await post(`/me/conversations/${room}/messages`, { body: text }, who);
      expect(sent.statusCode).toBe(201);
    }

    const page = (await get(`/me/conversations/${room}`, ada)).json();
    expect(page.messages.map((m: { seq: number }) => m.seq)).toEqual([1, 2, 3]);
    expect(page.latest_seq).toBe(3);
    expect(page.has_earlier).toBe(false);

    // `before` is a sequence, not an offset, so a message arriving mid-scroll
    // cannot shift the page under somebody's thumb.
    const earlier = (await get(`/me/conversations/${room}?before=3`, ada)).json();
    expect(earlier.messages.map((m: { seq: number }) => m.seq)).toEqual([1, 2]);
  });

  it('refuses an empty message and a reply to another conversation', async () => {
    const empty = await post(`/me/conversations/${room}/messages`, { body: '   ' }, ada);
    expect(empty.statusCode).toBe(400);
    expect(empty.json().fields.body).toBeTruthy();

    const elsewhere = await post(
      `/me/conversations/${room}/messages`,
      { body: 'replying', reply_to_id: '00000000-0000-4000-8000-0000000009ff' },
      ada,
    );
    // A reply pointing at another conversation is a link to nowhere, and a way
    // to learn that a message id exists somewhere else.
    expect(elsewhere.statusCode).toBe(400);
  });

  it('answers "not found" to somebody who is not in it', async () => {
    // Not "forbidden": a 403 would confirm that this id names a real
    // conversation.
    expect((await get(`/me/conversations/${room}`, stranger)).statusCode).toBe(404);
    expect(
      (await post(`/me/conversations/${room}/messages`, { body: 'hello' }, stranger)).statusCode,
    ).toBe(404);
  });

  it('carries unread and read state, and the other side only in a direct conversation', async () => {
    const before = (await get('/me/conversations', bo)).json().conversations[0];
    expect(before.unread).toBeGreaterThan(0);
    expect(before.members.map((m: { username: string }) => m.username).sort()).toEqual(
      [ada, bo].sort(),
    );

    expect((await post(`/me/conversations/${room}/read`, { seq: 3 }, bo)).statusCode).toBe(204);

    const after = (await get('/me/conversations', bo)).json().conversations[0];
    expect(after.unread).toBe(0);
    // Ada can see how far Bo has read, because there are exactly two of them.
    expect((await get('/me/conversations', ada)).json().conversations[0].their_read_seq).toBe(3);
  });

  it('lets the author take their own message down, and nobody else', async () => {
    const sent = await post(
      `/me/conversations/${room}/messages`,
      { body: 'something regrettable' },
      ada,
    );
    const id = sent.json().message.id;

    // Not theirs: one answer, because three would say which.
    expect((await del(`/me/conversations/${room}/messages/${id}`, bo)).statusCode).toBe(404);
    expect((await del(`/me/conversations/${room}/messages/${id}`, ada)).statusCode).toBe(204);
    // Removing it twice would let somebody overwrite who took it down.
    expect((await del(`/me/conversations/${room}/messages/${id}`, ada)).statusCode).toBe(404);

    const page = (await get(`/me/conversations/${room}`, bo)).json();
    const tombstone = page.messages.find((m: { id: string }) => m.id === id);
    // The row stays with its number, so the conversation around it still reads.
    expect(tombstone).toMatchObject({ body: null, removed: { by: 'author' } });
    expect(tombstone.seq).toBe(4);
  });

  describe('a shared football card', () => {
    it('is a reference, and a match with no comment is a real thing to send', async () => {
      const sent = await post(
        `/me/conversations/${room}/messages`,
        { card: { kind: 'fixture', id: fixture } },
        ada,
      );

      expect(sent.statusCode).toBe(201);
      expect(sent.json().message.body).toBeNull();
      expect(sent.json().message.card).toMatchObject({
        kind: 'fixture',
        id: fixture,
        home: 'Liverpool',
        away: 'Esteghlal',
        score: null,
        status: 'scheduled',
      });
      // Rule 4: a live surface says when it last changed.
      expect(sent.json().message.card.last_updated_at).toBeTruthy();
    });

    it('stays live: the score changes without the conversation moving', async () => {
      // Blueprint 8.3: "Match cards shared in chat remain live. The score and
      // status update without replacing the original discussion context."
      const before = (await get(`/me/conversations/${room}`, bo)).json();
      const shared = before.messages.find(
        (m: { card: { kind: string } | null }) => m.card?.kind === 'fixture',
      );
      expect(shared.card.score).toBeNull();

      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'current', 2, 1)`,
        [fixture],
      );
      await pool.query(`UPDATE fixture SET status = 'live' WHERE id = $1`, [fixture]);

      const after = (await get(`/me/conversations/${room}`, bo)).json();
      const now = after.messages.find((m: { id: string }) => m.id === shared.id);

      expect(now.card).toMatchObject({ score: { home: 2, away: 1 }, status: 'live' });
      // The same message, in the same place, with the same words: the card was
      // resolved again rather than replaced.
      expect(now.seq).toBe(shared.seq);
      expect(now.body).toBe(shared.body);
      expect(after.messages.length).toBe(before.messages.length);
    });

    it('shares a team and a person by id, and refuses a kind nothing can produce', async () => {
      const team = await post(
        `/me/conversations/${room}/messages`,
        { body: 'still the best', card: { kind: 'team', id: LIVERPOOL } },
        ada,
      );
      expect(team.json().message.card).toMatchObject({ kind: 'team', name: 'Liverpool' });

      const person = await post(
        `/me/conversations/${room}/messages`,
        { card: { kind: 'person', id: SALAH } },
        ada,
      );
      expect(person.json().message.card).toMatchObject({ kind: 'person', name: 'Mohamed Salah' });

      // `article` joins the list when E14 builds news.
      const unbuilt = await post(
        `/me/conversations/${room}/messages`,
        { card: { kind: 'article', id: SALAH } },
        ada,
      );
      expect(unbuilt.statusCode).toBe(400);
    });

    it('refuses a card that names nothing, and a message that is neither words nor card', async () => {
      const nothing = await post(
        `/me/conversations/${room}/messages`,
        { card: { kind: 'fixture', id: '00000000-0000-4000-8000-0000000009fe' } },
        ada,
      );
      expect(nothing.statusCode).toBe(400);
      expect(nothing.json().fields.card).toBeTruthy();

      const empty = await post(`/me/conversations/${room}/messages`, {}, ada);
      expect(empty.statusCode).toBe(400);
    });

    it('shares your own prediction and nobody else’s', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_prediction (user_id, fixture_id) VALUES ($1, $2) RETURNING id`,
        [ids.get(bo), fixture],
      );
      const theirs = rows[0]?.id ?? '';
      await pool.query(
        `INSERT INTO prediction_version (prediction_id, version_number, outcome, confidence)
         VALUES ($1, 1, 'home', 4)`,
        [theirs],
      );

      // Somebody's prediction history may be private (T-056), and a card must
      // not be the way around it.
      const borrowed = await post(
        `/me/conversations/${room}/messages`,
        { card: { kind: 'prediction', id: theirs } },
        ada,
      );
      expect(borrowed.statusCode).toBe(400);
      expect(borrowed.json().fields.card).toMatch(/your own/i);

      const own = await post(
        `/me/conversations/${room}/messages`,
        { body: 'my call', card: { kind: 'prediction', id: theirs } },
        bo,
      );
      expect(own.json().message.card).toMatchObject({
        kind: 'prediction',
        outcome: 'home',
        by: bo,
      });
    });

    it('drops the card when the message is removed', async () => {
      const sent = await post(
        `/me/conversations/${room}/messages`,
        { body: 'look at this', card: { kind: 'team', id: ESTEGHLAL } },
        ada,
      );
      const id = sent.json().message.id;

      expect((await del(`/me/conversations/${room}/messages/${id}`, ada)).statusCode).toBe(204);

      const page = (await get(`/me/conversations/${room}`, ada)).json();
      const tombstone = page.messages.find((m: { id: string }) => m.id === id);
      // A removed message keeping its card would leave a fragment of what was
      // said surviving the decision to take it down.
      expect(tombstone).toMatchObject({ body: null, card: null, removed: { by: 'author' } });
    });
  });

  describe('reactions, mentions and pins', () => {
    let subject = '';

    beforeAll(async () => {
      const sent = await post(
        `/me/conversations/${room}/messages`,
        { body: `good call @${bo}, and @nobody_${RUN} was wrong` },
        ada,
      );
      subject = sent.json().message.id;
    });

    it('names only the people already in the conversation', async () => {
      const page = (await get(`/me/conversations/${room}`, ada)).json();
      const mentioned = page.messages.find((m: { id: string }) => m.id === subject);

      // Mentioning somebody who is not in the room would be a way to put a
      // notification in front of a stranger: the direct-message spam surface
      // arriving through a side door.
      expect(mentioned.mentions).toEqual([bo]);
    });

    it('counts a reaction once per member, and says whether it is yours', async () => {
      expect(
        (await put(`/me/conversations/${room}/messages/${subject}/reactions/agree`, bo)).statusCode,
      ).toBe(204);
      // Reacting twice is reacting once.
      expect(
        (await put(`/me/conversations/${room}/messages/${subject}/reactions/agree`, bo)).statusCode,
      ).toBe(204);

      const mine = (await get(`/me/conversations/${room}`, bo)).json();
      const seen = mine.messages.find((m: { id: string }) => m.id === subject);
      expect(seen.reactions).toEqual([{ reaction: 'agree', count: 1, mine: true }]);

      const theirs = (await get(`/me/conversations/${room}`, ada)).json();
      expect(theirs.messages.find((m: { id: string }) => m.id === subject).reactions[0].mine).toBe(
        false,
      );

      expect(
        (await del(`/me/conversations/${room}/messages/${subject}/reactions/agree`, bo)).statusCode,
      ).toBe(204);
      const after = (await get(`/me/conversations/${room}`, bo)).json();
      expect(after.messages.find((m: { id: string }) => m.id === subject).reactions).toEqual([]);
    });

    it('refuses a reaction outside the closed set, and from outside the conversation', async () => {
      // An open emoji field is a small free-text box attached to somebody
      // else's words, which is where abuse goes once the big one is moderated.
      expect(
        (await put(`/me/conversations/${room}/messages/${subject}/reactions/shrug`, bo)).statusCode,
      ).toBe(400);
      expect(
        (await put(`/me/conversations/${room}/messages/${subject}/reactions/agree`, stranger))
          .statusCode,
      ).toBe(404);
    });

    it('pins a message and sends it back whatever page is being read', async () => {
      expect(
        (await post(`/me/conversations/${room}/messages/${subject}/pin`, null, bo)).statusCode,
      ).toBe(204);

      const page = (await get(`/me/conversations/${room}`, ada)).json();
      expect(page.pinned.map((m: { id: string }) => m.id)).toEqual([subject]);
      expect(page.messages.find((m: { id: string }) => m.id === subject).pinned).toBe(true);

      // Read a page that does not contain it: a pin nobody can find once the
      // conversation has scrolled past it is not a pin.
      const earlier = (await get(`/me/conversations/${room}?before=2`, ada)).json();
      expect(earlier.messages.some((m: { id: string }) => m.id === subject)).toBe(false);
      expect(earlier.pinned.map((m: { id: string }) => m.id)).toEqual([subject]);

      expect((await del(`/me/conversations/${room}/messages/${subject}/pin`, bo)).statusCode).toBe(
        204,
      );
      expect((await get(`/me/conversations/${room}`, ada)).json().pinned).toEqual([]);
    });

    it('leaves no applauded outline when a message is removed', async () => {
      const sent = await post(
        `/me/conversations/${room}/messages`,
        { body: 'regrettable, and popular' },
        ada,
      );
      const id = sent.json().message.id;
      await put(`/me/conversations/${room}/messages/${id}/reactions/laugh`, bo);
      await post(`/me/conversations/${room}/messages/${id}/pin`, null, bo);

      expect((await del(`/me/conversations/${room}/messages/${id}`, ada)).statusCode).toBe(204);

      const page = (await get(`/me/conversations/${room}`, bo)).json();
      const tombstone = page.messages.find((m: { id: string }) => m.id === id);
      expect(tombstone).toMatchObject({ body: null, reactions: [], pinned: false });
      expect(page.pinned).toEqual([]);

      // And nothing can be added to it afterwards.
      expect(
        (await put(`/me/conversations/${room}/messages/${id}/reactions/laugh`, bo)).statusCode,
      ).toBe(409);
    });
  });

  describe('searching inside a conversation', () => {
    it('finds what was said, newest first, and says where each hit is', async () => {
      await post(`/me/conversations/${room}/messages`, { body: 'the penalty was soft' }, ada);
      await post(`/me/conversations/${room}/messages`, { body: 'a clear penalty' }, bo);

      const found = (await get(`/me/conversations/${room}/search?q=penalty`, ada)).json();

      expect(found.term).toBe('penalty');
      expect(found.messages.map((m: { body: string }) => m.body)).toEqual([
        'a clear penalty',
        'the penalty was soft',
      ]);
      // Each hit carries its sequence, so opening it is `?before=seq+1` on the
      // page endpoint: the same sequence the whole surface is built on.
      expect(found.messages[0].seq).toBeGreaterThan(found.messages[1].seq);
      expect(found.more).toBe(false);
    });

    it('folds case and accents the way the rest of the product does', async () => {
      await post(`/me/conversations/${room}/messages`, { body: 'Kylian Mbappe scored' }, ada);

      // `search_key` (T-038, T-152) rather than a language-specific text-search
      // configuration: stemming needs a language, and picking one would search
      // well in English and badly in seven other languages, silently.
      const found = (await get(`/me/conversations/${room}/search?q=MBAPPE`, bo)).json();
      expect(found.messages.some((m: { body: string }) => m.body.includes('Mbappe'))).toBe(true);
    });

    it('does not return a removed message, and refuses a one-letter term', async () => {
      const sent = await post(`/me/conversations/${room}/messages`, { body: 'unrepeatable' }, ada);
      await del(`/me/conversations/${room}/messages/${sent.json().message.id}`, ada);

      const gone = (await get(`/me/conversations/${room}/search?q=unrepeatable`, ada)).json();
      // A tombstone has no body to find, and returning one would be a result
      // that says nothing.
      expect(gone.messages).toEqual([]);

      const tooShort = (await get(`/me/conversations/${room}/search?q=a`, ada)).json();
      expect(tooShort.messages).toEqual([]);
    });

    it('is closed to somebody who is not in the conversation', async () => {
      expect((await get(`/me/conversations/${room}/search?q=penalty`, stranger)).statusCode).toBe(
        404,
      );
    });
  });

  it('mutes and unmutes', async () => {
    expect((await post(`/me/conversations/${room}/mute`, null, bo)).statusCode).toBe(204);
    expect((await get('/me/conversations', bo)).json().conversations[0].muted).toBe(true);
    expect((await del(`/me/conversations/${room}/mute`, bo)).statusCode).toBe(204);
    expect((await get('/me/conversations', bo)).json().conversations[0].muted).toBe(false);
  });

  it('refuses a sanctioned member, and tells them where to appeal', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO moderation_decision (moderator_id, subject_type, subject_id, outcome, reason)
       VALUES ($1, 'member', $2, 'sanctioned', 'abuse in a direct conversation') RETURNING id`,
      [ids.get(moderator), ids.get(ada)],
    );
    await pool.query(
      `INSERT INTO sanction (user_id, decision_id, scope, starts_at, ends_at, permanent)
       VALUES ($1, $2, 'messaging', now() - interval '1 minute', now() + interval '1 day', false)`,
      [ids.get(ada), rows[0]?.id],
    );

    const refused = await post(`/me/conversations/${room}/messages`, { body: 'anything' }, ada);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/moderation restriction/i);
    expect(refused.json().message).toMatch(/appeal/i);

    // The restriction is on one member, not on the conversation.
    expect(
      (await post(`/me/conversations/${room}/messages`, { body: 'I can write' }, bo)).statusCode,
    ).toBe(201);

    await pool.query(
      `UPDATE sanction SET lifted_at = now(), lifted_by = $2, lift_reason = 'appeal upheld'
        WHERE user_id = $1`,
      [ids.get(ada), ids.get(moderator)],
    );
  });

  it('refuses a message across a block, from either side', async () => {
    expect((await post(`/me/blocks/${ada}`, null, bo)).statusCode).toBe(204);

    for (const who of [ada, bo]) {
      const refused = await post(`/me/conversations/${room}/messages`, { body: 'still here' }, who);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toMatch(/not available/i);
    }

    expect((await del(`/me/blocks/${ada}`, bo)).statusCode).toBe(204);
    // Unblocking makes contact possible again. It does not restore the
    // friendship the block ended — but the conversation is still there, which
    // is the point of a conversation being a place rather than a permission.
    expect(
      (await post(`/me/conversations/${room}/messages`, { body: 'back' }, ada)).statusCode,
    ).toBe(201);
  });

  it('lets anybody leave, and stops them writing afterwards', async () => {
    expect((await post(`/me/conversations/${room}/leave`, null, bo)).statusCode).toBe(204);

    const refused = await post(`/me/conversations/${room}/messages`, { body: 'one more' }, bo);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/left/i);

    // And they can still read it. Leaving a conversation is not losing what was
    // said in it.
    const page = (await get(`/me/conversations/${room}`, bo)).json();
    expect(page.conversation.left).toBe(true);
    expect(page.messages.length).toBeGreaterThan(0);
  });
});
