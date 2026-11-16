import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ModelProbabilities, SocialVerdictPayload } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CONSOLE_OPTIONS } from '../agents-console/agents-console.controller';
import { EvaluationService } from '../forecast/evaluation.service';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { PostgresEvaluationStore } from '../forecast/internal/evaluation-store';
import { PostgresForecastStore } from '../forecast/internal/forecast-store';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { NewsHeadlines } from '../news/news-headlines.service';
import type { SocialActor, SocialPostRecord } from './internal/social-post-store';
import { SocialPublishingModule } from './social-publishing.module';
import {
  SOCIAL_OPTIONS,
  SocialPublishingService,
  goalsOf,
  sitePercent,
} from './social-publishing.service';

/**
 * T-1838 against the real schema: the candidate job drafts the three kinds
 * from seeded fixtures, forecasts and evaluations, frozen as built; the gates,
 * the sensitive-topic check (headlines linked by UUID, a failed read), the
 * one-live-row rule, the slots, the automation run and level, and that every
 * change writes its `console_audit` row in its own transaction.
 *
 * The matches are on 2046-06-10 in a competition and season of this run's
 * own, and the job is run "at" 14:00 London that day. Claims take the
 * database's own day (the CHECK reads the claim's clock), so they use slots 3
 * to 5 only, leaving 1 and 2 to `social-post.schema.spec.ts`, which may run
 * beside this file. The automation tests use the `model_verdict` kind; the
 * schema spec uses `result`. Shared rows (`social_automation`,
 * `social_switch`, the console owner) are put back afterwards.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const MODEL = `sp-${RUN}@1.0.0`;
const NOW = new Date('2046-06-10T13:00:00Z'); // 14:00 London
const at = (hhmm: string): string => `2046-06-10T${hhmm}:00Z`;

describe('the card fields the job freezes', () => {
  it('gives percentages with one decimal totalling 100.0, as the site shows them', () => {
    expect(sitePercent({ home: 0.1774, draw: 0.2528, away: 0.5698 })).toEqual({
      home: 17.7,
      draw: 25.3,
      away: 57,
    });
    const p = sitePercent({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 });
    expect(Math.round((p.home + p.draw + p.away) * 10)).toBe(1000);
  });

  it('lists the goals only when the events supply every one, with its scorer', () => {
    const goal = (side: 'home' | 'away', player: string | null, minute: number, kind = 'goal') => ({
      kind: kind as 'goal',
      minute,
      added_time: null,
      side,
      player,
    });
    const card = (incidents: unknown[], score: { home: number; away: number }) =>
      ({ scores: { current: score }, incidents }) as unknown as Parameters<typeof goalsOf>[0];
    expect(
      goalsOf(
        card(
          [
            goal('home', 'A. One', 12),
            { ...goal('away', 'B. Two', 50), kind: 'own_goal' },
            { ...goal('home', 'C. Three', 90, 'penalty_goal'), added_time: 3 },
            { ...goal('home', 'D. Four', 120), in_shootout: true },
            { ...goal('away', 'E. Five', 30), kind: 'red_card' },
          ],
          { home: 2, away: 1 },
        ),
      ),
    ).toEqual([
      { side: 'home', player: 'A. One', minute: 12, added: null, kind: 'goal' },
      { side: 'away', player: 'B. Two', minute: 50, added: null, kind: 'own_goal' },
      { side: 'home', player: 'C. Three', minute: 90, added: 3, kind: 'penalty' },
    ]);
    // One goal missing, or one without its scorer: no list at all.
    expect(goalsOf(card([goal('home', 'A. One', 12)], { home: 2, away: 0 }))).toBeNull();
    expect(goalsOf(card([goal('home', null, 12)], { home: 1, away: 0 }))).toBeNull();
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'social posts: store, service and candidate job',
  () => {
    let moduleRef: TestingModule;
    let pool: Pool;
    let social: SocialPublishingService;
    let headlines: NewsHeadlines;
    let previousOwner: string | null = null;
    const competition = randomUUID();
    const season = randomUUID();
    const [ash, brook, calder, dun] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const f = {
      forecast: randomUUID(),
      noForecast: randomUUID(),
      finished: randomUUID(),
      late: randomUUID(),
      postponed: randomUUID(),
      sensitive: randomUUID(),
      byFixture: randomUUID(),
      unreadable: randomUUID(),
    };
    const fixtures = Object.values(f);
    const owner: SocialActor = { id: randomUUID(), name: `so_${RUN}` };
    const teammate: SocialActor = { id: randomUUID(), name: `st_${RUN}` };
    let source = '';
    const stories: string[] = [];
    let started = '';
    let automationBefore: Record<string, unknown>[] = [];
    let switchBefore: Record<string, unknown> = {};

    const posts = async (fixture: string): Promise<SocialPostRecord[]> => {
      const { rows } = await pool.query<SocialPostRecord>(
        `SELECT *, post_day::text AS post_day FROM social_post WHERE fixture_id = $1 ORDER BY created_at, network`,
        [fixture],
      );
      return rows;
    };
    const live = async (fixture: string, kind: string, network: string) =>
      (await posts(fixture)).find(
        (p) =>
          p.kind === kind &&
          p.network === network &&
          !['rejected', 'expired', 'superseded'].includes(p.state),
      )!;
    const audits = async (target: string) => {
      const { rows } = await pool.query<{
        actor_id: string | null;
        actor_name: string;
        action: string;
        reason: string;
        previous: Record<string, unknown> | null;
        next: Record<string, unknown> | null;
        created_at: Date;
      }>(
        `SELECT actor_id, actor_name, action, reason, previous, next, created_at
           FROM console_audit WHERE target_id = $1 ORDER BY created_at, id`,
        [target],
      );
      return rows;
    };
    const verdictRun = async (): Promise<{ level: string; clean_run: number }> =>
      (
        await pool.query<{ level: string; clean_run: number }>(
          `SELECT level, clean_run FROM social_automation WHERE kind = 'model_verdict'`,
        )
      ).rows[0]!;
    const setVerdictRun = (run: number) =>
      pool.query(`UPDATE social_automation SET clean_run = $1 WHERE kind = 'model_verdict'`, [run]);

    async function fixture(
      id: string,
      status: string,
      kickoff: string,
      updated: string,
      teams: [string, string],
      score: [number, number] | null,
    ): Promise<void> {
      await pool.query(
        `INSERT INTO fixture (id, season_id, round, kickoff_at, status, updated_at)
         VALUES ($1, $2, 'Social test', $3, $4, $5)`,
        [id, season, kickoff, status, updated],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, teams[0], teams[1]],
      );
      if (score !== null) {
        await pool.query(
          `INSERT INTO fixture_score (fixture_id, kind, home, away, updated_at)
           VALUES ($1, 'current', $2, $3, $4), ($1, 'full_time', $2, $3, $4)`,
          [id, score[0], score[1], updated],
        );
      }
    }

    async function forecast(
      id: string,
      kickoff: string,
      computed: string,
      p: ModelProbabilities,
      teams: [string, string] = [ash, brook],
    ): Promise<void> {
      await new PostgresForecastStore(pool).record({
        fixtureId: id,
        kind: 'early',
        role: 'published',
        modelId: MODEL,
        request: {
          fixture_id: id,
          home_team_id: teams[0],
          away_team_id: teams[1],
          division: 'E0',
          kickoff_at: kickoff,
        },
        computedAt: new Date(computed),
        available: {
          probabilities: p,
          expectedGoals: { home: 1.4, away: 1.1 },
          mostLikely: [{ home: 1, away: 0, probability: 0.12 }],
          leadingFactors: [],
          inputs: {
            model_version: MODEL,
            fit_date: '2046-06-01',
            matches_used: 100,
            elo_used: true,
            history_from: '2043-06-01',
            data_completeness: 'available',
          },
        },
        unavailable: null,
      });
    }

    async function headline(text: string, link: { type: string; id: string }): Promise<void> {
      const story = await pool.query<{ id: string }>(
        `INSERT INTO story DEFAULT VALUES RETURNING id`,
      );
      stories.push(story.rows[0]!.id);
      const article = await pool.query<{ id: string }>(
        `INSERT INTO article (source_id, story_id, external_id, url) VALUES ($1, $2, $3, $4) RETURNING id`,
        [source, story.rows[0]!.id, `${text}-${RUN}`, `https://scripted.test/${stories.length}`],
      );
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
         VALUES ($1, 'en', 1, $2, $3)`,
        [article.rows[0]!.id, text, at('03:00')],
      );
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, $2, $3)`,
        [article.rows[0]!.id, link.type, link.id],
      );
    }

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, SocialPublishingModule],
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
        .overrideProvider(CONSOLE_OPTIONS)
        .useValue({ secret: 'social-secret-'.repeat(3), cookieSecure: false })
        .overrideProvider(MODEL_CLIENT)
        .useValue(
          new ModelClient({
            baseUrl: 'http://model.test',
            fetchImpl: () => Promise.reject(new Error('unused')),
          }),
        )
        .overrideProvider(SOCIAL_OPTIONS)
        .useValue({ origin: 'https://stadiomind.test' })
        .compile();
      await moduleRef.init();
      social = moduleRef.get(SocialPublishingService);
      headlines = moduleRef.get(NewsHeadlines);
      pool = new Pool({ connectionString: DATABASE_URL });
      started = (await pool.query<{ now: string }>(`SELECT now()::text AS now`)).rows[0]!.now;
      automationBefore = (await pool.query(`SELECT * FROM social_automation`)).rows;
      switchBefore = (await pool.query(`SELECT * FROM social_switch`)).rows[0];

      await pool.query(
        `INSERT INTO console_user (id, username, display_name, password_hash) VALUES
         ($1, $3, 'Owner', 'h'), ($2, $4, 'Teammate', 'h')`,
        [owner.id, teammate.id, owner.name, teammate.name],
      );
      const before = await pool.query<{ id: string }>(`SELECT id FROM console_user WHERE owner`);
      previousOwner = before.rows[0]?.id ?? null;
      await pool.query(`UPDATE console_user SET owner = false WHERE owner`);
      await pool.query(`UPDATE console_user SET owner = true WHERE id = $1`, [owner.id]);

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, NULL, $2, 'league', 'international', 'men')`,
        [competition, `Social League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2045/46', DATE '2045-08-01', DATE '2046-07-31', false)`,
        [season, competition],
      );
      await pool.query(
        `INSERT INTO coverage_profile (season_id, module, state, provider, note)
         VALUES ($1, 'scores', 'available', 'api_football', 'social posts test')`,
        [season],
      );
      await pool.query(
        `INSERT INTO team (id, name, short_name, code, kind, gender) VALUES
         ($1, $5, 'Ashvale', NULL, 'club', 'men'), ($2, $6, 'Brookmoor', NULL, 'club', 'men'),
         ($3, $7, 'Calderford', NULL, 'club', 'men'), ($4, $8, 'Dunmere', NULL, 'club', 'men')`,
        [
          ash,
          brook,
          calder,
          dun,
          `Ashvale ${RUN}`,
          `Brookmoor ${RUN}`,
          `Calderford ${RUN}`,
          `Dunmere ${RUN}`,
        ],
      );

      const AB: [string, string] = [ash, brook];
      await fixture(f.forecast, 'scheduled', at('18:00'), at('12:00'), AB, null);
      await fixture(f.noForecast, 'scheduled', at('18:30'), at('12:00'), AB, null);
      await fixture(f.finished, 'finished', at('09:00'), at('11:30'), AB, [2, 1]);
      await fixture(f.late, 'finished', at('09:30'), at('11:30'), AB, [1, 0]);
      await fixture(f.postponed, 'postponed', at('15:00'), at('12:00'), AB, null);
      await fixture(f.sensitive, 'finished', at('08:00'), at('11:00'), [calder, dun], [0, 0]);
      await fixture(f.byFixture, 'finished', at('08:15'), at('11:00'), AB, [3, 1]);
      await fixture(f.unreadable, 'finished', at('08:30'), at('11:00'), AB, [3, 3]);

      const P = { home: 0.554, draw: 0.247, away: 0.199 };
      await forecast(f.forecast, at('18:00'), at('11:00'), { home: 0.4, draw: 0.3, away: 0.3 });
      await forecast(f.finished, at('09:00'), at('08:00'), P);
      await forecast(f.late, at('09:30'), at('08:00'), P);
      await forecast(f.postponed, at('15:00'), at('11:00'), P);
      await forecast(f.sensitive, at('08:00'), at('07:00'), P, [calder, dun]);
      const evaluations = new EvaluationService(new PostgresEvaluationStore(pool));
      await evaluations.evaluateFixture(f.finished);
      await evaluations.evaluateFixture(f.sensitive);

      const src = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
        [`Social ${RUN}`, `https://scripted.test/social-${RUN}.xml`],
      );
      source = src.rows[0]!.id;
      // A death linked to one team; an arrest linked to one match; a football idiom about another team.
      await headline(`Dunmere ${RUN} mourns former captain who dies aged 54`, {
        type: 'team',
        id: dun,
      });
      await headline(`Three arrested after crowd trouble`, { type: 'fixture', id: f.byFixture });
      await headline(`Ashvale ${RUN} crash out of the cup`, { type: 'team', id: ash });
    });

    afterAll(async () => {
      if (pool === undefined) return;
      const targets = await pool.query<{ id: string }>(
        `SELECT id::text FROM social_post WHERE fixture_id = ANY($1::uuid[])`,
        [fixtures],
      );
      await withTriggersOff(pool, async (c) => {
        // The job's lowerings of the verdict kind during this run have no actor id to find them by.
        await c.query(
          `DELETE FROM console_audit
            WHERE target_id = ANY($1::text[]) OR actor_id = ANY($2::uuid[])
               OR (target_type = 'social_automation' AND target_id = 'model_verdict'
                   AND actor_name = 'automation' AND created_at >= $3::timestamptz)`,
          [targets.rows.map((r) => r.id), [owner.id, teammate.id], started],
        );
        await c.query(`DELETE FROM social_post WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
        // The shared rows as they were before this file.
        for (const row of automationBefore) {
          await c.query(
            `UPDATE social_automation
                SET level = $2, clean_run = $3, level_changed_at = $4, level_changed_by = $5,
                    level_changed_by_name = $6, level_reason = $7
              WHERE kind = $1`,
            [
              row.kind,
              row.level,
              row.clean_run,
              row.level_changed_at,
              row.level_changed_by,
              row.level_changed_by_name,
              row.level_reason,
            ],
          );
        }
        await c.query(
          `UPDATE social_switch SET stopped = $1, changed_at = $2, changed_by = $3, changed_by_name = $4, reason = $5`,
          [
            switchBefore.stopped,
            switchBefore.changed_at,
            switchBefore.changed_by,
            switchBefore.changed_by_name,
            switchBefore.reason,
          ],
        );
        for (const id of fixtures) {
          await c.query(`DELETE FROM evaluation WHERE fixture_id = $1`, [id]);
          await c.query(`DELETE FROM forecast WHERE fixture_id = $1`, [id]);
          await c.query(`DELETE FROM input_snapshot WHERE fixture_id = $1`, [id]);
        }
        await c.query(`DELETE FROM model_version WHERE model_id = $1`, [MODEL]);
      });
      await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
      if (stories.length > 0) {
        await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
      }
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[ash, brook, calder, dun]]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [season]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
      await pool.query(`UPDATE console_user SET owner = false WHERE id = $1`, [owner.id]);
      if (previousOwner !== null) {
        await pool.query(`UPDATE console_user SET owner = true WHERE id = $1`, [previousOwner]);
      }
      await pool.query(`DELETE FROM console_user WHERE id = ANY($1::uuid[])`, [
        [owner.id, teammate.id],
      ]);
      await pool.end();
      await moduleRef.close();
    });

    it('drafts each kind from our own data, frozen as built, and nothing a gate refuses', async () => {
      const spy = vi.spyOn(headlines, 'recent');
      spy.mockImplementation(async (ids, since) => {
        if (ids.includes(f.unreadable)) throw new Error('news store down');
        return NewsHeadlines.prototype.recent.call(headlines, ids, since);
      });
      const report = await social.draftCandidates(NOW);
      spy.mockRestore();

      // The forecast: one post a network, the model named with its version, link only on X.
      const [fx, fi] = [
        await live(f.forecast, 'forecast_pre_match', 'x'),
        await live(f.forecast, 'forecast_pre_match', 'instagram'),
      ];
      const version = (
        await pool.query<{ id: string }>(`SELECT id FROM forecast WHERE fixture_id = $1`, [
          f.forecast,
        ])
      ).rows[0]!.id;
      expect(fx).toMatchObject({
        state: 'pending_approval',
        origin: 'template',
        template_version: 'forecast_pre_match@1',
        forecast_id: version,
        model_version: MODEL,
        sensitive: false,
      });
      expect(fx.payload).toMatchObject({
        kind: 'forecast_pre_match',
        model: { name: 'The Stadiomind model', version: MODEL, forecast_id: version },
        percent: { home: 40, draw: 30, away: 30 },
        round: 'Social test',
        home: { id: ash, name: `Ashvale ${RUN}`, short_name: 'Ashvale', code: null },
      });
      expect(fx.body).toContain(`https://stadiomind.test/en/match/${f.forecast}`);
      expect(fi.body).not.toContain('https://');
      expect(fx.gates).toMatchObject({ passed: true, failed: [] });
      expect(fx.inputs).toMatchObject({
        fixture: { status: 'scheduled', coverage: 'available' },
        forecast: { id: version, version: MODEL, status: 'available' },
      });
      // A forecast is valid until kick-off.
      expect(fx.expires_at.toISOString()).toBe(new Date(at('18:00')).toISOString());

      // The verdict: the stored evaluation's own `correct`, the 90-minute score it judged.
      const verdict = await live(f.finished, 'model_verdict', 'x');
      const evaluation = (
        await pool.query<{ forecast_id: string; correct: boolean }>(
          `SELECT forecast_id, correct FROM evaluation WHERE fixture_id = $1`,
          [f.finished],
        )
      ).rows[0]!;
      expect(verdict.forecast_id).toBe(evaluation.forecast_id);
      expect(verdict.payload as SocialVerdictPayload).toMatchObject({
        score: { home: 2, away: 1 },
        after_extra_time: false,
        called: 'home',
        called_percent: 55.4,
        percent: { home: 55.4, draw: 24.7, away: 19.9 },
        correct: evaluation.correct,
      });
      expect(verdict.body).toContain('Yes: it got this one right.');
      // The result: no forecast, no model.
      const result = await live(f.finished, 'result', 'instagram');
      expect(result).toMatchObject({
        forecast_id: null,
        model_version: null,
        template_version: 'result@1',
      });
      expect(result.body).toContain(`Full time: Ashvale ${RUN} 2–1 Brookmoor ${RUN}`);
      // No goal events were stored: no scorers rather than some (rule 3).
      expect(result.payload).toMatchObject({ half_time: null, goals: null });
      // Valid until 16:30 London the day after it was drafted.
      expect(result.expires_at.toISOString()).toBe('2046-06-11T15:30:00.000Z');

      // No forecast post without an available forecast; no verdict without a stored evaluation;
      // nothing for a postponed match.
      expect(await posts(f.noForecast)).toEqual([]);
      expect((await posts(f.late)).map((p) => p.kind)).toEqual(['result', 'result']);
      expect(await posts(f.postponed)).toEqual([]);
      expect(report.skipped).toEqual(
        expect.arrayContaining([
          { fixture_id: f.noForecast, kind: 'forecast_pre_match', reason: 'gates:forecast_shown' },
          { fixture_id: f.late, kind: 'model_verdict', reason: 'gates:evaluation_stored' },
        ]),
      );

      // Sensitive: a headline linked to a team, one linked to the match, and an unreadable read.
      for (const p of await posts(f.sensitive)) {
        expect(p).toMatchObject({
          sensitive: true,
          sensitive_reason: 'death',
          state: 'pending_approval',
        });
      }
      for (const p of await posts(f.byFixture)) expect(p.sensitive_reason).toBe('violence');
      for (const p of await posts(f.unreadable)) {
        expect(p.sensitive_reason).toBe('headlines_unreadable');
      }
      // "crash out" is football, not an accident.
      expect((await posts(f.finished)).every((p) => !p.sensitive)).toBe(true);
      // Nothing was the job's to approve: every kind is at `approval`.
      expect(report.automatic).toBe(0);
      expect(report.drafted).toBe(2 + 4 + 2 + 4 + 2 + 2);
    });

    it('drafts once: a second run, and a second live row by hand, are refused', async () => {
      const again = await social.draftCandidates(NOW);
      expect(again.drafted).toBe(0);
      expect(again.existing).toBe(16);
      const standing = await live(f.finished, 'result', 'x');
      await expect(
        pool.query(
          `INSERT INTO social_post (fixture_id, kind, network, template_version, body, payload, inputs, gates, expires_at)
           SELECT fixture_id, kind, network, template_version, body, payload, inputs, gates, expires_at
             FROM social_post WHERE id = $1`,
          [standing.id],
        ),
      ).rejects.toThrow(/social_post_one_live/);
    });

    it('audits every change in its own transaction, and a refused change writes nothing', async () => {
      const post = await live(f.finished, 'result', 'x');
      // A rejection without a reason: refused, no audit row, the post unchanged.
      expect(await social.reject(post.id, teammate, '  ')).toEqual({
        ok: false,
        refusal: 'reason_required',
      });
      expect(await audits(post.id)).toEqual([]);
      expect((await social.get(post.id))!.state).toBe('pending_approval');

      expect(await social.approve(post.id, teammate, NOW)).toEqual({ ok: true, value: null });
      const [approval] = await audits(post.id);
      expect(approval).toMatchObject({
        actor_id: teammate.id,
        actor_name: teammate.name,
        action: 'social.approve',
        previous: { state: 'pending_approval' },
        next: { state: 'approved' },
      });
      expect(approval!.reason).not.toBe('');
      // Approving twice: refused, and still one row.
      expect(await social.approve(post.id, owner, NOW)).toMatchObject({
        ok: false,
        refusal: 'not_waiting',
      });
      expect(await audits(post.id)).toHaveLength(1);

      // A gate that fails now names itself: the forecast match has not finished, so its
      // forecast post's gates are checked at a time after kick-off.
      const forecastPost = await live(f.forecast, 'forecast_pre_match', 'instagram');
      expect(await social.approve(forecastPost.id, owner, new Date(at('18:30')))).toMatchObject({
        ok: false,
        refusal: 'gates_failed',
        gates: ['fixture_status', 'freshness'],
      });
      expect(await audits(forecastPost.id)).toEqual([]);
    });

    it('takes a slot once: a race for one slot, a taken slot and a sixth slot are refused', async () => {
      const a = await live(f.finished, 'result', 'x'); // approved above
      const b = await live(f.byFixture, 'result', 'x');
      expect((await social.approve(b.id, owner, NOW)).ok).toBe(true);

      const raced = await Promise.all([social.claim(a.id, 3), social.claim(b.id, 3)]);
      expect(raced.filter((r) => r.ok)).toHaveLength(1);
      expect(raced.filter((r) => !r.ok)).toEqual([{ ok: false, refusal: 'slot_taken' }]);
      const loser = raced[0]!.ok ? b : a;
      const winner = raced[0]!.ok ? a : b;
      // The loser stays approved, with no audit row of a claim.
      expect((await social.get(loser.id))!.state).toBe('approved');
      expect((await audits(loser.id)).map((r) => r.action)).toEqual(['social.approve']);
      // The same post is never claimed twice.
      expect(await social.claim(winner.id, 4)).toEqual({ ok: false, refusal: 'not_claimable' });
      // A sixth slot does not exist.
      expect(await social.claim(loser.id, 6)).toEqual({ ok: false, refusal: 'no_such_slot' });
      const claimed = await social.get(winner.id);
      expect(claimed).toMatchObject({ state: 'publishing', slot: 3 });
      expect(claimed!.post_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((await audits(winner.id)).at(-1)).toMatchObject({
        actor_id: null,
        actor_name: 'automation',
        action: 'social.claim',
        previous: { state: 'approved' },
      });
      expect(
        (await social.finish(winner.id, { state: 'published', providerRef: `ref-${RUN}-1` })).ok,
      ).toBe(true);
    });

    it('counts clean posts to 14 (eligible, not automatic); an edit, a rejection or an error resets the run', async () => {
      const x = await live(f.finished, 'model_verdict', 'x');
      expect((await social.approve(x.id, owner, NOW)).ok).toBe(true);
      await setVerdictRun(13);
      expect((await social.claim(x.id, 4)).ok).toBe(true);
      expect(
        (await social.finish(x.id, { state: 'published', providerRef: `ref-${RUN}-2` })).ok,
      ).toBe(true);
      expect(await verdictRun()).toEqual({ level: 'approval', clean_run: 14 });
      expect((await social.automation()).find((a) => a.kind === 'model_verdict')).toMatchObject({
        level: 'approval',
        clean_run: 14,
        eligible: true,
      });

      // A rejection resets it.
      const sens = await live(f.sensitive, 'model_verdict', 'x');
      expect((await social.reject(sens.id, teammate, 'not today')).ok).toBe(true);
      expect((await verdictRun()).clean_run).toBe(0);

      // An edit resets it: the old row rejected ("edited: ..."), a new one waiting, naming the old.
      await setVerdictRun(5);
      const ig = await live(f.finished, 'model_verdict', 'instagram');
      const edited = await social.edit(
        ig.id,
        owner,
        { body: `${ig.body}\n(edited)`, payload: ig.payload },
        'wording',
      );
      expect(edited.ok).toBe(true);
      expect((await verdictRun()).clean_run).toBe(0);
      const old = (await social.get(ig.id))!;
      expect(old).toMatchObject({ state: 'rejected', decided_reason: 'edited: wording' });
      const fresh = (await social.get(edited.ok ? edited.value : ''))!;
      expect(fresh).toMatchObject({
        state: 'pending_approval',
        edited_from: ig.id,
        forecast_id: ig.forecast_id,
      });
      expect((await audits(ig.id)).map((r) => r.action)).toEqual(['social.edit']);

      // A publishing error resets it: refused gives the slot back.
      await setVerdictRun(5);
      expect((await social.approve(fresh.id, owner, NOW)).ok).toBe(true);
      expect((await social.claim(fresh.id, 5)).ok).toBe(true);
      expect((await social.finish(fresh.id, { state: 'refused', error: '400 rejected' })).ok).toBe(
        true,
      );
      expect((await verdictRun()).clean_run).toBe(0);
      expect(await social.get(fresh.id)).toMatchObject({
        state: 'refused',
        slot: null,
        post_day: null,
      });
    });

    it('lets only the owner change a level, raising from 14 with a reason of its own; a second owner is refused', async () => {
      await setVerdictRun(13);
      expect(await social.setLevel(teammate, 'model_verdict', 'automatic', 'go')).toEqual({
        ok: false,
        refusal: 'not_owner',
      });
      expect(await social.setLevel(owner, 'model_verdict', 'automatic', 'go')).toEqual({
        ok: false,
        refusal: 'not_eligible',
      });
      // The database refuses the same raise by itself.
      await expect(
        pool.query(
          `UPDATE social_automation SET level = 'automatic', level_changed_at = now(), level_changed_by = $1,
                  level_changed_by_name = 'x', level_reason = 'by hand' WHERE kind = 'model_verdict'`,
          [owner.id],
        ),
      ).rejects.toThrow(/14 clean posts/);
      await expect(
        pool.query(`UPDATE console_user SET owner = true WHERE id = $1`, [teammate.id]),
      ).rejects.toThrow(/console_user_one_owner/);
      expect((await audits('model_verdict')).filter((r) => r.actor_id === owner.id)).toEqual([]);

      await setVerdictRun(14);
      expect(
        (await social.setLevel(owner, 'model_verdict', 'automatic', 'fourteen clean')).ok,
      ).toBe(true);
      expect(await verdictRun()).toEqual({ level: 'automatic', clean_run: 14 });
      const [raise] = (await audits('model_verdict')).filter((r) => r.action === 'social.level');
      expect(raise).toMatchObject({
        actor_id: owner.id,
        reason: 'fourteen clean',
        previous: { level: 'approval', clean_run: 14 },
      });
    });

    it('refuses the job approving a sensitive, LLM or edited post by the CHECK', async () => {
      // The kind is automatic and publishing runs, so only the CHECK stands in the way.
      const sensitive = await posts(f.sensitive);
      const waiting = sensitive.find(
        (p) => p.kind === 'model_verdict' && p.state === 'pending_approval',
      )!;
      await expect(
        pool.query(
          `UPDATE social_post SET state = 'approved', approved_by_name = 'automation', approved_at = now() WHERE id = $1`,
          [waiting.id],
        ),
      ).rejects.toThrow(/social_post_automation_only_clean/);
      const edited = (await posts(f.finished)).find((p) => p.edited_from !== null)!;
      expect(edited.state).toBe('refused');
      await expect(
        pool.query(
          `UPDATE social_post SET state = 'pending_approval', approved_by = NULL, approved_by_name = NULL, approved_at = NULL WHERE id = $1`,
          [edited.id],
        ),
      ).resolves.toBeDefined();
      await expect(
        pool.query(
          `UPDATE social_post SET state = 'approved', approved_by_name = 'automation', approved_at = now() WHERE id = $1`,
          [edited.id],
        ),
      ).rejects.toThrow(/social_post_automation_only_clean/);
      // An LLM's text, for a match with no post yet (the postponed one has a forecast).
      await expect(
        pool.query(
          `INSERT INTO social_post (fixture_id, kind, network, state, origin, template_version, body, payload,
                                    inputs, gates, forecast_id, model_version, expires_at, approved_by_name, approved_at)
           SELECT $2, kind, 'x', 'approved', 'llm', template_version, body, payload, inputs, gates,
                  (SELECT id FROM forecast WHERE fixture_id = $2), model_version, expires_at, 'automation', now()
             FROM social_post WHERE id = $1`,
          [edited.id, f.postponed],
        ),
      ).rejects.toThrow(/social_post_automation_only_clean/);
    });

    it("lets the job approve an automatic kind's clean post; an error lowers the kind as automation, audited", async () => {
      // The late match's evaluation arrives: its verdict is now due, and the kind is automatic.
      await new EvaluationService(new PostgresEvaluationStore(pool)).evaluateFixture(f.late);
      const report = await social.draftCandidates(NOW);
      // Only the late verdicts: a rejected, edited or published post is not drafted again.
      expect(report).toMatchObject({ drafted: 2, automatic: 2 });
      const auto = await live(f.late, 'model_verdict', 'instagram');
      expect(auto).toMatchObject({
        state: 'approved',
        approved_by: null,
        approved_by_name: 'automation',
      });
      expect(await audits(auto.id)).toMatchObject([
        { actor_id: null, actor_name: 'automation', action: 'social.approve' },
      ]);

      // No answer from the network: `unknown`, the slot kept, the kind lowered by `automation`.
      expect((await social.claim(auto.id, 3)).ok).toBe(true);
      expect((await social.finish(auto.id, { state: 'unknown', error: 'timeout' })).ok).toBe(true);
      expect(await verdictRun()).toEqual({ level: 'approval', clean_run: 0 });
      const lowering = (await audits('model_verdict')).at(-1)!;
      expect(lowering).toMatchObject({
        actor_id: null,
        actor_name: 'automation',
        action: 'social.level',
        reason: 'publishing error',
        previous: { level: 'automatic', clean_run: 14 },
        next: { level: 'approval', clean_run: 0 },
      });
      // The job's other approved verdict goes back to a person.
      const other = await live(f.late, 'model_verdict', 'x');
      expect(other).toMatchObject({ state: 'pending_approval', approved_by_name: null });
      expect((await audits(other.id)).at(-1)).toMatchObject({ action: 'social.withdraw' });
      // A person settles the unknown post from Buffer; it stays not clean.
      expect(
        await social.settle(auto.id, teammate, { state: 'published', providerRef: '' }, 'seen'),
      ).toEqual({
        ok: false,
        refusal: 'reference_required',
      });
      expect(
        (
          await social.settle(
            auto.id,
            teammate,
            { state: 'published', providerRef: `ref-${RUN}-3` },
            'seen on Buffer',
          )
        ).ok,
      ).toBe(true);
      expect((await verdictRun()).clean_run).toBe(0);
    });

    it('the kill switch lowers an automatic kind keeping its run; nothing is claimed while stopped', async () => {
      await setVerdictRun(14);
      // A raise needs a reason of its own, not the last change's.
      const last = (
        await pool.query<{ level_reason: string }>(
          `SELECT level_reason FROM social_automation WHERE kind = 'model_verdict'`,
        )
      ).rows[0]!.level_reason;
      expect(await social.setLevel(owner, 'model_verdict', 'automatic', last)).toEqual({
        ok: false,
        refusal: 'reason_not_fresh',
      });
      expect((await social.setLevel(owner, 'model_verdict', 'automatic', 'again')).ok).toBe(true);

      expect(await social.setSwitch(teammate, true, '')).toEqual({
        ok: false,
        refusal: 'reason_required',
      });
      expect((await social.setSwitch(teammate, true, 'checking a complaint')).ok).toBe(true);
      expect(await verdictRun()).toEqual({ level: 'approval', clean_run: 14 });
      const switchAudit = (await audits('switch')).at(-1)!;
      expect(switchAudit).toMatchObject({
        actor_id: teammate.id,
        action: 'social.kill',
        reason: 'checking a complaint',
        previous: { stopped: false },
      });
      expect((await audits('model_verdict')).at(-1)).toMatchObject({
        actor_name: 'automation',
        reason: 'kill switch',
      });
      // While stopped: no claim, no raise.
      const waiting = await live(f.byFixture, 'result', 'instagram');
      expect((await social.approve(waiting.id, owner, NOW)).ok).toBe(true);
      expect(await social.claim(waiting.id, 4)).toEqual({ ok: false, refusal: 'stopped' });
      expect(await social.setLevel(owner, 'model_verdict', 'automatic', 'once more')).toEqual({
        ok: false,
        refusal: 'stopped',
      });
      // Either account resumes it, with a reason.
      expect((await social.setSwitch(owner, false, 'resolved')).ok).toBe(true);
      expect((await social.setSwitch(owner, false, 'resolved')).ok).toBe(false);
    });
  },
);
