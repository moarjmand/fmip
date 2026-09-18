import { Inject, Injectable } from '@nestjs/common';
import type {
  PrivacySettings,
  PrivacyVisibility,
  PublicProfile,
  Territory,
  ViewingTerritory,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** One member's profile as the page needs it, with the owner's id and privacy. */
export interface ProfileRow {
  user_id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  country_id: string;
  created_at: Date;
  profile_visibility: PrivacyVisibility;
  prediction_history_visibility: PrivacyVisibility;
}

export function toPublicProfile(row: ProfileRow, favouriteTeams: string[]): PublicProfile {
  return {
    username: row.username,
    display_name: row.display_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    country_id: row.country_id,
    member_since: row.created_at.toISOString().slice(0, 10),
    favourite_teams: favouriteTeams,
  };
}

export function toPrivacy(row: ProfileRow): PrivacySettings {
  return {
    profile_visibility: row.profile_visibility,
    prediction_history_visibility: row.prediction_history_visibility,
  };
}

// LEFT JOINs with COALESCE: a member with no profile row has an empty
// profile, and one with no privacy row is public. The defaults live here, in
// one place, and match the column defaults in the migration.
const SELECT = `
  SELECT u.id AS user_id, u.username, u.display_name, u.country_id, u.created_at,
         p.bio, p.avatar_url,
         COALESCE(s.profile_visibility, 'public') AS profile_visibility,
         COALESCE(s.prediction_history_visibility, 'public') AS prediction_history_visibility
    FROM user_account u
    LEFT JOIN profile p ON p.user_id = u.id
    LEFT JOIN privacy_setting s ON s.user_id = u.id
   WHERE u.status = 'active'`;

@Injectable()
export class PostgresProfileStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByUsername(username: string): Promise<ProfileRow | null> {
    const { rows } = await this.pool.query<ProfileRow>(`${SELECT} AND u.username = $1`, [username]);
    return rows[0] ?? null;
  }

  async findByUserId(userId: string): Promise<ProfileRow | null> {
    const { rows } = await this.pool.query<ProfileRow>(`${SELECT} AND u.id = $1`, [userId]);
    return rows[0] ?? null;
  }

  /** Every territory a member may choose, by name. */
  async territories(): Promise<Territory[]> {
    const { rows } = await this.pool.query<Territory>(
      `SELECT code, name FROM territory ORDER BY name`,
    );
    return rows;
  }

  /**
   * The member's viewing territory (T-312). `not_chosen` is the answer until
   * they choose; nothing here reads `country_id` in its place.
   */
  async viewingTerritory(userId: string): Promise<ViewingTerritory> {
    const { rows } = await this.pool.query<Territory>(
      `SELECT t.code, t.name
         FROM user_account u
         JOIN territory t ON t.code = u.viewing_territory
        WHERE u.id = $1`,
      [userId],
    );
    const territory = rows[0];
    return territory === undefined ? { state: 'not_chosen' } : { state: 'chosen', territory };
  }

  /** Sets or clears the choice; `unknown` when the code is not a territory. */
  async setViewingTerritory(userId: string, code: string | null): Promise<'set' | 'unknown'> {
    try {
      await this.pool.query(`UPDATE user_account SET viewing_territory = $2 WHERE id = $1`, [
        userId,
        code,
      ]);
      return 'set';
    } catch (error: unknown) {
      // foreign_key_violation: the territory table is the list of what may be chosen.
      if ((error as { code?: string }).code === '23503') return 'unknown';
      throw error;
    }
  }

  /**
   * Creates or updates the profile row. `undefined` leaves a column alone,
   * `null` clears it: the two are different intents and the SQL keeps them so.
   */
  async upsertProfile(
    userId: string,
    patch: { bio?: string | null; avatarUrl?: string | null },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO profile (user_id, bio, avatar_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET bio        = CASE WHEN $4 THEN EXCLUDED.bio ELSE profile.bio END,
               avatar_url = CASE WHEN $5 THEN EXCLUDED.avatar_url ELSE profile.avatar_url END`,
      [
        userId,
        patch.bio ?? null,
        patch.avatarUrl ?? null,
        patch.bio !== undefined,
        patch.avatarUrl !== undefined,
      ],
    );
  }

  async upsertPrivacy(
    userId: string,
    patch: { profile?: PrivacyVisibility; predictionHistory?: PrivacyVisibility },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO privacy_setting (user_id, profile_visibility, prediction_history_visibility)
         VALUES ($1, COALESCE($2, 'public'), COALESCE($3, 'public'))
         ON CONFLICT (user_id) DO UPDATE
           SET profile_visibility = COALESCE($2, privacy_setting.profile_visibility),
               prediction_history_visibility = COALESCE($3, privacy_setting.prediction_history_visibility)`,
      [userId, patch.profile ?? null, patch.predictionHistory ?? null],
    );
  }
}
