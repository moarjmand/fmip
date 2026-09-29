import { Inject, Injectable } from '@nestjs/common';
import type { DataExport } from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** The audit action of a copy of a member's data (T-846, D-158). */
export const DATA_EXPORT_ACTION = 'account.export';

/** How long one copy holds the next one back: a rolling day (D-158). */
export const DATA_EXPORT_WINDOW_SECONDS = 24 * 60 * 60;

export type DataExportResult =
  | { kind: 'exported'; data: DataExport }
  /** A copy was made less than a day ago; the next one is possible after this many seconds. */
  | { kind: 'too_soon'; retryAfterSeconds: number }
  /** No active account behind the id. */
  | { kind: 'unknown' };

/**
 * Everything the file holds, as one statement: one statement is one snapshot,
 * so the file is consistent without a stricter isolation level (a prediction
 * cannot appear without the version it was settled on).
 *
 * **Only the member's own rows and words (D-158).** Every subquery is keyed on
 * `$1` as the row's owner or author: `message.author_id`, never the
 * conversation, so the other side of a conversation is not in the file; no
 * column holding another member's name is selected anywhere; where a row
 * points at another member -- a friendship, a follow, a report -- it is by id.
 * A notification's `source_id` (who caused it) is left out as well.
 *
 * **Why this reads other boundaries' tables.** As with the deletion
 * (`account-deletion-store.ts`), the file is one answer about one account, and
 * the account's boundary owns the question; nothing here applies another
 * boundary's rules, it only copies the member's rows.
 */
