import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { BriefingOutcome, BriefingResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import {
  type Completion,
  type CompletionRequest,
  type Intelligence,
  LANGUAGE_MODEL,
} from '../intelligence/intelligence.port';
import { BriefingsModule } from './briefings.module';
import { BriefingsService } from './briefings.service';

/**
 * Briefings through the API (T-430, T-431), with a scripted model: a member
 * who follows a team with a match in the window gets a document with that
 * match on its day; a briefing that names it is published; one that reads
 * more into the feed than it carries -- a paragraph about nobody, a number
 * from nowhere -- is a rejected version the page never shows; the reasons
 * for having none are sentences; and a guest has no briefing to ask for.
 * T-432: a published briefing is the inbox's notification, once per day
 * however many versions, held by quiet hours and carried through the
 * delivery port -- absent on both channels here -- exactly once.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const HOME = randomUUID();
const AWAY = randomUUID();
const MATCH = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('briefings', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const follower = `br_${RUN}f`;
  const nobody = `br_${RUN}n`;
  const sleeper = `br_${RUN}s`;
  const home = `Briefton ${RUN}`;
  const away = `Digestham ${RUN}`;
  let script: Completion = {
    text: '',
    model: 'scripted-1',
    stop: 'end_turn',
    input_tokens: 10,
    output_tokens: 5,
  };
  const asked: CompletionRequest[] = [];
  const scripted: Intelligence = {
    model: {
      provider: 'scripted',
      model: 'scripted-1',
      complete: async (request) => {
        asked.push(request);
        return script;
      },
    },
  };

  async function register(username: string): Promise<void> {
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
    ids.set(username, rows[0]!.id);
  }

  const as = (username: string) => ({ cookie: `fmip_session=${cookies.get(username) ?? ''}` });

  const current = async (username: string) => {
    const response = await app.inject({
      method: 'GET',
      url: '/me/briefing',
      headers: as(username),
    });
    return { status: response.statusCode, body: response.json<BriefingResponse>() };
  };

  const write = async (username: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/me/briefing',
      headers: as(username),
    });
    return { status: response.statusCode, body: response.json<BriefingOutcome>() };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, BriefingsModule],
    })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(LANGUAGE_MODEL)
      .useValue(scripted)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    await register(follower);
    await register(nobody);
    await register(sleeper);
    await pool.query(
      `INSERT INTO team (id, country_id, name, short_name, kind, gender)
       VALUES ($1, $3, $4, 'BRF', 'club', 'men'), ($2, $3, $5, 'DGH', 'club', 'men')`,
      [HOME, AWAY, ENGLAND, home, away],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday 25', now() + interval '12 hours', 'scheduled')`,
      [MATCH, PL_2025, REGULAR_SEASON],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [MATCH, HOME, AWAY],
    );
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id, favourite) VALUES ($1, 'team', $2, true), ($3, 'team', $2, true)`,
      [ids.get(follower), HOME, ids.get(sleeper)],
    );
    // Quiet from an hour ago to an hour from now, on the sleeper's own clock.
    await pool.query(
      `INSERT INTO quiet_hours (user_id, starts_at, ends_at)
       SELECT $1,
              ((now() AT TIME ZONE u.timezone) - interval '1 hour')::time,
              ((now() AT TIME ZONE u.timezone) + interval '1 hour')::time
         FROM user_account u WHERE u.id = $1`,
      [ids.get(sleeper)],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM member_briefing WHERE user_id = ANY($1::uuid[])`, [
        [ids.get(follower), ids.get(nobody), ids.get(sleeper)],
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [MATCH]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, AWAY]]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`br_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('documents the feed by day and says why there is no prose yet, and a guest has no briefing', async () => {
    const { status, body } = await current(follower);
    expect(status).toBe(200);
    expect(body.digest.days).toHaveLength(1);
    expect(body.digest.days[0]?.items.map((i) => i.kind)).toEqual(['fixture']);
    expect(body.prose).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    expect(body.reason).toBe('not_written');
    expect(body.versions).toBe(0);
    expect((await current(nobody)).body.reason).toBe('nothing_to_brief');
    expect((await write(nobody)).body).toEqual({ outcome: 'nothing_to_brief' });
    const guest = await app.inject({ method: 'GET', url: '/me/briefing' });
    expect(guest.statusCode).toBe(401);
  });

  it('publishes a briefing that stays inside the feed, with the document as the whole prompt', async () => {
    script = {
      ...script,
      text: `${home} play ${away} tomorrow, the one match around what you follow this week.`,
      stop: 'end_turn',
    };
    const outcome = await write(follower);
    expect(outcome.status).toBe(201);
    expect(outcome.body).toEqual({
      outcome: 'published',
      version_number: 1,
      rejection: null,
      notification: 'sent',
    });
    const request = asked[asked.length - 1]!;
    const document = JSON.parse(request.prompt) as { days: { items: { kind: string }[] }[] };
    expect(document.days[0]?.items[0]?.kind).toBe('fixture');
    expect(request.system).toContain('Every paragraph must be about items in the document');

    const shown = await current(follower);
    expect(shown.body.prose.coverage).toBe('available');
    expect(shown.body.prose.data).toMatchObject({
      text: `${home} play ${away} tomorrow, the one match around what you follow this week.`,
      model: 'scripted-1',
      prompt_version: 'briefing@1',
      version_number: 1,
    });
    expect(shown.body.reason).toBeNull();

    // T-432: the same notification the inbox has, opening this version, keyed
    // on the day the window starts, and carried once through the port, which
    // had nothing to carry it with.
    const { rows: told } = await pool.query<{
      id: string;
      subject_type: string;
      subject_id: string;
      dedupe_key: string;
    }>(
      `SELECT id, subject_type, subject_id, dedupe_key FROM notification
        WHERE user_id = $1 AND kind = 'briefing' AND deliver_after <= now()`,
      [ids.get(follower)],
    );
    expect(told).toHaveLength(1);
    const { rows: versions } = await pool.query<{ id: string }>(
      `SELECT id FROM member_briefing WHERE user_id = $1 AND version_number = 1`,
      [ids.get(follower)],
    );
    expect(told[0]).toMatchObject({
      subject_type: 'briefing',
      subject_id: versions[0]?.id,
      dedupe_key: shown.body.prose.data?.since.slice(0, 10),
    });
    const { rows: carried } = await pool.query(
      `SELECT email, push, carried_at FROM notification_delivery WHERE notification_id = $1`,
      [told[0]?.id],
    );
    expect(carried).toEqual([{ email: 'absent', push: 'absent', carried_at: expect.any(Date) }]);
  });

  it('rejects a paragraph that points at nothing in the feed and a number from nowhere, and keeps showing the published one', async () => {
    script = {
      ...script,
      text: `${home} play ${away} tomorrow.\n\nElsewhere, the title race tightened after a dramatic weekend.`,
      stop: 'end_turn',
    };
    const wandering = await write(follower);
    expect(wandering.body).toMatchObject({
      outcome: 'rejected',
      version_number: 2,
      rejection: expect.stringContaining('points at nothing in the feed'),
    });
    script = { ...script, text: `${home} have won 7 of their last games.`, stop: 'end_turn' };
    expect((await write(follower)).body).toMatchObject({
      outcome: 'rejected',
      version_number: 3,
      rejection: 'number not in the feed: 7',
    });
    script = { ...script, text: '', stop: 'refusal' };
    expect((await write(follower)).body).toMatchObject({
      outcome: 'rejected',
      version_number: 4,
      rejection: 'the model refused',
    });
    const shown = await current(follower);
    expect(shown.body.prose.data?.version_number).toBe(1);
    expect(shown.body.versions).toBe(4);
    await expect(
      pool.query(`UPDATE member_briefing SET text = 'edited' WHERE user_id = $1`, [
        ids.get(follower),
      ]),
    ).rejects.toThrow(/immutable/);
  });
  it('tells the member once for a day, however many versions are written', async () => {
    script = { ...script, text: `${home} play ${away} tomorrow.`, stop: 'end_turn' };
    const again = await write(follower);
    expect(again.body).toMatchObject({ outcome: 'published', notification: 'duplicate' });
    const { rows } = await pool.query<{ told: number; carried: number }>(
      `SELECT count(n.id)::int AS told, count(d.notification_id)::int AS carried
         FROM notification n LEFT JOIN notification_delivery d ON d.notification_id = n.id
        WHERE n.user_id = $1 AND n.kind = 'briefing'`,
      [ids.get(follower)],
    );
    expect(rows[0]).toEqual({ told: 1, carried: 1 });
  });

  it('keeps quiet hours: held now, carried once the hold ends, and its outcome written once', async () => {
    script = { ...script, text: `${home} play ${away} tomorrow.`, stop: 'end_turn' };
    expect((await write(sleeper)).body).toMatchObject({
      outcome: 'published',
      notification: 'delayed',
    });
    const { rows: held } = await pool.query<{
      id: string;
      deliver_after: Date;
      held_reason: string | null;
    }>(
      `SELECT id, deliver_after, held_reason FROM notification WHERE user_id = $1 AND kind = 'briefing'`,
      [ids.get(sleeper)],
    );
    expect(held).toHaveLength(1);
    const notification = held[0]!;
    expect(notification.deliver_after.getTime()).toBeGreaterThan(Date.now());
    expect(notification.held_reason).toBe('your quiet hours');
    const claimed = () =>
      pool.query<{ email: string | null; push: string | null }>(
        `SELECT email, push FROM notification_delivery WHERE notification_id = $1`,
        [notification.id],
      );

    const service = app.get(BriefingsService);
    await service.carry();
    expect((await claimed()).rows).toHaveLength(0);

    // The hold ends (moved by hand, as the clock would move it).
    await pool.query(`UPDATE notification SET deliver_after = created_at WHERE id = $1`, [
      notification.id,
    ]);
    expect((await service.carry()).carried).toBeGreaterThanOrEqual(1);
    expect((await claimed()).rows).toEqual([{ email: 'absent', push: 'absent' }]);
    await service.carry();
    expect((await claimed()).rows).toHaveLength(1);
    await expect(
      pool.query(`UPDATE notification_delivery SET email = 'sent' WHERE notification_id = $1`, [
        notification.id,
      ]),
    ).rejects.toThrow(/written once/);
  });
});
