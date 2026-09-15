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