const EXPORT_SQL = `
SELECT json_build_object(
  'format', 'fmip-data-export@1',
  'generated_at', now(),
  'account', (
    SELECT json_build_object(
      'id', u.id, 'username', u.username, 'display_name', u.display_name, 'email', u.email,
      'email_verified_at', u.email_verified_at, 'country_code', c.code,
      'preferred_language', u.preferred_language, 'timezone', u.timezone,
      'viewing_territory', u.viewing_territory, 'theme', u.theme, 'text_size', u.text_size,
      'contrast', u.contrast, 'motion', u.motion, 'accepted_rules_at', u.accepted_rules_at,
      'first_run_done_at', u.first_run_done_at, 'created_at', u.created_at,
      'roles', coalesce((SELECT json_agg(r.role ORDER BY r.role) FROM user_role r
                          WHERE r.user_id = u.id), '[]'::json))
      FROM user_account u JOIN country c ON c.id = u.country_id
     WHERE u.id = $1),
  'profile', (SELECT json_build_object('bio', p.bio, 'avatar_url', p.avatar_url)
                FROM profile p WHERE p.user_id = $1),
  'privacy', (SELECT json_build_object('profile_visibility', s.profile_visibility,
                                       'prediction_history_visibility', s.prediction_history_visibility)
                FROM privacy_setting s WHERE s.user_id = $1),
  'notification_settings', json_build_object(
    'kinds', coalesce((SELECT json_agg(json_build_object('kind', n.kind, 'in_product', n.in_product)
                                        ORDER BY n.kind)
                         FROM notification_preference n WHERE n.user_id = $1), '[]'::json),
    'quiet_hours', (SELECT json_build_object('starts_at', q.starts_at, 'ends_at', q.ends_at)
                      FROM quiet_hours q WHERE q.user_id = $1),
    'mutes', coalesce((SELECT json_agg(json_build_object('scope', m.scope, 'target', m.target,
                                                         'created_at', m.created_at)
                                        ORDER BY m.created_at, m.scope, m.target)
                         FROM notification_mute m WHERE m.user_id = $1), '[]'::json)),
  'follows', json_build_object(
    'entities', coalesce((SELECT json_agg(json_build_object(
                                   'entity_type', f.entity_type, 'entity_id', f.entity_id,
                                   'favourite', f.favourite, 'created_at', f.created_at)
                                   ORDER BY f.created_at, f.entity_type, f.entity_id)
                            FROM followed_entity f WHERE f.user_id = $1), '[]'::json),
    'members', coalesce((SELECT json_agg(json_build_object('member_id', mf.followed_id,
                                                           'created_at', mf.created_at)
                                         ORDER BY mf.created_at, mf.followed_id)
                           FROM member_follow mf WHERE mf.follower_id = $1), '[]'::json)),
  'friendships', coalesce((SELECT json_agg(json_build_object(
                                    'member_id', CASE WHEN fr.low_id = $1 THEN fr.high_id ELSE fr.low_id END,
                                    'created_at', fr.created_at) ORDER BY fr.created_at)
                             FROM friendship fr WHERE fr.low_id = $1 OR fr.high_id = $1), '[]'::json),
  'groups', coalesce((SELECT json_agg(json_build_object(
                               'group_id', g.id, 'slug', g.slug, 'name', g.name,
                               'role', gm.role, 'joined_at', gm.joined_at)
                               ORDER BY gm.joined_at, g.slug)
                        FROM group_member gm JOIN user_group g ON g.id = gm.group_id
                       WHERE gm.user_id = $1), '[]'::json),
  'predictions', coalesce((SELECT json_agg(json_build_object(
      'fixture_id', up.fixture_id, 'created_at', up.created_at,
      'versions', coalesce((SELECT json_agg(json_build_object(
          'version_number', v.version_number, 'outcome', v.outcome, 'home_goals', v.home_goals,
          'away_goals', v.away_goals, 'confidence', v.confidence, 'reason_tags', v.reason_tags,
          'explanation', v.explanation, 'submitted_at', v.submitted_at) ORDER BY v.version_number)
        FROM prediction_version v WHERE v.prediction_id = up.id), '[]'::json),
      'settlements', coalesce((SELECT json_agg(json_build_object(
          'version_number', sv.version_number, 'status', st.status, 'void_reason', st.void_reason,
          'actual_home', st.actual_home, 'actual_away', st.actual_away,
          'outcome_correct', st.outcome_correct, 'score_correct', st.score_correct,
          'settled_at', st.settled_at) ORDER BY st.settled_at, st.id)
        FROM settlement st JOIN prediction_version sv ON sv.id = st.version_id
       WHERE st.prediction_id = up.id), '[]'::json))
      ORDER BY up.created_at, up.fixture_id)
    FROM user_prediction up WHERE up.user_id = $1), '[]'::json),
  'rating_history', coalesce((SELECT json_agg(json_build_object(
      'formula_version', rs.formula_version, 'settled_count', rs.settled_count,
      'rating', rs.rating, 'provisional', rs.provisional, 'established', rs.established,
      'computed_at', rs.computed_at) ORDER BY rs.computed_at, rs.id)
    FROM rating_snapshot rs WHERE rs.user_id = $1), '[]'::json),
  'career_points', coalesce((SELECT json_agg(json_build_object(
      'reason', pt.reason, 'points', pt.points, 'rule_version', pt.rule_version,
      'awarded_at', pt.awarded_at) ORDER BY pt.awarded_at, pt.id)
    FROM points_transaction pt WHERE pt.user_id = $1), '[]'::json),
  'achievements', coalesce((SELECT json_agg(json_build_object(
      'kind', au.kind, 'earned_at', au.earned_at, 'rules_version', au.rules_version)
      ORDER BY au.earned_at, au.kind)
    FROM achievement_unlocked au WHERE au.user_id = $1), '[]'::json),
  'saved_stories', coalesce((SELECT json_agg(json_build_object(
      'story_id', sa.story_id, 'article_url', a.url, 'saved_at', sa.saved_at)
      ORDER BY sa.saved_at, sa.story_id)
    FROM saved_article sa LEFT JOIN article a ON a.id = sa.article_id
   WHERE sa.user_id = $1), '[]'::json),
  'messages', coalesce((SELECT json_agg(json_build_object(
      'conversation_id', msg.conversation_id, 'conversation_kind', cv.kind, 'seq', msg.seq,
      'body', msg.body, 'created_at', msg.created_at, 'removed_at', msg.removed_at,
      'removed_kind', msg.removed_kind) ORDER BY msg.created_at, msg.id)
    FROM message msg JOIN conversation cv ON cv.id = msg.conversation_id
   WHERE msg.author_id = $1), '[]'::json),
  'panel_posts', coalesce((SELECT json_agg(json_build_object(
      'fixture_id', pp.fixture_id, 'body', pp.body, 'created_at', pp.created_at,
      'removed_at', pp.removed_at, 'removed_kind', pp.removed_kind) ORDER BY pp.created_at, pp.id)
    FROM panel_post pp WHERE pp.author_id = $1), '[]'::json),
  'analyses', coalesce((SELECT json_agg(json_build_object(
      'fixture_id', ca.fixture_id, 'created_at', ca.created_at,
      'versions', coalesce((SELECT json_agg(json_build_object(
          'version_number', cv2.version_number, 'predicted_outcome', cv2.predicted_outcome,
          'predicted_home', cv2.predicted_home, 'predicted_away', cv2.predicted_away,
          'confidence', cv2.confidence, 'reasoning', cv2.reasoning,
          'lineup_impact', cv2.lineup_impact, 'key_players', cv2.key_players,
          'form_and_context', cv2.form_and_context, 'published_at', cv2.published_at)
          ORDER BY cv2.version_number)
        FROM community_analysis_version cv2 WHERE cv2.analysis_id = ca.id), '[]'::json),
      'draft', (SELECT json_build_object(
          'predicted_outcome', d.predicted_outcome, 'predicted_home', d.predicted_home,
          'predicted_away', d.predicted_away, 'confidence', d.confidence, 'reasoning', d.reasoning,
          'lineup_impact', d.lineup_impact, 'key_players', d.key_players,
          'form_and_context', d.form_and_context, 'updated_at', d.updated_at)
        FROM community_analysis_draft d WHERE d.analysis_id = ca.id))
      ORDER BY ca.created_at, ca.id)
    FROM community_analysis ca WHERE ca.author_id = $1), '[]'::json),
  'reports_filed', coalesce((SELECT json_agg(json_build_object(
      'subject_type', rp.subject_type, 'subject_id', rp.subject_id, 'reason', rp.reason,
      'detail', rp.detail, 'decided', rp.decision_id IS NOT NULL, 'created_at', rp.created_at)
      ORDER BY rp.created_at, rp.id)
    FROM report rp WHERE rp.reporter_id = $1), '[]'::json),
  'notifications', coalesce((SELECT json_agg(json_build_object(
      'kind', nt.kind, 'subject_type', nt.subject_type, 'subject_id', nt.subject_id,
      'created_at', nt.created_at, 'read_at', nt.read_at) ORDER BY nt.created_at, nt.id)
    FROM notification nt WHERE nt.user_id = $1 AND nt.deliver_after <= now()), '[]'::json)
) AS data`;

