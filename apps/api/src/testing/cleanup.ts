import type { Pool, PoolClient } from 'pg';

/**
 * Deleting the rows a cascade cannot reach, without turning a guard off for
 * everybody else.
 *
 * **The bug this exists to stop happening a third time.** Immutable tables are
 * guarded by `refuse_change()` triggers, so a spec's own rows cannot be deleted
 * with the trigger on. The obvious move is `ALTER TABLE ... DISABLE TRIGGER` —
 * and it is global. While it is off, a suite running in parallel that asserts
 * the same table is immutable **passes without testing anything**. That is not
 * hypothetical: it happened once to the moderation schema suite, and the note
 * in `moderation.http.spec.ts` is where it was found.
 *
 * `session_replication_role = 'replica'` does the same job scoped to one
 * session, so nothing outside this connection can tell it happened. It also
 * takes no lock, which `ALTER TABLE` does — an `ACCESS EXCLUSIVE` one, against
 * a table other suites are reading.
 *
 * **Accounts go outside this block, not inside it.** `replica` turns off
 * *foreign-key* triggers too, so a cascade does not run while it is set: delete
 * a `user_account` in here and its credentials, sessions and tokens are left
 * behind, to fail some later suite for a reason nobody can read. Use this only
 * for the rows a cascade cannot reach, and delete the accounts after it
 * returns.
 *
 * The setting is restored in a `finally`, because a connection goes back to the
 * pool carrying whatever session state it left with.
 *
 * @example
 * await withTriggersOff(pool, async (client) => {
 *   await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [ids]);
 * });
 * await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [ids]);
 */
export async function withTriggersOff(
  pool: Pool,
  work: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SET session_replication_role = 'replica'`);
    await work(client);
  } finally {
    await client.query(`SET session_replication_role = 'origin'`);
    client.release();
  }
}

/** The rows a rating recompute writes for a member; both hold the account with ON DELETE RESTRICT. */
const RECOMPUTE_WRITES = new Set([
  'points_transaction_user_id_fkey',
  'rating_snapshot_user_id_fkey',
]);

/**
 * Deletes accounts that have settled predictions, with the points lines and
 * rating snapshots a recompute wrote for them.
 *
 * **Why this is more than two deletes.** `POST /ratings/recompute` recomputes
 * every recently settled member, not only its caller's, so under a parallel
 * run another suite writes snapshots and points for *this* suite's members.
 * Deleting the spec's settlements first stops any new recompute picking them
 * up, but one already under way read those settlements earlier and writes its
 * rows after they are gone -- after this suite's own snapshot and points
 * deletes, too, and the account delete is then refused (23001). Such a
 * recompute writes at most once per member, so clearing both tables again and
 * repeating the account delete converges; anything else, or a refusal that
 * outlasts `attempts`, is a real failure and is thrown.
 *
 * Call it after the spec's settlements are deleted.
 */
export async function deleteRatedAccounts(
  pool: Pool,
  ids: readonly string[],
  attempts = 5,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM points_transaction WHERE user_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [ids]);
    });
    try {
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [ids]);
      return;
    } catch (error) {
      const { code, constraint } = error as { code?: string; constraint?: string };
      const recomputeRace =
        (code === '23001' || code === '23503') && RECOMPUTE_WRITES.has(constraint ?? '');
      if (!recomputeRace || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
