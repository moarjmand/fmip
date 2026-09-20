/**
 * Grant, revoke and list the roles a member holds (T-076).
 *
 *     docker compose run --rm migrate node scripts/grant-role.mjs --list
 *     docker compose run --rm migrate node scripts/grant-role.mjs \
 *       --email you@your-domain --role admin --reason "first administrator"
 *
 * Why this exists. `user_role` is the only thing standing between a member and
 * the administration area, the editorial desk and the moderation queue, and
 * nothing in the product writes to it: the API reads roles and never grants
 * them, because a grant is a decision by a person and D-053 puts a person at
 * every exit. On a freshly migrated database that leaves nobody able to open
 * `/en/admin` at all -- not a policy, just a table with no rows -- and the only
 * way through was SQL typed by hand against production. This is that SQL, with
 * the parts that are easy to get wrong done for you.
 *
 * What it will not do: invent an account, accept a role the schema does not
 * allow, or take a blank reason. The database would refuse the last two on its
 * own (`user_role_role_check`, `user_role_reason_not_blank`); refusing them
 * here as well means the message says which flag was wrong.
 *
 * On the audit trail. Every grant records `granted_at`, `reason` and, when you
 * name one, `granted_by` -- and a matching `audit_log` row (rule 10). The first
 * grant on a new deployment can have neither: `audit_log.actor_id` is NOT NULL
 * and there is no actor yet. That grant is written with `granted_by` null and
 * says so in its output rather than inventing an actor to satisfy a column.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

/** Mirrors `user_role_role_check` (migrations `..._identity`, `..._editor-role`). */
export const ROLES = ['admin', 'founder', 'moderator', 'editor'];

const USAGE = `Usage:
  node scripts/grant-role.mjs --list
  node scripts/grant-role.mjs --email <address> --role <${ROLES.join('|')}> --reason "<why>" [--by <address>]
  node scripts/grant-role.mjs --email <address> --role <role> --revoke --reason "<why>" [--by <address>]

  --by is the administrator making the change. Leave it out only for the first
  grant on a new deployment, when there is nobody to name.`;

const OPTIONS = ['list', 'revoke', 'email', 'role', 'reason', 'by'];
const SWITCHES = ['list', 'revoke'];

/**
 * The command in these arguments, or the reason there is none.
 *
 * Separated from everything else so the refusals can be tested without a
 * database: they are the half an operator meets at three in the morning.
 */
export function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) return { error: `Unexpected argument: ${arg}` };
    const name = arg.slice(2);
    // The name is checked before the value, so a typo reads as a typo rather
    // than as an option that is merely missing something.
    if (!OPTIONS.includes(name)) return { error: `Unknown option: --${name}` };
    if (SWITCHES.includes(name)) {
      flags.set(name, true);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `--${name} needs a value.` };
    flags.set(name, value);
    i += 1;
  }

  if (flags.get('list') === true) {
    if (flags.size > 1) return { error: '--list takes no other options.' };
    return { command: 'list' };
  }

  const email = flags.get('email');
  const role = flags.get('role');
  const reason = (flags.get('reason') ?? '').trim();
  if (email === undefined) return { error: '--email is required.' };
  if (role === undefined) return { error: '--role is required.' };
  if (!ROLES.includes(role)) {
    return { error: `--role must be one of ${ROLES.join(', ')}; got "${role}".` };
  }
  if (reason === '') return { error: '--reason is required, and is recorded against the change.' };

  return {
    command: flags.get('revoke') === true ? 'revoke' : 'grant',
    email,
    role,
    reason,
    by: flags.get('by'),
  };
}

/**
 * `DATABASE_URL`, or the same value from `DATABASE_URL_FILE` for a deployment
 * that keeps it in a secret file rather than the environment.
 */
