import { Inject, Injectable } from '@nestjs/common';
import type { FavouriteIds, FollowedEntity, FollowedEntityType } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** Which catalog table backs each followable type. An allow-list; never from input. */
const ENTITY_TABLE: Record<FollowedEntityType, string> = {
  team: 'team',
  competition: 'competition',
  person: 'person',
};

interface FollowRow {
  entity_type: FollowedEntityType;
  entity_id: string;
  name: string;
  favourite: boolean;
  created_at: Date;
}

@Injectable()
export class PostgresFollowingStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async entityExists(type: FollowedEntityType, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM ${ENTITY_TABLE[type]} WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Everything the member follows, with the entity's current name joined per
   * type. A follow whose target has since vanished joins to nothing and is
   * left out rather than shown nameless.
   */
  async list(userId: string): Promise<FollowedEntity[]> {
    const { rows } = await this.pool.query<FollowRow>(
      `SELECT f.entity_type, f.entity_id, f.favourite, f.created_at,
              COALESCE(t.name, c.name, p.known_as, p.full_name) AS name
         FROM followed_entity f
         LEFT JOIN team t        ON f.entity_type = 'team'        AND t.id = f.entity_id
         LEFT JOIN competition c ON f.entity_type = 'competition' AND c.id = f.entity_id
         LEFT JOIN person p      ON f.entity_type = 'person'      AND p.id = f.entity_id
        WHERE f.user_id = $1
          AND COALESCE(t.id, c.id, p.id) IS NOT NULL
        ORDER BY f.favourite DESC, name, f.created_at`,
      [userId],
    );

    return rows.map((row) => ({
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      name: row.name,
      favourite: row.favourite,
      followed_at: row.created_at.toISOString(),
    }));
  }

  /** Follow if not already; set the favourite flag when asked. Idempotent. */
  async upsert(
    userId: string,
    type: FollowedEntityType,
    id: string,
    favourite: boolean | undefined,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id, favourite)
         VALUES ($1, $2, $3, COALESCE($4, false))
         ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE
           SET favourite = COALESCE($4, followed_entity.favourite)`,
      [userId, type, id, favourite ?? null],
    );
  }

  /** Returns whether a row was removed. */
  async remove(userId: string, type: FollowedEntityType, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM followed_entity WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3`,
      [userId, type, id],
    );
    return (rowCount ?? 0) > 0;
  }

  /** The id sets a personalised view sorts with. */
  async favouriteIds(userId: string): Promise<FavouriteIds> {
    const { rows } = await this.pool.query<{
      entity_type: FollowedEntityType;
      entity_id: string;
      favourite: boolean;
    }>(`SELECT entity_type, entity_id, favourite FROM followed_entity WHERE user_id = $1`, [
      userId,
    ]);

    const pick = (type: FollowedEntityType, onlyFavourites: boolean): string[] =>
      rows
        .filter((r) => r.entity_type === type && (!onlyFavourites || r.favourite))
        .map((r) => r.entity_id);

    return {
      team_ids: pick('team', true),
      competition_ids: pick('competition', true),
      person_ids: pick('person', true),
      followed_team_ids: pick('team', false),
      followed_competition_ids: pick('competition', false),
    };
  }

  async favouriteTeamNames(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ name: string }>(
      `SELECT t.name
         FROM followed_entity f JOIN team t ON t.id = f.entity_id
        WHERE f.user_id = $1 AND f.entity_type = 'team' AND f.favourite
        ORDER BY t.name`,
      [userId],
    );
    return rows.map((r) => r.name);
  }
}
