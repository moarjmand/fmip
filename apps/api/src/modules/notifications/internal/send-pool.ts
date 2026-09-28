/**
 * How many messages the carrier sends at once (T-836).
 *
 * A push is an HTTPS request to the browser's push service, typically tens of
 * milliseconds, and the carrier used to wait for each before starting the
 * next: 7,000 kick-off pushes at 50 ms each were six minutes. Sixteen at a
 * time keeps a Saturday within the minute and stays well inside what one
 * process should hold open towards a handful of push services; each message
 * also takes a database connection for its claim and its record, and the
 * pool waits rather than fails when they are all in use.
 */
export const DEFAULT_SEND_CONCURRENCY = 16;
const MAX_SEND_CONCURRENCY = 256;

/**
 * `NOTIFICATION_SEND_CONCURRENCY`, or the default when unset. A value that
 * is not a whole number from 1 to 256 refuses to start: a typo that silently
 * became "one at a time" would be found on the first Saturday.
 */
export function sendConcurrencyFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.NOTIFICATION_SEND_CONCURRENCY ?? '').trim();
  if (raw === '') return DEFAULT_SEND_CONCURRENCY;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_SEND_CONCURRENCY) {
    throw new Error(
      `NOTIFICATION_SEND_CONCURRENCY=${raw} is not a whole number from 1 to ${String(MAX_SEND_CONCURRENCY)}`,
    );
  }
  return value;
}

/**
 * Runs the tasks with at most `limit` in flight, and returns their results in
 * the tasks' order. A task is expected not to throw (the carrier's catch and
 * log); if one does, the pool stops taking new tasks and rethrows after the
 * ones in flight have settled, so nothing is left running behind the caller.
 */
export async function inPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  const lane = async (): Promise<void> => {
    while (failure === null && next < tasks.length) {
      const index = next;
      next += 1;
      const task = tasks[index];
      if (task === undefined) continue;
      try {
        results[index] = await task();
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  const lanes = Math.max(1, Math.min(limit, tasks.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  if (failure !== null) throw (failure as { error: unknown }).error;
  return results;
}
