import { Inject, Injectable } from '@nestjs/common';
import type { AudienceFilter } from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * Campaign rows (T-332, D-075): every statement in one place. Audiences and
 * campaigns are immutable; a dispatch is claimed by its primary key before
 * any member is told; a send row per member says what the inbox did.
 */
export interface AudienceRow {
  id: string;
  name: string;
  filter: AudienceFilter;
  created_by: string | null;
  reason: string;
  created_at: Date;
}

export interface CampaignRow {
  id: string;
  audience_id: string;
  audience_name: string;
  title: string;
  body: string;
  path: string;
  created_by: string | null;
  reason: string;
  created_at: Date;
  started_by: string | null;
  started_at: Date | null;
  audience_size: number | null;
  dispatch_reason: string | null;
  finished_at: Date | null;
  reached: number | null;
  delayed: number | null;
  muted: number | null;
  duplicate: number | null;
  failed: number | null;
}

export type SendOutcome = 'sent' | 'delayed' | 'muted' | 'duplicate' | 'failed';

export interface Tally {
  reached: number;
  delayed: number;
  muted: number;
  duplicate: number;
  failed: number;
}

/** The filter as SQL parameters: null means "no condition". */
function parameters(filter: AudienceFilter): unknown[] {
  return [
    filter.country_id ?? null,
    filter.language ?? null,
    filter.verified_only === true,
    filter.joined_after ?? null,
    filter.follows?.type ?? null,
    filter.follows?.id ?? null,
  ];
}

/** Active members the filter reaches. Every condition present must hold. */
const MEMBERS_WHERE = `
       WHERE u.status = 'active'
         AND ($1::uuid IS NULL OR u.country_id = $1::uuid)
         AND ($2::text IS NULL OR u.preferred_language = $2::text)
         AND (NOT $3::boolean OR u.email_verified_at IS NOT NULL)
         AND ($4::timestamptz IS NULL OR u.created_at >= $4::timestamptz)
         AND ($5::text IS NULL OR EXISTS (
               SELECT 1 FROM followed_entity f
                WHERE f.user_id = u.id AND f.entity_type = $5::text AND f.entity_id = $6::uuid))`;

const CAMPAIGN_SELECT = `
  SELECT c.id, c.audience_id, a.name AS audience_name, c.title, c.body, c.path,
         creator.username AS created_by, c.reason, c.created_at,
         starter.username AS started_by, d.started_at, d.audience_size, d.reason AS dispatch_reason,
         r.finished_at, r.reached, r.delayed, r.muted, r.duplicate, r.failed
    FROM campaign c
    JOIN audience a ON a.id = c.audience_id
    LEFT JOIN user_account creator ON creator.id = c.created_by
    LEFT JOIN campaign_dispatch d ON d.campaign_id = c.id
    LEFT JOIN user_account starter ON starter.id = d.started_by
    LEFT JOIN campaign_dispatch_result r ON r.campaign_id = c.id`;

@Injectable()
export class PostgresCampaignStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async size(filter: AudienceFilter): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_account u ${MEMBERS_WHERE}`,
      parameters(filter),
    );
    return rows[0]?.n ?? 0;
  }

  async members(filter: AudienceFilter): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT u.id FROM user_account u ${MEMBERS_WHERE} ORDER BY u.created_at`,
      parameters(filter),
    );
    return rows.map((row) => row.id);
  }

  async audiences(): Promise<AudienceRow[]> {
    const { rows } = await this.pool.query<AudienceRow>(
      `SELECT a.id, a.name, a.filter, creator.username AS created_by, a.reason, a.created_at
         FROM audience a LEFT JOIN user_account creator ON creator.id = a.created_by
        ORDER BY a.created_at DESC`,
    );
    return rows;
  }

  async audience(id: string): Promise<AudienceRow | null> {
    const { rows } = await this.pool.query<AudienceRow>(
      `SELECT a.id, a.name, a.filter, creator.username AS created_by, a.reason, a.created_at
         FROM audience a LEFT JOIN user_account creator ON creator.id = a.created_by
        WHERE a.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async createAudience(input: {
    name: string;
    filter: AudienceFilter;
    actorId: string;
    reason: string;
  }): Promise<string> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO audience (name, filter, created_by, reason) VALUES ($1, $2::jsonb, $3, $4) RETURNING id`,
        [input.name, JSON.stringify(input.filter), input.actorId, input.reason],
      );
      const id = rows[0]!.id;
      await audit(client, input.actorId, 'audience.create', 'audience', id, input.reason, {
        name: input.name,
        filter: input.filter,
      });
      return id;
    });
  }

  async campaigns(): Promise<CampaignRow[]> {
    const { rows } = await this.pool.query<CampaignRow>(
      `${CAMPAIGN_SELECT} ORDER BY c.created_at DESC`,
    );
    return rows;
  }

  async campaign(id: string): Promise<CampaignRow | null> {
    const { rows } = await this.pool.query<CampaignRow>(`${CAMPAIGN_SELECT} WHERE c.id = $1`, [id]);
    return rows[0] ?? null;
  }

  async createCampaign(input: {
    audienceId: string;
    title: string;
    body: string;
    path: string;
    actorId: string;
    reason: string;
  }): Promise<string> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO campaign (audience_id, title, body, path, created_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.audienceId, input.title, input.body, input.path, input.actorId, input.reason],
      );
      const id = rows[0]!.id;
      await audit(client, input.actorId, 'campaign.create', 'campaign', id, input.reason, {
        audience_id: input.audienceId,
        title: input.title,
        path: input.path,
      });
      return id;
    });
  }

  /** The claim: one row per campaign by its key. `false` when another send got there first. */
  async claimDispatch(
    campaignId: string,
    actorId: string,
    reason: string,
    size: number,
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO campaign_dispatch (campaign_id, started_by, audience_size, reason)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [campaignId, actorId, size, reason],
    );
    return rowCount === 1;
  }

  async recordSend(campaignId: string, userId: string, outcome: SendOutcome): Promise<void> {
    await this.pool.query(
      `INSERT INTO campaign_send (campaign_id, user_id, outcome) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [campaignId, userId, outcome],
    );
  }

  async finishDispatch(
    campaignId: string,
    actorId: string,
    reason: string,
    tally: Tally,
  ): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        `INSERT INTO campaign_dispatch_result (campaign_id, reached, delayed, muted, duplicate, failed)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [campaignId, tally.reached, tally.delayed, tally.muted, tally.duplicate, tally.failed],
      );
      await audit(client, actorId, 'campaign.send', 'campaign', campaignId, reason, tally);
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Rule 10: actor, time, reason and what was done, on every administrative write. */
async function audit(
  client: PoolClient,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  reason: string,
  next: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, $3, $4, $5, NULL, $6::jsonb)`,
    [actorId, action, targetType, targetId, reason, JSON.stringify(next)],
  );
}
