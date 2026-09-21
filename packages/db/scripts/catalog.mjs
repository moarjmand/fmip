/**
 * The catalogue, as an operator sees it (T-029).
 *
 *     docker compose run --rm migrate node scripts/catalog.mjs --list
 *     docker compose run --rm migrate node scripts/catalog.mjs --adopt-teams --dry-run
 *
 * Why this exists. A deployment with a licence still writes nothing until the
 * competitions, seasons and teams it covers exist here as internal rows with a
 * mapping to the provider's ids. Nothing builds them: the seed writes a handful
 * for development, `src/modules/catalog/` only reads, and the resolver's queue
 * -- `unresolved_entity`, where every external id we could not place is parked
 * with the provider's own name -- had no reader at all. D-076 found that the
 * hard way: a paid key, a real twenty-team table, and not one row written.
 *
 * What it will not do. It never matches a club by its name (rule 1: a name is
 * never a key). An adoption always creates a new row and maps the external id
 * to it; when the provider is talking about a club you already hold, say so
 * yourself with `--map --to <id>`, and that judgement is recorded. It never
 * invents a country, a founding year or a badge: a team arrives with the one
 * thing the queue knows, its name, and the rest is filled in later by people
 * or by a provider that serves it.
 *
 * Every write is audited when `--by` names an administrator -- `audit_log`
 * needs an actor and a fresh deployment has none, exactly as in
 * `grant-role.mjs`, so without it the write still happens and the output says
 * no audit row could be written.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

/** Mirrors `unresolved_entity_provider_check`. */
export const PROVIDERS = ['api_football', 'football_data_org', 'highlightly'];
/** Mirrors `competition_kind_check` and `competition_scope_check`. */
export const COMPETITION_KINDS = ['league', 'cup', 'super_cup', 'qualifying', 'friendly'];
export const COMPETITION_SCOPES = ['domestic', 'continental', 'international'];
const SEASON_LABEL = /^\d{4}(\/\d{2,4})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const VERBS = ['list', 'adopt-teams', 'add-competition', 'add-season', 'map'];
const SWITCHES = [...VERBS, 'dry-run', 'current'];
const VALUED = [
  'type',
  'limit',
  'provider',
  'external-id',
  'name',
  'country',
  'kind',
  'scope',
  'competition',
  'label',
  'start',
  'end',
  'to',
  'by',
];

const USAGE = `Usage (one verb per call):
  --list [--type team|person|competition] [--limit N]
  --adopt-teams [--dry-run] [--by <address>]
  --add-competition --external-id <id> --name "<name>" --kind <${COMPETITION_KINDS.join('|')}>
                    --scope <${COMPETITION_SCOPES.join('|')}> [--country <ISO>] [--by <address>]
  --add-season --competition <external id> --label <2026/27> --start <YYYY-MM-DD>
               --end <YYYY-MM-DD> [--current] [--by <address>]
  --map --type <kind> --external-id <id> --to <internal uuid> [--by <address>]

  --provider defaults to api_football.`;

/**
 * The command in these arguments, or the reason there is none. Pure, so every
 * refusal is tested without a database.
 */
export function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) return { error: `Unexpected argument: ${arg}` };
    const name = arg.slice(2);
    if (!SWITCHES.includes(name) && !VALUED.includes(name)) {
      return { error: `Unknown option: --${name}` };
    }
    if (SWITCHES.includes(name)) {
      flags.set(name, true);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `--${name} needs a value.` };
    flags.set(name, value);
    i += 1;
  }

  const chosen = VERBS.filter((verb) => flags.get(verb) === true);
  if (chosen.length === 0) return { error: 'Name one verb.' };
  if (chosen.length > 1) return { error: `One verb at a time; got ${chosen.join(' and ')}.` };
  const verb = chosen[0];

  const provider = flags.get('provider') ?? 'api_football';
  if (!PROVIDERS.includes(provider)) {
    return { error: `--provider must be one of ${PROVIDERS.join(', ')}.` };
  }
  const by = flags.get('by');
  const text = (key) => (flags.get(key) ?? '').trim();

  if (verb === 'list') {
    const limit = Number(flags.get('limit') ?? '50');
    if (!Number.isInteger(limit) || limit <= 0) return { error: '--limit must be a whole number.' };
    return { command: 'list', provider, type: flags.get('type'), limit };
  }
  if (verb === 'adopt-teams') {
    return { command: 'adopt-teams', provider, by, dryRun: flags.get('dry-run') === true };
  }
  if (verb === 'add-competition') {
    const externalId = text('external-id');
    const name = text('name');
    const kind = text('kind');
    const scope = text('scope');
    if (externalId === '') return { error: '--external-id is required.' };
    if (name === '') return { error: '--name is required.' };
    if (!COMPETITION_KINDS.includes(kind)) {
      return { error: `--kind must be one of ${COMPETITION_KINDS.join(', ')}.` };
    }
    if (!COMPETITION_SCOPES.includes(scope)) {
      return { error: `--scope must be one of ${COMPETITION_SCOPES.join(', ')}.` };
    }
    const country = text('country');
    // `competition_domestic_has_country` says the same thing in the database;
    // saying it here names the flag instead of the constraint.
    if (scope === 'domestic' && country === '') {
      return { error: '--country is required for a domestic competition.' };
    }
    return { command: 'add-competition', provider, externalId, name, kind, scope, country, by };
  }
  if (verb === 'add-season') {
    const competition = text('competition');
    const label = text('label');
    const start = text('start');
    const end = text('end');
    if (competition === '') return { error: '--competition (the provider id) is required.' };
    if (!SEASON_LABEL.test(label)) return { error: '--label looks like 2026 or 2026/27.' };
    if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
      return { error: '--start and --end are dates, YYYY-MM-DD.' };
    }
    if (end < start) return { error: '--end is before --start.' };
    return {
      command: 'add-season',
      provider,
      competition,
      label,
      start,
      end,
      current: flags.get('current') === true,
      by,
    };
  }
  const type = text('type');
  const externalId = text('external-id');
  const to = text('to');
  if (type === '') return { error: '--type is required.' };
  if (externalId === '') return { error: '--external-id is required.' };
  if (to === '') return { error: '--to is required: the internal id to map onto.' };
  return { command: 'map', provider, type, externalId, to, by };
}

