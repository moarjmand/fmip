import type { Pool, PoolClient } from 'pg';
import type { NormalisedTransfer, Provider } from '@fmip/ingestion';
import type { TransferAsk, TransfersDueAt, TransfersStore } from './transfers';

/** Each club in a fixture of a current season, with that season's latest kick-off. */
const CLUBS = `
  SELECT fp.team_id AS id, max(f.kickoff_at) AS last_kickoff
    FROM season se
    JOIN fixture f ON f.season_id = se.id
    JOIN fixture_participant fp ON fp.fixture_id = f.id
   WHERE se.is_current
   GROUP BY 1`;

/** Each player named in a line-up of a current season, with his latest such kick-off. */
const PLAYERS = `
  SELECT l.person_id AS id, max(f.kickoff_at) AS last_kickoff
    FROM season se
    JOIN fixture f ON f.season_id = se.id
    JOIN fixture_participant fp ON fp.fixture_id = f.id
    JOIN lineup l ON l.participant_id = fp.id
   WHERE se.is_current
   GROUP BY 1`;

/**
 * The `transfers` job's SQL (T-1440, D-231): who is owed an ask, the ask
 * records, and the write. The player and both clubs of a move are joined to
 * ours through `provider_mapping` only (rule 1); one we do not hold keeps the
 * provider's name and no id.
 */
export class TransferStore implements TransfersStore {
  constructor(private readonly pool: Pool) {}

  async due(
    provider: Provider,
    subject: TransferAsk['subject'],
    at: TransfersDueAt,
    maxFailures: number,
    limit: number,
  ): Promise<TransferAsk[]> {
    if (limit <= 0) return [];
    const [subjects, fetches, key, entity] =
      subject === 'team'
        ? [CLUBS, 'team_transfer_fetch', 'team_id', 'team']
        : [PLAYERS, 'person_transfer_fetch', 'person_id', 'person'];
    const { rows } = await this.pool.query<{ id: string; external_id: string }>(
      `WITH subjects AS (${subjects})
       SELECT s.id, m.external_id
         FROM subjects s
         CROSS JOIN LATERAL (
           SELECT min(pm.external_id) AS external_id FROM provider_mapping pm
            WHERE pm.internal_id = s.id AND pm.entity_type = '${entity}' AND pm.provider = $1) m
         LEFT JOIN ${fetches} tf ON tf.provider = $1 AND tf.${key} = s.id
        WHERE m.external_id IS NOT NULL
          AND (tf.${key} IS NULL
               OR (tf.failures = 0 AND tf.answered_at < $2)
               OR (tf.failures > 0 AND tf.failures < $4 AND tf.asked_at < $3))
        ORDER BY (tf.${key} IS NULL) DESC, tf.answered_at ASC NULLS FIRST,
                 s.last_kickoff DESC, s.id
        LIMIT $5`,
      [provider, at.answeredBeforeIso, at.retryBeforeIso, maxFailures, limit],
    );
    return rows.map((r) => ({ subject, id: r.id, externalId: r.external_id }));
  }

  async markAsked(provider: Provider, ask: TransferAsk): Promise<void> {
    const [table, key] =
      ask.subject === 'team'
        ? ['team_transfer_fetch', 'team_id']
        : ['person_transfer_fetch', 'person_id'];
    await this.pool.query(
      `INSERT INTO ${table} (provider, ${key}, failures) VALUES ($1, $2, 1)
       ON CONFLICT (provider, ${key}) DO UPDATE
         SET asked_at = now(), failures = ${table}.failures + 1`,
      [provider, ask.id],
    );
  }

  async save(
    provider: Provider,
    ask: TransferAsk,
    moves: NormalisedTransfer[],
    fetchedAt: string,
  ): Promise<number> {
    return this.inTransaction(async (client) => {
      const people = await internalIds(
        client,
        provider,
        'person',
        moves.map((m) => m.player.externalId),
      );
      const clubs = await internalIds(
        client,
        provider,
        'team',
        moves.flatMap((m) => [m.from?.externalId, m.to?.externalId]),
      );
      const club = (side: NormalisedTransfer['from']): string | null =>
        side?.externalId == null ? null : (clubs.get(side.externalId) ?? null);
      const subjectColumn = ask.subject === 'team' ? 'subject_team_id' : 'subject_person_id';
      await client.query(
        `DELETE FROM transfer_listing WHERE source = $1 AND ${subjectColumn} = $2`,
        [provider, ask.id],
      );
      if (moves.length > 0) {
        await client.query(
          `INSERT INTO transfer_listing
             (source, ${subjectColumn}, person_id, person_name, transfer_date, kind, fee,
              from_team_id, from_name, to_team_id, to_name, fetched_at)
           SELECT $1, $2, u.person_id, u.person_name, u.transfer_date, u.kind, u.fee,
                  u.from_team_id, u.from_name, u.to_team_id, u.to_name, $12
             FROM unnest($3::uuid[], $4::text[], $5::date[], $6::text[], $7::text[],
                         $8::uuid[], $9::text[], $10::uuid[], $11::text[])
               AS u (person_id, person_name, transfer_date, kind, fee,
                     from_team_id, from_name, to_team_id, to_name)`,
          [
            provider,
            ask.id,
            moves.map((m) => people.get(m.player.externalId) ?? null),
            moves.map((m) => m.player.name),
            moves.map((m) => m.date),
            moves.map((m) => m.kind),
            moves.map((m) => m.fee),
            moves.map((m) => club(m.from)),
            moves.map((m) => m.from?.name ?? null),
            moves.map((m) => club(m.to)),
            moves.map((m) => m.to?.name ?? null),
            fetchedAt,
          ],
        );
      }
      if (ask.subject === 'team') {
        const held = moves.filter((m) => people.has(m.player.externalId)).length;
        await client.query(
          `INSERT INTO team_transfer_fetch
             (provider, team_id, asked_at, failures, answered_at, moves, players_held)
           VALUES ($1, $2, now(), 0, now(), $3, $4)
           ON CONFLICT (provider, team_id) DO UPDATE
             SET asked_at = now(), failures = 0, answered_at = now(),
                 moves = EXCLUDED.moves, players_held = EXCLUDED.players_held`,
          [provider, ask.id, moves.length, held],
        );
      } else {
        await client.query(
          `INSERT INTO person_transfer_fetch
             (provider, person_id, asked_at, failures, answered_at, moves)
           VALUES ($1, $2, now(), 0, now(), $3)
           ON CONFLICT (provider, person_id) DO UPDATE
             SET asked_at = now(), failures = 0, answered_at = now(), moves = EXCLUDED.moves`,
          [provider, ask.id, moves.length],
        );
      }
      return moves.length;
    });
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
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

/** Our ids for the provider's, by `provider_mapping`; an id it does not know is absent. */
async function internalIds(
  client: PoolClient,
  provider: Provider,
  entityType: 'person' | 'team',
  externalIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(externalIds.filter((id): id is string => typeof id === 'string'))];
  if (wanted.length === 0) return new Map();
  const { rows } = await client.query<{ external_id: string; internal_id: string }>(
    `SELECT external_id, internal_id FROM provider_mapping
      WHERE provider = $1 AND entity_type = $2 AND external_id = ANY($3::text[])`,
    [provider, entityType, wanted],
  );
  return new Map(rows.map((r) => [r.external_id, r.internal_id]));
}
