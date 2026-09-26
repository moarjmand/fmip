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
 * What it will not do. It never matches a club, a person or a ground by its
 * name (rule 1: a name is never a key). An adoption always creates a new row and maps the external id
 * to it; when the provider is talking about a club you already hold, say so
 * yourself with `--map --to <id>`, and that judgement is recorded. It never
 * invents a country, a founding year or a badge: a team arrives with the one
 * thing the queue knows, its name, and the rest is filled in later by people
 * or by a provider that serves it. A country is the operator's to add, with
 * `--add-country` and the FIFA trigram: a domestic competition cannot exist
 * without one, and a deployment that has just been migrated holds none.
 *
 * Every write is audited when `--by` names an administrator -- `audit_log`
 * needs an actor and a fresh deployment has none, exactly as in
 * `grant-role.mjs`, so without it the write still happens and the output says
 * no audit row could be written.
 */

import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import pg from 'pg';

/** Mirrors `unresolved_entity_provider_check`. */
export const PROVIDERS = ['api_football', 'football_data_org', 'highlightly'];
/** Mirrors `competition_kind_check` and `competition_scope_check`. */
export const COMPETITION_KINDS = ['league', 'cup', 'super_cup', 'qualifying', 'friendly'];
export const COMPETITION_SCOPES = ['domestic', 'continental', 'international'];
const SEASON_LABEL = /^\d{4}(\/\d{2,4})?$/;
/** The bridge from the provider's clubs to the training data's names (D-080). */
const DEFAULT_ALIASES = new URL('./data/training-aliases.csv', import.meta.url);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const VERBS = [
  'list',
  'adopt-teams',
  'adopt-people',
  'adopt-venues',
  'add-country',
  'add-competition',
  'add-season',
  'map',
  'set-division',
  'alias-training',
];
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
  'code',
  'iso2',
  'division',
  'file',
];

const USAGE = `Usage (one verb per call):
  --list [--type team|person|competition] [--limit N]
  --adopt-teams [--dry-run] [--by <address>]
  --adopt-people [--dry-run] [--by <address>]
  --adopt-venues [--dry-run] [--by <address>]
  --add-country --code <FIFA trigram> --name "<name>" [--iso2 <XX>] [--by <address>]
  --add-competition --external-id <id> --name "<name>" --kind <${COMPETITION_KINDS.join('|')}>
                    --scope <${COMPETITION_SCOPES.join('|')}> [--country <ISO>] [--by <address>]
  --add-season --competition <external id> --label <2026/27> --start <YYYY-MM-DD>
               --end <YYYY-MM-DD> [--current] [--by <address>]
  --map --type <kind> --external-id <id> --to <internal uuid> [--by <address>]
  --set-division --competition <external id> --division <E0|SP1|...> [--by <address>]
  --alias-training [--file <csv>] [--by <address>]

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
  if (verb === 'set-division') {
    const competition = text('competition');
    const division = text('division').toUpperCase();
    if (competition === '') return { error: '--competition is required: the provider’s id.' };
    // `competition_football_data_division_format` says the same in the database.
    if (!/^[A-Z]{1,2}[0-9C]$/.test(division)) {
      return { error: '--division is a football-data.co.uk code: E0, SP1, D1, I1, F1.' };
    }
    return { command: 'set-division', provider, by, competition, division };
  }
  if (verb === 'alias-training') {
    return {
      command: 'alias-training',
      by,
      file: text('file') === '' ? DEFAULT_ALIASES : text('file'),
    };
  }
  if (verb === 'adopt-teams' || verb === 'adopt-people' || verb === 'adopt-venues') {
    return { command: verb, provider, by, dryRun: flags.get('dry-run') === true };
  }
  if (verb === 'add-country') {
    const code = text('code').toUpperCase();
    const name = text('name');
    const iso2 = text('iso2').toUpperCase();
    // `country_code_format` and `country_iso2_format` say the same in the
    // database; saying it here names the flag instead of the constraint.
    if (!/^[A-Z]{3}$/.test(code)) {
      return { error: '--code is the FIFA trigram, three letters: ENG, ESP, GER.' };
    }
    if (name === '') return { error: '--name is required.' };
    if (iso2 !== '' && !/^[A-Z]{2}$/.test(iso2)) {
      return {
        error: '--iso2 is two letters (ES, DE), or left out where none exists, as for England.',
      };
    }
    return { command: 'add-country', code, name, iso2, by };
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

/**
 * What an empty queue means, which is one of two opposite things.
 *
 * Nothing waiting reads like success: everything the provider mentioned has
 * been placed. On a deployment that has just been migrated it means the
 * reverse -- no competition exists, so the jobs ask for nothing, nothing comes
 * back, and nothing can ever be queued. `grant-role.mjs` says as much about an
 * empty `user_role` rather than printing a blank list; silence is not an
 * answer here either.
 */
export function emptyQueueNote(provider, mapped, withCurrentSeason) {
  if (mapped === 0) {
    return (
      `No competition is mapped to ${provider} here, so the jobs ask for nothing and this ` +
      'queue cannot fill. Create one, then give it the season you want:\n' +
      '  --add-competition --external-id <the provider’s id> --name "<name>" ' +
      '--kind league --scope domestic --country <ISO2>\n' +
      '  --add-season --competition <the same external id> --label 2026/27 ' +
      '--start <YYYY-MM-DD> --end <YYYY-MM-DD> --current'
    );
  }
  if (withCurrentSeason === 0) {
    return (
      `${mapped} competition(s) are mapped to ${provider} and none has a current season, so ` +
      'the jobs still ask for nothing:\n' +
      '  --add-season --competition <external id> --label 2026/27 ' +
      '--start <YYYY-MM-DD> --end <YYYY-MM-DD> --current'
    );
  }
  return (
    `${withCurrentSeason} of ${mapped} competition(s) mapped to ${provider} are in season and ` +
    'being polled, and everything seen so far has been placed.'
  );
}

/** Competitions this provider can be asked about, and how many are in season. */
async function pollableCounts(client, provider) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS mapped,
            count(*) FILTER (
              WHERE EXISTS (SELECT 1 FROM season s
                             WHERE s.competition_id = c.id AND s.is_current)
            )::int AS in_season
       FROM provider_mapping pm
       JOIN competition c ON c.id = pm.internal_id
      WHERE pm.provider = $1 AND pm.entity_type = 'competition'`,
    [provider],
  );
  return { mapped: rows[0].mapped, inSeason: rows[0].in_season };
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
    const counts = await pollableCounts(client, options.provider);
    console.log(`\n${emptyQueueNote(options.provider, counts.mapped, counts.inSeason)}`);
    return 0;
  }
  console.log(`${rows.length} waiting (provider ${options.provider}):`);
  for (const row of rows) {
    console.log(
      `  ${row.entity_type.padEnd(11)} ${String(row.external_id).padStart(7)}  ` +
        `${(row.name ?? '(no name)').padEnd(28)} seen ${row.seen_count}`,
    );
  }
  console.log(
    '\nAdopt them with --adopt-teams, --adopt-people and --adopt-venues, ' +
      'or place one by hand with --map.',
  );
  return 0;
}

