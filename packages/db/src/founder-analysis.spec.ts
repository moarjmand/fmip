import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * What the founder-analysis migration guarantees (T-130).
 *
 * The guarantees are the product decisions: an analysis is versioned rather than
 * edited, a version cannot be written once the match has started, and a
 * predicted score can never contradict the predicted outcome. Each of those is
 * enforced by the database because the database is the only place that cannot
 * be bypassed by a script, a skewed clock or a future endpoint.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const COUNTRY = '00000000-0000-4000-8000-000000000101';
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const FUTURE_FIXTURE = randomUUID();
const STARTED_FIXTURE = randomUUID();
const HOME = randomUUID();
const AWAY = randomUUID();
const AUTHOR = randomUUID();
const ANALYSIS = randomUUID();
const STARTED_ANALYSIS = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the founder analysis schema',
  () => {
    let db: Client;

    beforeAll(async () => {
      db = new Client({ connectionString: DATABASE_URL });
      await db.connect();

      await db.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, 'Founder Test League', 'league', 'domestic', 'men')`,
        [COMPETITION, COUNTRY],
      );
      await db.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2025/26', '2025-08-01', '2026-05-30', false)`,
        [SEASON, COMPETITION],
      );
      await db.query(
        `INSERT INTO team (id, name, kind, gender)
         VALUES ($1, 'Lambda', 'club', 'men'), ($2, 'Mu', 'club', 'men')`,
        [HOME, AWAY],
      );
      await db.query(
        `INSERT INTO user_account
           (id, username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, status)
         VALUES ($1, $2, 'The Founder', $3, $4, 'en', 'UTC', now(), 'active')`,
        [AUTHOR, `founder_${AUTHOR.slice(0, 8)}`, `founder-${AUTHOR}@example.test`, COUNTRY],
      );

      for (const [id, kickoff] of [
        [FUTURE_FIXTURE, '2099-01-01T12:00:00Z'],
        [STARTED_FIXTURE, '2020-01-01T12:00:00Z'],
      ] as const) {
        await db.query(
          `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
          [id, SEASON, kickoff],
        );
        await db.query(
          `INSERT INTO fixture_participant (fixture_id, team_id, side)
           VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
          [id, HOME, AWAY],
        );
      }

      await db.query(
        `INSERT INTO founder_analysis (id, fixture_id, author_id) VALUES ($1, $2, $3)`,
        [ANALYSIS, FUTURE_FIXTURE, AUTHOR],
      );
      await db.query(
        `INSERT INTO founder_analysis (id, fixture_id, author_id) VALUES ($1, $2, $3)`,
        [STARTED_ANALYSIS, STARTED_FIXTURE, AUTHOR],
      );
    });

    afterAll(async () => {
      if (db === undefined) return;
      await db.query(
        `ALTER TABLE founder_analysis_version DISABLE TRIGGER founder_analysis_version_immutable`,
      );
      await db.query(`DELETE FROM founder_analysis WHERE author_id = $1`, [AUTHOR]);
      await db.query(
        `ALTER TABLE founder_analysis_version ENABLE TRIGGER founder_analysis_version_immutable`,
      );
      await db.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [
        [FUTURE_FIXTURE, STARTED_FIXTURE],
      ]);
      await db.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await db.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await db.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, AWAY]]);
      await db.query(`DELETE FROM user_account WHERE id = $1`, [AUTHOR]);
      await db.end();
    });

    async function publish(
      analysisId: string,
      version: number,
      over: Record<string, unknown> = {},
    ): Promise<void> {
      const row = {
        predicted_outcome: 'home',
        predicted_home: 2,
        predicted_away: 1,
        confidence: 4,
        reasoning: 'They are better and at home.',
        ...over,
      };
      await db.query(
        `INSERT INTO founder_analysis_version
           (analysis_id, version_number, predicted_outcome, predicted_home, predicted_away,
            confidence, reasoning, lineup_impact, key_players, form_and_context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          analysisId,
          version,
          row.predicted_outcome,
          row.predicted_home,
          row.predicted_away,
          row.confidence,
          row.reasoning,
          (over.lineup_impact as string | null) ?? null,
          (over.key_players as string | null) ?? null,
          (over.form_and_context as string | null) ?? null,
        ],
      );
    }

    it('records an update as a new version, and keeps the previous one', async () => {
      await publish(ANALYSIS, 1);
      await publish(ANALYSIS, 2, { confidence: 2, reasoning: 'Their main striker is out.' });

      const { rows } = await db.query<{ version_number: number; confidence: number }>(
        `SELECT version_number, confidence FROM founder_analysis_version
          WHERE analysis_id = $1 ORDER BY version_number`,
        [ANALYSIS],
      );
      expect(rows.map((r) => [r.version_number, r.confidence])).toEqual([
        [1, 4],
        [2, 2],
      ]);
    });

    it('refuses to rewrite or delete a published version', async () => {
      await expect(
        db.query(`UPDATE founder_analysis_version SET confidence = 1 WHERE analysis_id = $1`, [
          ANALYSIS,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        db.query(`DELETE FROM founder_analysis_version WHERE analysis_id = $1`, [ANALYSIS]),
      ).rejects.toThrow(/immutable/);
    });

    it('refuses a version once the match has kicked off, by the database clock', async () => {
      // The point of the wall: an analysis edited after the result is known is
      // not an analysis, and a public record of calls is worth nothing if it can
      // be revised in hindsight.
      await expect(publish(STARTED_ANALYSIS, 1)).rejects.toThrow(/locked at kick-off/);
    });

    it('refuses a predicted score that contradicts the predicted outcome', async () => {
      // Two different calls in one row, and the page would have to choose which
      // to believe.
      await expect(
        publish(ANALYSIS, 3, { predicted_outcome: 'away', predicted_home: 2, predicted_away: 1 }),
      ).rejects.toThrow(/founder_version_score_matches_outcome/);
    });

    it('refuses half a score, an impossible confidence and empty prose', async () => {
      await expect(publish(ANALYSIS, 4, { predicted_away: null })).rejects.toThrow(
        /founder_version_score_complete/,
      );
      await expect(publish(ANALYSIS, 5, { confidence: 9 })).rejects.toThrow(
        /founder_version_confidence_range/,
      );
      await expect(publish(ANALYSIS, 6, { reasoning: '   ' })).rejects.toThrow(
        /founder_version_reasoning_not_blank/,
      );
      // An absent optional section is null; a blank one is a section that looks
      // written and says nothing (rule 3).
      await expect(publish(ANALYSIS, 7, { key_players: '  ' })).rejects.toThrow(
        /founder_version_optional_not_blank/,
      );
    });

    it('allows an outcome with no predicted score at all', async () => {
      // The blueprint makes the score optional; the outcome is the call.
      await expect(
        publish(ANALYSIS, 8, { predicted_home: null, predicted_away: null }),
      ).resolves.toBeUndefined();
    });

    it('keeps one analysis per fixture, so there is never a second opinion to choose between', async () => {
      await expect(
        db.query(`INSERT INTO founder_analysis (fixture_id, author_id) VALUES ($1, $2)`, [
          FUTURE_FIXTURE,
          AUTHOR,
        ]),
      ).rejects.toThrow(/founder_analysis_one_per_fixture/);
    });
  },
);
