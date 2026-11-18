/**
 * Duplicate persons, as an operator sees them (T-1864, D-446). Reached
 * through `catalog.mjs`, which parses the arguments and connects:
 *
 *     node scripts/catalog.mjs --person-candidates [--limit N]
 *     node scripts/catalog.mjs --merge-people --from <uuid> --into <uuid> \
 *       --reason "<why>" --by <admin e-mail> [--dry-run]
 *     node scripts/catalog.mjs --merge-people --file <loser,survivor csv, or -> \
 *       --reason "<why>" --by <admin e-mail> [--dry-run]
 *     node scripts/catalog.mjs --unmerge --merge <merge uuid> --reason "<why>" \
 *       --by <admin e-mail> [--dry-run]
 *     node scripts/catalog.mjs --not-duplicate --a <uuid> --b <uuid> --reason "<why>" \
 *       --by <admin e-mail> [--dry-run]
 *
 * What it will not do. It never merges by itself: the candidates are a
 * question, and each merge is a person's judgement, named with `--by` (an
 * active administrator) and a reason (D-446 points 2 and 4). Every write goes
 * through the shared database functions of T-1863 -- `merge_person`,
 * `merge_person_undo` -- and every refusal of theirs (SQLSTATE PL024) is
 * said in the operator's words, with what to do instead. A dry run runs the
 * same function in a transaction it rolls back, so it prints exactly what
 * would move, or the refusal that would stop it.
 *
 * A batch (`--file`, for T-1867) merges one pair per transaction in the
 * file's order and stops at the first pair refused, saying which; the pairs
 * before it stay merged, each with its merge id for `--unmerge`. After every
 * batch, and after a single merge, it re-runs the check that nothing still
 * references a loser (every foreign key to `person` but the tombstone's own
 * links, and the type-and-id tables a merge moves): an ingestion transaction
 * that read a loser's mapping before the merge committed can still write one
 * row to it (D-446 Consequences).
 *
 * After a merge or an unmerge, every answered profile and name record
 * (`person_bio_fetch`, `person_name_fetch`) of the survivor (and on an
 * unmerge of the restored loser too) is cleared except a `written` one, so
 * the jobs ask again by every id the person now has (rev-2026-11-17-11 and
 * the T-1864 review's m1): those jobs ask only a person with no answer, so a
 * `name_differs`, `name_kept`, `no_profile` or `nothing_new` answer given
 * under the old ids would otherwise stand for ever. The confirmed merge (or
 * its undo) is what settles whether another name under one of the ids was
 * another human. A `written` answer stays: its fields are already stored.
 *
 * After a merge, a survivor holding coaching spells but no `coach_fetch` row
 * (a player and coach pair: `merge_person` moves the coach id's spells and
 * sets its ask record aside) has the teams of those spells asked again
 * (T-1882, `askCoachTeamsAgain`): the coaches job asks per team, an answered
 * team only every 30 days, and only a team's answer writes his `coach_fetch`
 * again. Until then his coach page says `limited`.
 */

const ident = (name) => `"${String(name).replaceAll('"', '""')}"`;
const literal = (text) => `'${String(text).replaceAll("'", "''")}'`;