function connectionString() {
  const file = process.env.DATABASE_URL_FILE;
  if (file !== undefined && file !== '') return readFileSync(file, 'utf8').trim();
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error('DATABASE_URL is not set. Run this through `docker compose run --rm migrate`.');
  }
  return url;
}

/** An audit row when an administrator is named; nothing, and a word, when not. */
async function audit(client, by, action, targetType, targetId, next) {
  if (by === undefined) return false;
  const { rows } = await client.query(
    'SELECT id FROM user_account WHERE lower(email) = lower($1)',
    [by],
  );
  if (rows[0] === undefined) throw new Error(`No account with the e-mail ${by}.`);
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, $3, $4, 'catalogue built from the provider', NULL, $5)`,
    [rows[0].id, action, targetType, targetId, JSON.stringify(next)],
  );
  return true;
}

function sayIfUnaudited(audited, by) {
  if (by === undefined) {
    console.log('  (no --by, so no audit row: an audit record must name an actor.)');
  } else if (!audited) {
    console.log('  (nothing to audit.)');
  }
}

async function list(client, options) {
  const { rows } = await client.query(
    `SELECT entity_type, external_id, payload->>'name' AS name, seen_count, status
       FROM unresolved_entity
      WHERE provider = $1 AND status = 'pending' AND ($2::text IS NULL OR entity_type = $2)
      ORDER BY entity_type, seen_count DESC, external_id
      LIMIT $3`,
    [options.provider, options.type ?? null, options.limit],
  );
  if (rows.length === 0) {
    console.log('Nothing is waiting to be placed.');
    return 0;
  }
  console.log(`${rows.length} waiting (provider ${options.provider}):`);
  for (const row of rows) {
    console.log(
      `  ${row.entity_type.padEnd(11)} ${String(row.external_id).padStart(7)}  ` +
        `${(row.name ?? '(no name)').padEnd(28)} seen ${row.seen_count}`,
    );
  }
  console.log('\nAdopt the teams with --adopt-teams, or place one by hand with --map.');
  return 0;
}

async function adoptTeams(client, options) {
  const { rows } = await client.query(
    `SELECT id, external_id, payload->>'name' AS name
       FROM unresolved_entity
      WHERE provider = $1 AND status = 'pending' AND entity_type = 'team'
        AND payload->>'name' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM provider_mapping m
           WHERE m.provider = unresolved_entity.provider
             AND m.entity_type = 'team'
             AND m.external_id = unresolved_entity.external_id)
      ORDER BY external_id`,
    [options.provider],
  );
  if (rows.length === 0) {
    console.log('No team is waiting to be adopted.');
    return 0;
  }
  if (options.dryRun) {
    console.log(`${rows.length} team(s) would be created, one row each:`);
    for (const row of rows) console.log(`  ${String(row.external_id).padStart(7)}  ${row.name}`);
    console.log('\nRun again without --dry-run to write them.');
    return 0;
  }

  let audited = false;
  for (const row of rows) {
    await client.query('BEGIN');
    try {
      const created = await client.query(
        `INSERT INTO team (name, kind, gender, age_group, is_active)
         VALUES ($1, 'club', 'men', 'senior', true) RETURNING id`,
        [row.name],
      );
      const teamId = created.rows[0].id;
      await client.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ($1, 'team', $2, $3)`,
        [options.provider, row.external_id, teamId],
      );
      await client.query(
        `UPDATE unresolved_entity
            SET status = 'resolved', resolved_internal_id = $2, resolved_by = $3,
                resolved_at = now(), resolution_note = 'adopted into the catalogue'
          WHERE id = $1`,
        [row.id, teamId, options.by ?? 'catalog.mjs'],
      );
      audited =
        (await audit(client, options.by, 'catalog.team_added', 'team', teamId, {
          name: row.name,
          provider: options.provider,
          external_id: row.external_id,
        })) || audited;
      await client.query('COMMIT');
      console.log(`  + ${row.name} (${options.provider} ${row.external_id}) -> ${teamId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log(`${rows.length} team(s) adopted.`);
  sayIfUnaudited(audited, options.by);
  return 0;
}

async function addCompetition(client, options) {
  const existing = await client.query(
    `SELECT internal_id FROM provider_mapping
      WHERE provider = $1 AND entity_type = 'competition' AND external_id = $2`,
    [options.provider, options.externalId],
  );
  if (existing.rows[0] !== undefined) {
    console.log(`Already mapped to ${existing.rows[0].internal_id}. Nothing written.`);
    return 0;
  }
  let countryId = null;
  if (options.country !== '') {
    const country = await client.query(
      'SELECT id FROM country WHERE upper(code) = upper($1) OR upper(iso2) = upper($1)',
      [options.country],
    );
    if (country.rows[0] === undefined) {
      console.error(`No country with the code ${options.country}.`);
      return 1;
    }
    countryId = country.rows[0].id;
  }

  await client.query('BEGIN');
  try {
    const created = await client.query(
      `INSERT INTO competition (name, kind, scope, gender, age_group, country_id, is_active)
       VALUES ($1, $2, $3, 'men', 'senior', $4, true) RETURNING id`,
      [options.name, options.kind, options.scope, countryId],
    );
    const id = created.rows[0].id;
    await client.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ($1, 'competition', $2, $3)`,
      [options.provider, options.externalId, id],
    );
    const audited = await audit(
      client,
      options.by,
      'catalog.competition_added',
      'competition',
      id,
      {
        name: options.name,
        provider: options.provider,
        external_id: options.externalId,
      },
    );
    await client.query('COMMIT');
    console.log(`${options.name} -> ${id}, mapped to ${options.provider} ${options.externalId}.`);
    sayIfUnaudited(audited, options.by);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return 0;
}