function connectionString() {
  const file = process.env.DATABASE_URL_FILE;
  if (file !== undefined && file !== '') return readFileSync(file, 'utf8').trim();
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error('DATABASE_URL is not set. Run this through `docker compose run --rm migrate`.');
  }
  return url;
}

/** One account, by e-mail, case-insensitively -- or null. */
async function accountByEmail(client, email) {
  const { rows } = await client.query(
    'SELECT id, username, email FROM user_account WHERE lower(email) = lower($1)',
    [email],
  );
  return rows[0] ?? null;
}

async function list(client) {
  const { rows } = await client.query(
    `SELECT u.username, u.email, r.role, r.granted_at, r.reason,
            g.username AS granted_by
       FROM user_role r
       JOIN user_account u ON u.id = r.user_id
       LEFT JOIN user_account g ON g.id = r.granted_by
      ORDER BY u.username, r.role`,
  );
  if (rows.length === 0) {
    console.log('No role has been granted on this deployment.');
    console.log('Nobody can open /en/admin until one is. See docs/09-deploy.md.');
    return 0;
  }
  console.log(`${rows.length} grant(s):`);
  for (const row of rows) {
    const by = row.granted_by === null ? 'nobody named (first grant)' : `@${row.granted_by}`;
    console.log(
      `  @${row.username} (${row.email}) - ${row.role}` +
        `\n      granted ${row.granted_at.toISOString()} by ${by}: ${row.reason}`,
    );
  }
  return 0;
}

async function change(client, command, options) {
  const account = await accountByEmail(client, options.email);
  if (account === null) {
    console.error(`No account with the e-mail ${options.email}.`);
    console.error('Register it on the site first; this tool never creates an account.');
    return 1;
  }

  let actor = null;
  if (options.by !== undefined) {
    actor = await accountByEmail(client, options.by);
    if (actor === null) {
      console.error(`No account with the e-mail ${options.by} to record as the granter.`);
      return 1;
    }
  }

  await client.query('BEGIN');
  try {
    const changed =
      command === 'grant'
        ? await client.query(
            `INSERT INTO user_role (user_id, role, granted_by, reason)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, role) DO NOTHING
             RETURNING role`,
            [account.id, options.role, actor?.id ?? null, options.reason],
          )
        : await client.query(
            'DELETE FROM user_role WHERE user_id = $1 AND role = $2 RETURNING role',
            [account.id, options.role],
          );

    if (changed.rowCount === 0) {
      await client.query('ROLLBACK');
      console.log(
        command === 'grant'
          ? `@${account.username} already holds ${options.role}. Nothing written.`
          : `@${account.username} does not hold ${options.role}. Nothing written.`,
      );
      return 0;
    }

    // Rule 10, as far as the schema allows: an audit row needs an actor, and
    // the first grant on a deployment has none.
    if (actor !== null) {
      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1, $2, 'user', $3, $4, $5, $6)`,
        [
          actor.id,
          command === 'grant' ? 'role.granted' : 'role.revoked',
          account.id,
          options.reason,
          command === 'grant' ? null : JSON.stringify({ role: options.role }),
          command === 'grant' ? JSON.stringify({ role: options.role }) : null,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  const verb = command === 'grant' ? 'now holds' : 'no longer holds';
  console.log(`@${account.username} (${account.email}) ${verb} ${options.role}.`);
  if (actor === null) {
    console.log(
      'No administrator was named with --by, so no audit record was written:' +
        '\n  an audit row must name an actor, and the first grant has none.' +
        '\n  The grant itself records its time and reason. Use --by from now on.',
    );
  }
  return 0;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error !== undefined) {
    console.error(parsed.error);
    console.error(`\n${USAGE}`);
    return 2;
  }

  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    return parsed.command === 'list'
      ? await list(client)
      : await change(client, parsed.command, parsed);
  } finally {
    await client.end();
  }
}

// Importable for the tests, runnable as a command.
if (process.argv[1] !== undefined && process.argv[1].endsWith('grant-role.mjs')) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