/** The verbs this file serves. */
export const PERSON_VERBS = ['person-candidates', 'merge-people', 'unmerge', 'not-duplicate'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PERSON_USAGE = `  --person-candidates [--limit N]        (read only: the pairs that may be one human, with signals)
  --merge-people --from <loser uuid> --into <survivor uuid> --reason "<why>" --by <admin>
                 [--dry-run]
  --merge-people --file <csv of loser,survivor, or - for standard input> --reason "<why>"
                 --by <admin> [--dry-run]    (in order, one transaction a pair; stops at the first refusal)
  --unmerge --merge <merge uuid> --reason "<why>" --by <admin> [--dry-run]
  --not-duplicate --a <person uuid> --b <person uuid> --reason "<why>" --by <admin> [--dry-run]`;

/**
 * The person command in these flags, or the reason there is none. Pure.
 * `flags` is `catalog.mjs`'s parsed map.
 */
export function parsePersonArgs(verb, flags) {
  const text = (key) => {
    const value = flags.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };
  const dryRun = flags.get('dry-run') === true;
  if (verb === 'person-candidates') {
    const limit = Number(flags.get('limit') ?? '200');
    if (!Number.isInteger(limit) || limit <= 0) return { error: '--limit must be a whole number.' };
    return { command: verb, limit };
  }
  // Every write names an administrator and a reason (D-446 point 2, rule 10);
  // so does a dry run, which runs the same function with that actor.
  const by = text('by');
  const reason = text('reason');
  if (by === '') return { error: '--by is required: the administrator who confirms is audited.' };
  if (reason === '') return { error: '--reason is required: it is kept in the audit log.' };
  const uuid = (key, what) => {
    const value = text(key);
    if (value === '') return { error: `--${key} is required: ${what}.` };
    if (!UUID.test(value)) return { error: `--${key} is not a uuid: "${value}".` };
    return { value: value.toLowerCase() };
  };

  if (verb === 'merge-people') {
    const file = text('file');
    const from = text('from');
    const into = text('into');
    if (file !== '' && (from !== '' || into !== '')) {
      return { error: 'Name one pair (--from and --into) or a batch (--file), not both.' };
    }
    if (file !== '') return { command: verb, by, reason, dryRun, file, pairs: null };
    const loser = uuid('from', 'the person that becomes the tombstone');
    if (loser.error !== undefined) return loser;
    const survivor = uuid('into', 'the person that is kept');
    if (survivor.error !== undefined) return survivor;
    if (loser.value === survivor.value) return { error: '--from and --into are the same person.' };
    return {
      command: verb,
      by,
      reason,
      dryRun,
      file: null,
      pairs: [{ from: loser.value, into: survivor.value }],
    };
  }
  if (verb === 'unmerge') {
    const merge = uuid('merge', 'the merge id that --merge-people printed');
    if (merge.error !== undefined) return merge;
    return { command: verb, by, reason, dryRun, merge: merge.value };
  }
  const a = uuid('a', 'one of the two persons');
  if (a.error !== undefined) return a;
  const b = uuid('b', 'the other person');
  if (b.error !== undefined) return b;
  if (a.value === b.value) return { error: '--a and --b are the same person.' };
  return { command: 'not-duplicate', by, reason, dryRun, a: a.value, b: b.value };
}

/**
 * A batch file: one `loser,survivor` pair a line, persons' uuids; a header
 * (`loser,survivor` or `from,into`) and `#` comments are allowed, and a
 * third column onwards is for the file's reader (the names, say) and never
 * read (rule 1). Pure.
 */
export function parsePairs(text) {
  // Each line keeps its number in the file, so an error names the line the
  // operator sees in an editor.
  const lines = text
    .split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter((line) => line.text !== '' && !line.text.startsWith('#'));
  if (lines[0] !== undefined && /^(loser|from)\s*,\s*(survivor|into)\b/i.test(lines[0].text)) {
    lines.shift();
  }
  const pairs = [];
  const losers = new Set();
  for (const line of lines) {
    const [from = '', into = ''] = line.text.split(',').map((cell) => cell.trim().toLowerCase());
    const row = `line ${line.number}`;
    if (!UUID.test(from)) return { error: `${row}: the loser "${from}" is not a uuid` };
    if (!UUID.test(into)) return { error: `${row}: the survivor "${into}" is not a uuid` };
    if (from === into) return { error: `${row}: ${from} is merged into itself` };
    if (losers.has(from)) return { error: `${row}: ${from} is a loser twice` };
    losers.add(from);
    pairs.push({ from, into });
  }
  if (pairs.length === 0) return { error: 'no loser,survivor pair in the file' };
  return { pairs };
}

/**
 * What a refusal of `merge_person`, `merge_person_undo` or this file means,
 * in the operator's words (SQLSTATE PL024; the hint names the rule). `facts`
 * carries what the caller looked up to say what to do instead. Pure.
 */
export function refusal(hint, facts = {}) {
  switch (hint) {
    case 'actor':
      return 'The merge needs the administrator who confirms it (--by).';
    case 'reason':
      return 'The merge needs a reason (--reason).';
    case 'same_person':
      return 'A merge needs two different persons.';
    case 'not_found':
      return `${facts.what ?? 'The person or merge'} does not exist.`;
    case 'already_merged':
      return (
        `${facts.from} is already merged into ${facts.into ?? 'another person'}` +
        (facts.merge === undefined
          ? '.'
          : ` (merge ${facts.merge}; --unmerge --merge ${facts.merge} first).`)
      );
    case 'into_merged':
      return (
        `${facts.into} is itself a tombstone merged into ${facts.target ?? 'another person'}: ` +
        `merge into ${facts.target ?? 'that person'} instead.`
      );
    case 'judged_different':
      return (
        'These two were judged to be two people' +
        (facts.decided === undefined ? '' : ` (${facts.decided})`) +
        '; a merge is refused while that judgement stands.'
      );
    case 'shared_lineup':
      return (
        `Both are on the line-up of one match${facts.fixture === undefined ? '' : ` (fixture ${facts.fixture})`}: ` +
        'two people on one team sheet are two humans and are never merged (D-446 point 3). ' +
        'Record it with --not-duplicate.'
      );
    case 'shared_incident':
      return (
        `One incident names both${facts.incident === undefined ? '' : ` (incident ${facts.incident})`}, ` +
        'one as its person and the other as its related person: two humans, never merged (D-446 point 3). ' +
        'Record it with --not-duplicate.'
      );
    case 'already_undone':
      return 'That merge was already undone.';
    case 'survivor_merged':
      return 'The survivor of that merge has been merged since: undo the later merge first.';
    case 'not_admin':
      return `${facts.by} is not an active administrator; a merge decision is recorded as theirs.`;
    case 'tombstone':
      return `${facts.person} is merged into ${facts.into}: judge ${facts.into} instead.`;
    case 'judged_already':
      return 'That pair is already recorded as two people.';
    default:
      return null;
  }
}

/** The administrator `--by` names: an active account holding the admin role. */
async function administrator(client, by) {
  const { rows } = await client.query(
    `SELECT a.id, EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = a.id AND r.role = 'admin') AS admin
       FROM user_account a
      WHERE lower(a.email) = lower($1) AND a.status = 'active'`,
    [by],
  );
  if (rows[0] === undefined || !rows[0].admin) return null;
  return rows[0].id;
}

/** The facts behind a PL024 refusal, so the message says what to do. */
async function refusalFacts(client, hint, pair) {
  const { from, into } = pair;
  if (hint === 'already_merged') {
    const { rows } = await client.query(
      `SELECT id, into_person_id FROM person_merge WHERE from_person_id = $1 AND undone_at IS NULL`,
      [from],
    );
    return { from, into: rows[0]?.into_person_id, merge: rows[0]?.id };
  }
  if (hint === 'into_merged') {
    const { rows } = await client.query(`SELECT person_merged_into($1) AS target`, [into]);
    return { into, target: rows[0]?.target ?? undefined };
  }
  if (hint === 'judged_different') {
    const { rows } = await client.query(
      `SELECT n.decided_at, n.reason, a.email
         FROM person_not_duplicate n LEFT JOIN user_account a ON a.id = n.decided_by
        WHERE n.low_person_id = least($1::uuid, $2::uuid) AND n.high_person_id = greatest($1::uuid, $2::uuid)`,
      [from, into],
    );
    const row = rows[0];
    return row === undefined
      ? {}
      : {
          decided: `by ${row.email ?? 'an account since deleted'} on ${row.decided_at.toISOString().slice(0, 10)}: ${row.reason}`,
        };
  }
  if (hint === 'shared_lineup') {
    const { rows } = await client.query(`SELECT person_shared_lineup_fixture($1, $2) AS id`, [
      from,
      into,
    ]);
    return { fixture: rows[0]?.id ?? undefined };
  }
  if (hint === 'shared_incident') {
    const { rows } = await client.query(`SELECT person_shared_incident($1, $2) AS id`, [
      from,
      into,
    ]);
    return { incident: rows[0]?.id ?? undefined };
  }
  if (hint === 'not_found') return { what: `Person ${from} or ${into}` };
  return {};
}

/** A PL024 error's hint, or null for any other error (which is thrown on). */
function pl024(error) {
  return error !== null && typeof error === 'object' && error.code === 'PL024'
    ? (error.hint ?? 'unknown')
    : null;
}

async function personLine(client, id) {
  const { rows } = await client.query(
    `SELECT full_name, to_char(date_of_birth, 'YYYY-MM-DD') AS born FROM person WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row === undefined
    ? `${id} (no such person)`
    : `${row.full_name} (${id}, born ${row.born ?? 'unknown'})`;
}

/**
 * Every answered profile and name record of these persons but a `written`
 * one, cleared so the jobs ask again by every id (rev-2026-11-17-11, review
 * m1). An ask still waiting for its answer is left to its job. Returns the
 * count.
 */
async function askProfilesAgain(client, personIds) {
  const bios = await client.query(
    `DELETE FROM person_bio_fetch
      WHERE person_id = ANY($1::uuid[]) AND answered_at IS NOT NULL AND outcome <> 'written'`,
    [personIds],
  );
  const names = await client.query(
    `DELETE FROM person_name_fetch
      WHERE person_id = ANY($1::uuid[]) AND answered_at IS NOT NULL AND outcome <> 'written'`,
    [personIds],
  );
  return (bios.rowCount ?? 0) + (names.rowCount ?? 0);
}

/**
 * The teams where these persons hold a coaching spell with no `coach_fetch`
 * row, marked so the coaches job asks them again (T-1882). Returns the count.
 *
 * The lever is the job's own (`CoachStore.teamsDue`): an answered team
 * (`failures = 0`) is asked again only 30 days after its answer, a team whose
 * last ask counts as unanswered (`failures > 0`) a day after that ask. So the
 * ask is counted as one unanswered, `failures = 1`: the team is due at the
 * job's next run once its last ask is a day old, and the answer resets the
 * count. No timestamp is touched: `answered_at` stays true, so the team's
 * head coach reads as before (rule 4). Only a team the job would pick is
 * marked, one playing in a current season (`teamsDue`'s `playing`); a team
 * never asked is owed its first ask already, and one already unanswered is
 * left to its own count.
 */
export async function askCoachTeamsAgain(client, personIds) {
  const { rowCount } = await client.query(
    `UPDATE team_coach_fetch tf
        SET failures = 1
      WHERE tf.failures = 0
        AND EXISTS (
          SELECT 1 FROM coach_spell cs
           WHERE cs.source = tf.source AND cs.team_id = tf.team_id
             AND cs.person_id = ANY($1::uuid[])
             AND NOT EXISTS (
               SELECT 1 FROM coach_fetch cf
                WHERE cf.source = cs.source AND cf.person_id = cs.person_id))
        AND EXISTS (
          SELECT 1 FROM fixture_participant fp
            JOIN fixture f ON f.id = fp.fixture_id
            JOIN season se ON se.id = f.season_id
           WHERE fp.team_id = tf.team_id AND se.is_current)`,
    [personIds],
  );
  return rowCount ?? 0;
}

/** `--person-candidates`: the pairs, their signals, and the command each proposes. Read only. */
export async function personCandidates(client, options) {
  const { rows } = await client.query(
    `SELECT c.*, pl.full_name AS low_name, ph.full_name AS high_name,
            to_char(pl.date_of_birth, 'YYYY-MM-DD') AS born,
            nl.name AS low_nationality, nh.name AS high_nationality
       FROM person_duplicate_candidates() c
       JOIN person pl ON pl.id = c.low_person_id
       JOIN person ph ON ph.id = c.high_person_id
       LEFT JOIN country nl ON nl.id = pl.nationality_id
       LEFT JOIN country nh ON nh.id = ph.nationality_id`,
  );
  if (rows.length === 0) {
    console.log('No duplicate-person candidates.');
    return 0;
  }
  const shown = rows.slice(0, options.limit);
  console.log(
    `${rows.length} pair(s) with the same name and birth date` +
      (shown.length < rows.length ? `; the first ${shown.length}:` : ':'),
  );
  const yes = (value) => (value === null ? 'unknown' : value ? 'yes' : 'no');
  const span = (n, first, last) =>
    n === 0
      ? '0 line-ups'
      : `${n} line-up(s), ${first.toISOString().slice(0, 10)}..${last.toISOString().slice(0, 10)}`;
  const BECAUSE = {
    player_row: 'the player row of a player and coach pair',
    more_lineups: 'more line-ups',
    older_row: 'the older row',
    lower_id: 'the lower id',
  };
  for (const row of shown) {
    const loser = row.proposed_into === row.low_person_id ? row.high_person_id : row.low_person_id;
    console.log(
      `\n  ${row.low_name} / ${row.high_name}, born ${row.born} (${row.matched_on === 'full_name' ? 'same full name' : "one's full name the other's known-as"})`,
    );
    console.log(
      `    ${row.low_person_id}  ${row.low_coach_only ? 'coach id only, ' : ''}${row.low_nationality ?? 'nationality unknown'}, ${span(row.low_lineups, row.low_first_lineup, row.low_last_lineup)}`,
    );
    console.log(
      `    ${row.high_person_id}  ${row.high_coach_only ? 'coach id only, ' : ''}${row.high_nationality ?? 'nationality unknown'}, ${span(row.high_lineups, row.high_first_lineup, row.high_last_lineup)}`,
    );
    console.log(
      `    same nationality: ${yes(row.same_nationality)}; clubs in common: ${row.common_teams.length === 0 ? 'none' : row.common_teams.join(', ')}; appearances disjoint: ${yes(row.appearances_disjoint)}`,
    );
    console.log(
      `    proposed (${BECAUSE[row.proposed_because] ?? row.proposed_because}): --merge-people --from ${loser} --into ${row.proposed_into}`,
    );
  }
  console.log(
    '\nA candidate is a question, not a merge (D-446): each pair is confirmed by a person with --merge-people, ' +
      'or recorded as two people with --not-duplicate.',
  );
  return 0;
}

/**
 * Every row that still names one of these persons where a merge would have
 * moved it: each foreign-key column to `person` (read from the catalogue, so
 * a column added later is checked too) but the tombstone's own links
 * (`person_merge`, `person_not_duplicate`) and members' panel links
 * (`panel_post.link_person_id`, D-446 point 5), and the type-and-id tables a
 * merge moves. Returns `[{ person, column, rows }]`.
 */
export async function referencesTo(client, personIds) {
  const { rows: columns } = await client.query(
    `SELECT n.nspname AS schema, r.relname AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'public.person'::regclass
        AND array_length(c.conkey, 1) = 1
        AND NOT (n.nspname = 'public' AND r.relname IN ('person_merge', 'person_not_duplicate'))
        AND NOT (n.nspname = 'public' AND r.relname = 'panel_post' AND a.attname = 'link_person_id')
      ORDER BY 1, 2, 3`,
  );
  const polymorphic = [
    ['followed_entity', 'entity_id'],
    ['entity_alias', 'entity_id'],
    ['entity_media', 'entity_id'],
    ['article_entity', 'entity_id'],
    ['provider_mapping', 'internal_id'],
  ];
  const parts = [
    ...columns.map(
      ({ schema, tbl, col }) =>
        `SELECT ${literal(schema === 'public' ? `${tbl}.${col}` : `${schema}.${tbl}.${col}`)} AS col,
                t.${ident(col)}::uuid AS person, count(*)::int AS n
           FROM ${ident(schema)}.${ident(tbl)} t
          WHERE t.${ident(col)} = ANY($1::uuid[]) GROUP BY 2`,
    ),
    ...polymorphic.map(
      ([tbl, col]) =>
        `SELECT '${tbl}.${col}' AS col, t.${col}::uuid AS person, count(*)::int AS n
           FROM ${tbl} t
          WHERE t.entity_type = 'person' AND t.${col} = ANY($1::uuid[]) GROUP BY 2`,
    ),
  ];
  const { rows } = await client.query(`${parts.join('\nUNION ALL\n')} ORDER BY 2, 1`, [personIds]);
  return rows.map((row) => ({ person: row.person, column: row.col, rows: row.n }));
}

/**
 * Prints the "nothing references the loser" check for these losers; when the
 * check itself cannot run (the connection that failed a pair, say), says so
 * and names the losers to check again, rather than hiding what was merged.
 */
async function sayReferencesOrSay(client, losers) {
  if (losers.length === 0) return;
  let left;
  try {
    left = await referencesTo(client, losers);
  } catch (error) {
    console.error(
      `\nThe "nothing references the loser" check could not run (${error instanceof Error ? error.message : String(error)}); ` +
        `run it again for: ${losers.join(' ')}`,
    );
    return;
  }
  if (left.length === 0) {
    console.log(
      `\nNothing references the ${losers.length} loser(s) any more (every column checked).`,
    );
    return;
  }
  console.log(
    '\nRows still naming a loser (move each by hand, or re-run the merge function on it):',
  );
  for (const row of left) console.log(`  ${row.person}  ${row.column}: ${row.rows} row(s)`);
}

/** What a merge moved, from the audit row it wrote. */
async function mergeSummary(client, mergeId) {
  const { rows } = await client.query(
    `SELECT l.next FROM person_merge m JOIN audit_log l ON l.id = m.audit_log_id WHERE m.id = $1`,
    [mergeId],
  );
  const next = rows[0]?.next ?? {};
  const list = (object) =>
    Object.entries(object ?? {})
      .map(([key, n]) => `${key} ${n}`)
      .join(', ') || 'nothing';
  return [
    `      re-pointed: ${list(next.repointed)}`,
    `      kept aside: ${list(next.kept_aside)}`,
    `      filled on the survivor: ${Object.keys(next.filled ?? {}).join(', ') || 'nothing'}`,
  ];
}

/**
 * `--merge-people`: one pair, or a batch file's pairs in order. Each pair is
 * its own transaction (a dry run: one transaction, a savepoint a pair, all
 * rolled back), and the first refusal stops the batch.
 */
export async function mergePeople(client, options, readFile) {
  let pairs = options.pairs;
  if (pairs === null) {
    const parsed = parsePairs(readFile(options.file));
    if (parsed.error !== undefined) {
      console.error(`${options.file}: ${parsed.error}`);
      return 2;
    }
    pairs = parsed.pairs;
  }
  const actor = await administrator(client, options.by);
  if (actor === null) {
    console.error(refusal('not_admin', { by: options.by }));
    return 1;
  }

  const merged = [];
  let stopped = null;
  if (options.dryRun) await client.query('BEGIN');
  try {
    for (const [index, pair] of pairs.entries()) {
      const label = `${index + 1}/${pairs.length}`;
      let mergeId;
      let asked;
      let coachTeams;
      let summary;
      try {
        if (options.dryRun) await client.query('SAVEPOINT pair');
        else await client.query('BEGIN');
        const { rows } = await client.query('SELECT merge_person($1, $2, $3, $4) AS id', [
          pair.from,
          pair.into,
          actor,
          options.reason,
        ]);
        mergeId = rows[0].id;
        asked = await askProfilesAgain(client, [pair.into]);
        coachTeams = await askCoachTeamsAgain(client, [pair.into]);
        summary = await mergeSummary(client, mergeId);
        if (options.dryRun) await client.query('RELEASE SAVEPOINT pair');
      } catch (error) {
        // A refusal (PL024) or any other failure (a deadlock with an
        // ingestion transaction, a lost connection) stops the batch the same
        // way (review m2): the pairs before it are merged and committed, so
        // their count and the references check are still said below.
        await client
          .query(options.dryRun ? 'ROLLBACK TO SAVEPOINT pair' : 'ROLLBACK')
          .catch(() => undefined);
        const hint = pl024(error);
        const message = error instanceof Error ? error.message : String(error);
        const facts = hint === null ? {} : await refusalFacts(client, hint, pair).catch(() => ({}));
        stopped = {
          label,
          pair,
          verb: hint === null ? 'failed' : 'refused',
          message:
            hint === null
              ? 'The merge failed; nothing of this pair was written.'
              : (refusal(hint, facts) ?? message),
          detail: message,
        };
        break;
      }

      // The commit on its own (review n1, round 2): a COMMIT that throws may
      // or may not have committed (the connection can drop after the server
      // committed), so the pair is neither "merged" nor "nothing written".
      if (!options.dryRun) {
        try {
          await client.query('COMMIT');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          stopped = {
            label,
            pair,
            verb: 'outcome unknown',
            message:
              `The COMMIT failed, so this pair may or may not be merged (merge id ${mergeId}). ` +
              `Check with SELECT person_merged_into('${pair.from}') and the person_merge table, ` +
              `then run the "nothing references the loser" check for ${pair.from} if it was.`,
            detail: message,
          };
          break;
        }
      }
      merged.push(pair.from);

      // What was done, said only now: a failure while saying it (the
      // connection gone after the commit) does not make a merged pair look
      // unmerged. It is counted as merged and the batch goes on.
      try {
        console.log(
          `${label} ${options.dryRun ? 'would merge' : 'merged'} ${await personLine(client, pair.from)}` +
            ` into ${await personLine(client, pair.into)}` +
            (options.dryRun
              ? ''
              : `\n      merge id ${mergeId} (for --unmerge --merge ${mergeId})`),
        );
        for (const line of summary) console.log(line);
        if (asked > 0) console.log(`      profile answers asked again: ${asked}`);
        if (coachTeams > 0) console.log(`      coach teams asked again: ${coachTeams}`);
      } catch (error) {
        console.error(
          `${label} ${options.dryRun ? 'would merge' : 'merged'} --from ${pair.from} --into ${pair.into}` +
            (options.dryRun ? '' : `, merge id ${mergeId}`) +
            ` (output failed: ${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    if (options.dryRun) await sayReferencesOrSay(client, merged);
  } finally {
    if (options.dryRun) await client.query('ROLLBACK').catch(() => undefined);
  }
  if (!options.dryRun) await sayReferencesOrSay(client, merged);

  if (stopped !== null) {
    console.error(
      `\n${stopped.label} ${stopped.verb}: --from ${stopped.pair.from} --into ${stopped.pair.into}\n  ${stopped.message}\n  (${stopped.detail})`,
    );
    if (pairs.length > 1) {
      const rest = pairs.length - merged.length - 1;
      console.error(
        `  Stopped: ${merged.length} pair(s) ${options.dryRun ? 'would be merged' : 'merged'} before it, ${rest} not tried.`,
      );
    }
    return 1;
  }
  console.log(
    options.dryRun
      ? `\n${merged.length} pair(s) would be merged; nothing was written. Run again without --dry-run.`
      : `\n${merged.length} pair(s) merged, each audited (person.merge).`,
  );
  return 0;
}

/** `--unmerge`: `merge_person_undo`, with what it restores. */
export async function unmerge(client, options) {
  const actor = await administrator(client, options.by);
  if (actor === null) {
    console.error(refusal('not_admin', { by: options.by }));
    return 1;
  }
  const { rows: found } = await client.query(
    `SELECT from_person_id, into_person_id FROM person_merge WHERE id = $1`,
    [options.merge],
  );
  const merge = found[0];
  await client.query('BEGIN');
  try {
    const { rows: moved } = await client.query(
      `SELECT table_name, action, count(*)::int AS n FROM person_merge_moved
        WHERE merge_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
      [options.merge],
    );
    await client.query('SELECT merge_person_undo($1, $2, $3)', [
      options.merge,
      actor,
      options.reason,
    ]);
    const asked = await askProfilesAgain(client, [merge.from_person_id, merge.into_person_id]);
    await client.query(options.dryRun ? 'ROLLBACK' : 'COMMIT');
    console.log(
      `${options.dryRun ? 'Would undo' : 'Undid'} merge ${options.merge}: ` +
        `${await personLine(client, merge.from_person_id)} is ${options.dryRun ? 'to be ' : ''}its own person again, ` +
        `apart from ${await personLine(client, merge.into_person_id)}.`,
    );
    for (const row of moved) console.log(`  ${row.table_name} (${row.action}): ${row.n} row(s)`);
    if (asked > 0) console.log(`  profile answers asked again: ${asked}`);
    console.log(
      options.dryRun
        ? '\nNothing was written. Run again without --dry-run.'
        : '\nAudited (person.unmerge).',
    );
    return 0;
  } catch (error) {
    await client.query('ROLLBACK');
    const hint = merge === undefined ? 'not_found' : pl024(error);
    if (hint === null) throw error;
    console.error(
      hint === 'not_found'
        ? `No person merge ${options.merge}.`
        : `${refusal(hint) ?? error.message}\n  (${error.message})`,
    );
    return 1;
  }
}

/**
 * `--not-duplicate`: a pair judged to be two humans, remembered in
 * `person_not_duplicate` (the candidates leave it out and `merge_person`
 * refuses it), with an `audit_log` row (`person.not_duplicate`, rule 10).
 */
export async function notDuplicate(client, options) {
  const actor = await administrator(client, options.by);
  if (actor === null) {
    console.error(refusal('not_admin', { by: options.by }));
    return 1;
  }
  const [low, high] = [options.a, options.b].sort();
  await client.query('BEGIN');
  try {
    const { rows: people } = await client.query(
      `SELECT id, person_merged_into(id) AS merged_into FROM person WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [[low, high]],
    );
    const missing = [low, high].filter((id) => !people.some((p) => p.id === id));
    if (missing.length > 0) {
      await client.query('ROLLBACK');
      console.error(refusal('not_found', { what: `Person ${missing.join(' and ')}` }));
      return 1;
    }
    const tombstone = people.find((p) => p.merged_into !== null);
    if (tombstone !== undefined) {
      await client.query('ROLLBACK');
      console.error(refusal('tombstone', { person: tombstone.id, into: tombstone.merged_into }));
      return 1;
    }
    const { rowCount } = await client.query(
      `INSERT INTO person_not_duplicate (low_person_id, high_person_id, decided_by, reason)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [low, high, actor, options.reason],
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      const facts = await refusalFacts(client, 'judged_different', { from: low, into: high });
      console.error(
        `${refusal('judged_already')}${facts.decided === undefined ? '' : ` (${facts.decided})`}`,
      );
      return 1;
    }
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
       VALUES ($1, 'person.not_duplicate', 'person', $2, $3, NULL, $4)`,
      [actor, low, options.reason, JSON.stringify({ not_duplicate_of: high })],
    );
    await client.query(options.dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  console.log(
    `${options.dryRun ? 'Would record' : 'Recorded'} as two people: ${await personLine(client, low)} and ${await personLine(client, high)}.`,
  );
  console.log(
    options.dryRun
      ? 'Nothing was written. Run again without --dry-run.'
      : 'Audited (person.not_duplicate); no longer a candidate, and a merge of the two is refused.',
  );
  return 0;
}