async function addSeason(client, options) {
  const mapped = await client.query(
    `SELECT internal_id FROM provider_mapping
      WHERE provider = $1 AND entity_type = 'competition' AND external_id = $2`,
    [options.provider, options.competition],
  );
  if (mapped.rows[0] === undefined) {
    console.error(`No competition mapped to ${options.provider} ${options.competition}.`);
    console.error('Add it first with --add-competition.');
    return 1;
  }
  const competitionId = mapped.rows[0].internal_id;

  await client.query('BEGIN');
  try {
    // One current season per competition, or `pickSeason` has two answers.
    if (options.current) {
      await client.query(
        'UPDATE season SET is_current = false WHERE competition_id = $1 AND is_current',
        [competitionId],
      );
    }
    const created = await client.query(
      `INSERT INTO season (competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (competition_id, label) DO UPDATE
         SET is_current = EXCLUDED.is_current, start_date = EXCLUDED.start_date,
             end_date = EXCLUDED.end_date
       RETURNING id, (xmax = 0) AS inserted`,
      [competitionId, options.label, options.start, options.end, options.current],
    );
    const { id, inserted } = created.rows[0];
    const audited = await audit(client, options.by, 'catalog.season_added', 'season', id, {
      label: options.label,
      is_current: options.current,
    });
    await client.query('COMMIT');
    console.log(
      `${options.label} ${inserted ? 'created' : 'updated'} -> ${id}` +
        `${options.current ? ' (now the current season)' : ''}.`,
    );
    sayIfUnaudited(audited, options.by);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return 0;
}

async function map(client, options) {
  const existing = await client.query(
    `SELECT internal_id FROM provider_mapping
      WHERE provider = $1 AND entity_type = $2 AND external_id = $3`,
    [options.provider, options.type, options.externalId],
  );
  if (existing.rows[0] !== undefined) {
    console.log(`Already mapped to ${existing.rows[0].internal_id}. Nothing written.`);
    return 0;
  }
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ($1, $2, $3, $4)`,
      [options.provider, options.type, options.externalId, options.to],
    );
    await client.query(
      `UPDATE unresolved_entity
          SET status = 'resolved', resolved_internal_id = $4, resolved_by = $5,
              resolved_at = now(), resolution_note = 'placed by hand'
        WHERE provider = $1 AND entity_type = $2 AND external_id = $3 AND status = 'pending'`,
      [options.provider, options.type, options.externalId, options.to, options.by ?? 'catalog.mjs'],
    );
    const audited = await audit(client, options.by, 'catalog.mapped', options.type, options.to, {
      provider: options.provider,
      external_id: options.externalId,
    });
    await client.query('COMMIT');
    console.log(`${options.provider} ${options.type} ${options.externalId} -> ${options.to}.`);
    sayIfUnaudited(audited, options.by);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
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
    switch (parsed.command) {
      case 'list':
        return await list(client, parsed);
      case 'adopt-teams':
        return await adoptTeams(client, parsed);
      case 'add-competition':
        return await addCompetition(client, parsed);
      case 'add-season':
        return await addSeason(client, parsed);
      default:
        return await map(client, parsed);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('catalog.mjs')) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