/**
 * A copy of a member's own data (T-846, D-158): one file, at most once per
 * rolling day, and an `audit_log` row that records the copy without its
 * content. The check, the file and the audit row are one transaction under a
 * per-member advisory lock, so two requests at once make one file, not two.
 */
@Injectable()
export class PostgresDataExportStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async export(userId: string, reason: string): Promise<DataExportResult> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.run(client, userId, reason);
      await client.query(result.kind === 'exported' ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async run(client: PoolClient, userId: string, reason: string): Promise<DataExportResult> {
    // Timestamps in the file are UTC, whatever the server's zone.
    await client.query(`SET LOCAL TIME ZONE 'UTC'`);
    // Read committed: each statement after the lock sees what a request that
    // held it before committed.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('account.export:' || $1::text))`, [
      userId,
    ]);

    const active = await client.query(
      `SELECT 1 FROM user_account WHERE id = $1 AND status = 'active'`,
      [userId],
    );
    if (active.rowCount === 0) return { kind: 'unknown' };

    const last = await client.query<{ wait: number }>(
      `SELECT ceil(extract(epoch FROM max(created_at) + make_interval(secs => $3) - now()))::int AS wait
         FROM audit_log
        WHERE action = $2 AND target_type = 'user_account' AND target_id = $1::text
          AND created_at > now() - make_interval(secs => $3)`,
      [userId, DATA_EXPORT_ACTION, DATA_EXPORT_WINDOW_SECONDS],
    );
    const wait = last.rows[0]?.wait;
    if (wait !== null && wait !== undefined) {
      return { kind: 'too_soon', retryAfterSeconds: Math.max(1, wait) };
    }

    const built = await client.query<{ data: DataExport }>(EXPORT_SQL, [userId]);
    const data = built.rows[0]!.data;

    // Rule 10: who, when and why -- and how much, never what (D-158).
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
       VALUES ($1, $2, 'user_account', $3, $4, NULL, $5::jsonb)`,
      [userId, DATA_EXPORT_ACTION, userId, reason, JSON.stringify(sizesOf(data))],
    );
    return { kind: 'exported', data };
  }
}

/** How many rows each list section of the file held: the audit row's `next`. */
export function sizesOf(data: DataExport): Record<string, number> {
  return {
    predictions: data.predictions.length,
    messages: data.messages.length,
    panel_posts: data.panel_posts.length,
    analyses: data.analyses.length,
    friendships: data.friendships.length,
    groups: data.groups.length,
    notifications: data.notifications.length,
    reports_filed: data.reports_filed.length,
  };
}