/**
 * What each adoption creates from a queued id: the one row, holding only what
 * the queue knows. A club gets its name and the kind every covered competition
 * has; a person the name the provider printed (often "J. Bellingham" -- it is
 * what we have, and a provider that serves full names can fill it in later); a
 * venue its name and, when the provider gave one, its city.
 */
export const ADOPTIONS = {
  team: {
    plural: 'team(s)',
    action: 'catalog.team_added',
    insert: `INSERT INTO team (name, kind, gender, age_group, is_active)
             VALUES ($1, 'club', 'men', 'senior', true) RETURNING id`,
    values: (row) => [row.name],
  },
  person: {
    plural: 'person(s)',
    action: 'catalog.person_added',
    insert: 'INSERT INTO person (full_name) VALUES ($1) RETURNING id',
    values: (row) => [row.name],
  },
  venue: {
    plural: 'venue(s)',
    action: 'catalog.venue_added',
    insert: 'INSERT INTO venue (name, city) VALUES ($1, $2) RETURNING id',
    values: (row) => [row.name, row.city],
  },
};

/**
 * Turns every queued id of one kind into a new row and its mapping. Never a
 * match by name (rule 1): an id the provider means as someone we already hold
 * is placed by hand with `--map`, and the queue records which was which.
 */
async function adopt(client, options, entityType) {
  const kind = ADOPTIONS[entityType];
  const { rows } = await client.query(
    `SELECT id, external_id, payload->>'name' AS name, payload->>'city' AS city
       FROM unresolved_entity
      WHERE provider = $1 AND status = 'pending' AND entity_type = $2
        AND payload->>'name' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM provider_mapping m
           WHERE m.provider = unresolved_entity.provider
             AND m.entity_type = $2
             AND m.external_id = unresolved_entity.external_id)
      ORDER BY external_id`,
    [options.provider, entityType],
  );
  if (rows.length === 0) {
    console.log(`No ${entityType} is waiting to be adopted.`);
    return 0;
  }
  if (options.dryRun) {
    console.log(`${rows.length} ${kind.plural} would be created, one row each:`);
    for (const row of rows) console.log(`  ${String(row.external_id).padStart(7)}  ${row.name}`);
    console.log('\nRun again without --dry-run to write them.');
    return 0;
  }

  let audited = false;
  for (const row of rows) {
    await client.query('BEGIN');
    try {
      const created = await client.query(kind.insert, kind.values(row));
      const id = created.rows[0].id;
      await client.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ($1, $2, $3, $4)`,
        [options.provider, entityType, row.external_id, id],
      );
      await client.query(
        `UPDATE unresolved_entity
            SET status = 'resolved', resolved_internal_id = $2, resolved_by = $3,
                resolved_at = now(), resolution_note = 'adopted into the catalogue'
          WHERE id = $1`,
        [row.id, id, options.by ?? 'catalog.mjs'],
      );
      audited =
        (await audit(client, options.by, kind.action, entityType, id, {
          name: row.name,
          provider: options.provider,
          external_id: row.external_id,
        })) || audited;
      await client.query('COMMIT');
      // A club or a ground is worth a line each; a season's squads are not.
      if (entityType !== 'person') {
        console.log(`  + ${row.name} (${options.provider} ${row.external_id}) -> ${id}`);
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log(`${rows.length} ${kind.plural} adopted.`);
  sayIfUnaudited(audited, options.by);
  if (entityType !== 'team') await askAgainForDetail(client, options.provider);
  return 0;
}

/**
 * The matches whose detail was fetched while these ids had nowhere to go: their
 * line-ups, scorers and grounds were left out rather than written as blanks
 * (T-026), so the post-match job is told to ask again (T-102). It takes them a
 * batch at a time, newest first, within its own budget.
 */
async function askAgainForDetail(client, provider) {
  const { rowCount } = await client.query('DELETE FROM fixture_detail_fetch WHERE provider = $1', [
    provider,
  ]);
  if (rowCount > 0) {
    console.log(
      `${rowCount} finished match(es) will be asked for their detail again, so what these ` +
        'rows appear in is written.',
    );
  }
}

/**
 * A country, by its FIFA trigram. The catalogue never infers one -- a team
 * adopted from the queue arrives without a country -- but a domestic
 * competition cannot exist without one (`competition_domestic_has_country`),
 * and a deployment that has just been migrated holds none. The operator names
 * it here, from the standard, and that is recorded like every other write.
 */
async function addCountry(client, options) {
  const existing = await client.query('SELECT id FROM country WHERE code = $1', [options.code]);
  if (existing.rows[0] !== undefined) {
    console.log(`${options.code} already exists as ${existing.rows[0].id}. Nothing written.`);
    return 0;
  }
  await client.query('BEGIN');
  try {
    const created = await client.query(
      'INSERT INTO country (code, iso2, name) VALUES ($1, $2, $3) RETURNING id',
      [options.code, options.iso2 === '' ? null : options.iso2, options.name],
    );
    const id = created.rows[0].id;
    const audited = await audit(client, options.by, 'catalog.country_added', 'country', id, {
      code: options.code,
      iso2: options.iso2 === '' ? null : options.iso2,
      name: options.name,
    });
    await client.query('COMMIT');
    console.log(`${options.name} (${options.code}) -> ${id}.`);
    sayIfUnaudited(audited, options.by);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
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
      // Every FIFA member association arrives with the migrations (D-078), so
      // this is a code mistyped, or a country outside FIFA's list.
      console.error(
        `No country with the code ${options.country}. Add it first:
` + '  --add-country --code <FIFA trigram> --name "<name>" [--iso2 <XX>]',
      );
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

/**
 * Which football-data.co.uk division a competition's results are in, so the
 * model and the Power Index know where its history is (T-063, D-080).
 */
async function setDivision(client, options) {
  const { rows } = await client.query(
    `UPDATE competition c SET football_data_division = $3
       FROM provider_mapping pm
      WHERE pm.internal_id = c.id AND pm.entity_type = 'competition'
        AND pm.provider = $1 AND pm.external_id = $2
      RETURNING c.id, c.name`,
    [options.provider, options.competition, options.division],
  );
  if (rows[0] === undefined) {
    console.error(`No competition is mapped to ${options.provider} ${options.competition}.`);
    return 1;
  }
  const audited = await audit(
    client,
    options.by,
    'catalog.competition_division_set',
    'competition',
    rows[0].id,
    { football_data_division: options.division },
  );
  console.log(`${rows[0].name} -> football-data.co.uk ${options.division}.`);
  sayIfUnaudited(audited, options.by);
  return 0;
}

/** `provider,provider_team_id,division,training_name`, one alias a line. */
export function parseAliases(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines.shift();
  if (header !== 'provider,provider_team_id,division,training_name') {
    return { error: 'the header must be provider,provider_team_id,division,training_name' };
  }
  const rows = [];
  for (const [index, line] of lines.entries()) {
    const [provider, teamId, division, ...rest] = line.split(',');
    const name = rest.join(',').trim();
    if (!PROVIDERS.includes(provider) || !/^\d+$/.test(teamId ?? '') || name === '') {
      return { error: `line ${index + 2} is not provider,id,division,name: ${line}` };
    }
    if (!/^[A-Z]{1,2}[0-9C]$/.test(division ?? '')) {
      return { error: `line ${index + 2}: ${division} is not a football-data.co.uk division` };
    }
    rows.push({ provider, teamId, division, name });
  }
  return { rows };
}

/**
 * The model is fitted on the training data's names; the product speaks in
 * catalogue ids. This writes the bridge from a committed list keyed by the
 * provider's club id -- stable across deployments, where our ids are not --
 * and refuses a name the training data does not hold, so a typo is an error
 * rather than a club the model silently cannot see. It then checks the bridge
 * against results: every match of the training data's newest season should be
 * one of ours, on the same day, between the same two clubs, with the same
 * score. A name is never matched to a club by likeness (rule 1).
 */
async function aliasTraining(client, options) {
  const parsed = parseAliases(readFileSync(options.file, 'utf8'));
  if (parsed.error !== undefined) {
    console.error(`${options.file}: ${parsed.error}`);
    return 2;
  }
  let written = 0;
  const unmapped = [];
  const unknown = [];
  for (const row of parsed.rows) {
    const team = await client.query(
      `SELECT internal_id FROM provider_mapping
        WHERE provider = $1 AND entity_type = 'team' AND external_id = $2`,
      [row.provider, row.teamId],
    );
    if (team.rows[0] === undefined) {
      unmapped.push(`${row.provider} ${row.teamId} (${row.name})`);
      continue;
    }
    const known = await client.query(
      `SELECT 1 FROM training.match
        WHERE division = $1 AND (home_team = $2 OR away_team = $2) LIMIT 1`,
      [row.division, row.name],
    );
    if (known.rows[0] === undefined) {
      unknown.push(`${row.division} "${row.name}"`);
      continue;
    }
    const { rowCount } = await client.query(
      `INSERT INTO training.team_alias (team_id, division, training_name) VALUES ($1, $2, $3)
       ON CONFLICT (team_id, division) DO UPDATE SET training_name = EXCLUDED.training_name
        WHERE training.team_alias.training_name IS DISTINCT FROM EXCLUDED.training_name`,
      [team.rows[0].internal_id, row.division, row.name],
    );
    written += rowCount ?? 0;
  }
  console.log(`${written} alias(es) written, ${parsed.rows.length} in the list.`);
  if (unmapped.length > 0) {
    console.log(`${unmapped.length} club(s) not in the catalogue yet: ${unmapped.join(', ')}`);
  }
  if (unknown.length > 0) {
    console.log(
      `${unknown.length} name(s) the training data does not hold -- load it first, or fix ` +
        `the list: ${unknown.join(', ')}`,
    );
  }

  const check = await client.query(
    `WITH newest AS (
       SELECT division, max(season) AS season FROM training.match GROUP BY division)
     SELECT m.division,
            count(*)::int AS results,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM fixture f
                JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
                JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
                JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
               WHERE h.team_id = ah.team_id AND a.team_id = aa.team_id
                 AND sc.home = m.home_goals AND sc.away = m.away_goals
                 AND f.kickoff_at::date BETWEEN m.match_date - 1 AND m.match_date + 1))::int
              AS agreeing
       FROM training.match m
       JOIN newest n ON n.division = m.division AND n.season = m.season
       LEFT JOIN training.team_alias ah
         ON ah.division = m.division AND ah.training_name = m.home_team
       LEFT JOIN training.team_alias aa
         ON aa.division = m.division AND aa.training_name = m.away_team
      WHERE m.division IN (SELECT DISTINCT division FROM training.team_alias)
      GROUP BY m.division ORDER BY m.division`,
  );
  for (const row of check.rows) {
    console.log(
      `  ${row.division}: ${row.agreeing} of ${row.results} results in the newest season agree ` +
        'with ours (same day, same clubs, same score).',
    );
  }
  await audit(
    client,
    options.by,
    'catalog.training_aliases_set',
    'training_alias_list',
    String(options.file).split(/[\\/]/).pop(),
    { written, listed: parsed.rows.length },
  );
  return unknown.length > 0 ? 1 : 0;
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
        return await adopt(client, parsed, 'team');
      case 'adopt-people':
        return await adopt(client, parsed, 'person');
      case 'adopt-venues':
        return await adopt(client, parsed, 'venue');
      case 'add-country':
        return await addCountry(client, parsed);
      case 'add-competition':
        return await addCompetition(client, parsed);
      case 'add-season':
        return await addSeason(client, parsed);
      case 'set-division':
        return await setDivision(client, parsed);
      case 'alias-training':
        return await aliasTraining(client, parsed);
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
