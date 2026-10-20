import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { HighlightsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { HIGHLIGHT_FEED_CONFIG } from './highlight-feed.service';
import { HIGHLIGHTLY_FEED_SOURCE } from './internal/highlight-feed-store';
import { ViewingModule } from './viewing.module';

/**
 * `GET /highlights` against a real database (T-1434, D-226): the feed's clips
 * of this file's own competition, newest match first, each with its match
 * and publisher; a chosen territory gets what the match page's rule offers
 * there, a reader with none only the clips offered everywhere; a withdrawn
 * clip is never listed; the competition filter, the paging and the refusals.
 *
 * Every row here is this file's own; a parallel spec's clips may be listed
 * too, so the assertions read this competition's clips (`?competition=`).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the Highlights list', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const competition = randomUUID();
  const season = randomUUID();
  const teams = [randomUUID(), randomUUID()];
  // Newest first: everywhere, Germany and France only, everywhere but Iran, withdrawn.
  const fixtures = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const clips = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

  const list = async (query: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/highlights?competition=${competition}${query}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json<HighlightsResponse>();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, ViewingModule] })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(HIGHLIGHT_FEED_CONFIG)
      .useValue({ state: 'absent' })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(
      `INSERT INTO competition (id, name, kind, scope, gender)
       VALUES ($1, $2, 'league', 'international', 'men')`,
      [competition, `Clip League ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2026', '2026-01-01', '2026-12-31', true)`,
      [season, competition],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
      [teams[0], teams[1], `Clip Home ${RUN}`, `Clip Away ${RUN}`],
    );
    for (const [i, id] of fixtures.entries()) {
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
         VALUES ($1, $2, now() - make_interval(days => $3), 'finished')`,
        [id, season, i + 1],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, teams[0], teams[1]],
      );
    }
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES
         ($1, 'full_time', 2, 1), ($1, 'current', 2, 1),
         ($2, 'current', 1, 1), ($2, 'penalties', 4, 3)`,
      [fixtures[0], fixtures[2]],
    );
    const rules: [string[], string[]][] = [
      [[], []],
      [['DE', 'FR'], []],
      [[], ['IR']],
      [[], []],
    ];
    for (const [i, id] of clips.entries()) {
      const [allowed, blocked] = rules[i]!;
      await pool.query(
        `INSERT INTO highlight_feed (id, fixture_id, source_id, url, title, publisher,
                                     allowed_territories, blocked_territories)
         VALUES ($1, $2, $3, $4, 'Highlights', $5, $6, $7)`,
        [
          id,
          fixtures[i],
          HIGHLIGHTLY_FEED_SOURCE,
          `https://www.youtube.com/watch?v=${RUN}${i}`,
          i === 1 ? null : 'LaLiga',
          allowed,
          blocked,
        ],
      );
    }
    await pool.query(
      `UPDATE highlight_feed SET withdrawn_at = now(), withdrawn_reason = 'wrong match'
        WHERE id = $1`,
      [clips[3]],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [season]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.end();
    await app.close();
  });

  it('lists a chosen territory what the rule offers there, newest match first, with its match', async () => {
    const gb = await list('&territory=GB');
    expect(gb.territory).toMatchObject({ state: 'chosen', territory: { code: 'GB' } });
    expect(gb.offered).toBe('territory');
    expect(gb.items.map((c) => c.id)).toEqual([clips[0], clips[2]]);
    expect(gb.total).toBe(2);
    expect(gb.items[0]).toMatchObject({
      url: `https://www.youtube.com/watch?v=${RUN}0`,
      publisher: 'LaLiga',
      fixture: {
        id: fixtures[0],
        status: 'finished',
        competition: { id: competition, name: `Clip League ${RUN}` },
        home: { id: teams[0], name: `Clip Home ${RUN}` },
        away: { id: teams[1], name: `Clip Away ${RUN}` },
        score: { home: 2, away: 1 },
        penalties: null,
      },
    });
    // The shoot-out beside the score, never in it.
    expect(gb.items[1]?.fixture).toMatchObject({
      score: { home: 1, away: 1 },
      penalties: { home: 4, away: 3 },
    });
    expect(gb.last_updated_at).not.toBeNull();

    expect((await list('&territory=DE')).items.map((c) => c.id)).toEqual([
      clips[0],
      clips[1],
      clips[2],
    ]);
    expect((await list('&territory=ir')).items.map((c) => c.id)).toEqual([clips[0]]);
  });

  it('lists a reader with no territory only the clips offered everywhere', async () => {
    const none = await list('');
    expect(none.territory).toEqual({ state: 'not_chosen' });
    expect(none.offered).toBe('everywhere');
    expect(none.items.map((c) => c.id)).toEqual([clips[0]]);
  });

  it('never lists a withdrawn clip, and offers the competition in the filter', async () => {
    const de = await list('&territory=DE');
    expect(de.items.map((c) => c.id)).not.toContain(clips[3]);
    expect(de.competition).toBe(competition);
    expect(de.competitions).toContainEqual({
      id: competition,
      name: `Clip League ${RUN}`,
      short_name: null,
      count: 3,
    });
  });

  it('pages, and a page past the end is empty with the total kept', async () => {
    const response = await app.inject({ method: 'GET', url: '/highlights?territory=DE&page=500' });
    expect(response.statusCode).toBe(200);
    const past = response.json<HighlightsResponse>();
    expect(past.items).toEqual([]);
    expect(past.page).toBe(500);
    expect(past.page_size).toBe(20);
    expect(past.total).toBeGreaterThanOrEqual(3);
  });

  it('refuses a malformed competition, page or territory', async () => {
    for (const query of ['competition=nope', 'page=0', 'page=x', 'territory=ZZZ']) {
      const response = await app.inject({ method: 'GET', url: `/highlights?${query}` });
      expect(response.statusCode).toBe(400);
    }
  });
});
