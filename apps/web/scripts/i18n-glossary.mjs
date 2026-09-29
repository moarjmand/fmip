// The shared football glossary (T-1011, D-130): one JSON file per locale that
// the translators edit directly, beside an English list this script keeps.
//
//   node scripts/i18n-glossary.mjs                        # refresh every file
//   node scripts/i18n-glossary.mjs --entities names.json  # ...and add entity names
//   node scripts/i18n-glossary.mjs --check                # exit 1 if anything is wrong
//
// The files live in `packages/contracts/glossary/`, because the API's review
// endpoint enforces the locked terms (T-1012) and the API image carries
// `@fmip/contracts` but not the web app (D-130).
//
// `en.json` is the English side: one entry per term, keyed by a stable id --
// `term.<slug>` for a football word, `team.<uuid>`, `competition.<uuid>` or
// `person.<uuid>` for a name (rule 1: never a name as a key):
//
//   "term.clean-sheet": { "kind": "term", "source": "clean sheet", "locked": false }
//
// Every other locale's file carries every one of those keys with the English
// and the locked flag beside it, and the target term a person wrote:
//
//   "term.clean-sheet": { "source": "clean sheet", "locked": false, "text": "", "status": "untranslated" }
//
// `status` is the catalogue's (D-066): `untranslated` (no text), `translated`
// (a fluent speaker wrote it) or `reviewed` (a second one approved it).
//
// **This script never writes a target term.** It adds a source term as
// `untranslated` with an empty `text`, refreshes `source` and `locked` from
// the English side, and keeps `text`, `status` and `note` exactly as the
// translator left them. A term in another language is a person's words
// (D-066); nothing here produces one.
//
// Where the English comes from:
//
// - **Football terms**: every word of `VOCABULARY` below that the catalogue's
//   English (`apps/web/src/i18n/catalogues/en.json`) actually uses, as a
//   whole word, singular or plural. A word the catalogue stops using is
//   dropped only if no locale carries words for it -- otherwise the script
//   refuses and names it, as the catalogue script does.
// - **Entity names**: `--entities <file>` reads a JSON array of
//   `{ "type": "team" | "competition" | "person", "id": "<uuid>", "name": "..." }`
//   (exported from the catalogue; the query is in D-130) and adds each one as
//   a locked term. Names are only ever added or refreshed: the export is
//   whatever someone chose to export, so a name missing from it is not a name
//   to drop.
//
// `locked` means the translation must carry the term exactly (T-1012 checks
// it). A name is locked; a football word is not until a person sets
// `"locked": true` on it in `en.json`, which the script keeps.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The value after a flag, or null. */
const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
};
// `--catalogues` and `--glossary` point the script elsewhere; the spec uses
// them to run it against a scratch copy.
const CATALOGUES = flag('--catalogues') ?? join(HERE, '..', 'src', 'i18n', 'catalogues');
const GLOSSARY =
  flag('--glossary') ?? join(HERE, '..', '..', '..', 'packages', 'contracts', 'glossary');
const SOURCE = 'en';
const STATUSES = new Set(['untranslated', 'translated', 'reviewed']);
const ENTITY_TYPES = new Set(['team', 'competition', 'person']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHECK = process.argv.includes('--check');
const ENTITIES = flag('--entities');

/**
 * Football words a translator needs to render the same way every time. The
 * glossary holds the ones the catalogue uses; the rest wait until it does.
 * English only -- the list is the source side, which D-130 allows a script
 * to generate.
 */
const VOCABULARY = [
  'assist',
  'booking',
  'captain',
  'clean sheet',
  'coach',
  'competition',
  'corner',
  'derby',
  'extra time',
  'fixture',
  'free kick',
  'full-time',
  'goal',
  'goal difference',
  'goalkeeper',
  'half-time',
  'hat-trick',
  'head-to-head',
  'kick-off',
  'league',
  'line-up',
  'manager',
  'match',
  'matchday',
  'offside',
  'own goal',
  'penalty',
  'player',
  'possession',
  'promotion',
  'red card',
  'referee',
  'relegation',
  'score',
  'scoreline',
  'scorer',
  'season',
  'standings',
  'stoppage time',
  'substitute',
  'team',
  'yellow card',
];

const slug = (term) =>
  term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether the English uses a term as a whole word, singular or plural. */
const uses = (english, term) =>
  new RegExp(`(^|[^a-z0-9-])${escape(term.toLowerCase())}s?($|[^a-z0-9-])`).test(english);

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const problems = [];
const hasWords = (entry) => typeof entry?.text === 'string' && entry.text !== '';

// --- The English side -------------------------------------------------------

const catalogue = readJson(join(CATALOGUES, `${SOURCE}.json`), {});
const english = Object.values(catalogue)
  .map((value) =>
    typeof value === 'string'
      ? value
      : Object.values(value)
          .filter((form) => typeof form === 'string')
          .join('\n'),
  )
  .join('\n')
  .toLowerCase();

const locales = readdirSync(CATALOGUES)
  .filter((name) => name.endsWith('.json') && name !== `${SOURCE}.json`)
  .map((name) => name.slice(0, -'.json'.length))
  .sort();
const localeFiles = Object.fromEntries(
  locales.map((locale) => [locale, readJson(join(GLOSSARY, `${locale}.json`), {})]),
);

const currentEnglish = readJson(join(GLOSSARY, `${SOURCE}.json`), {});
const nextEnglish = {};

for (const term of VOCABULARY) {
  if (!uses(english, term)) continue;
  const key = `term.${slug(term)}`;
  const was = currentEnglish[key];
  nextEnglish[key] = {
    kind: 'term',
    source: term,
    locked: typeof was?.locked === 'boolean' ? was.locked : false,
  };
}

for (const [key, entry] of Object.entries(currentEnglish)) {
  if (key in nextEnglish) continue;
  if (key.startsWith('term.')) {
    // The catalogue no longer uses it. Dropped unless somebody wrote words for it.
    const carriers = locales.filter((locale) => hasWords(localeFiles[locale][key]));
    if (carriers.length > 0) {
      problems.push(
        `"${key}" is no longer used by the catalogue but ${carriers.join(', ')} still carries a term for it; remove it by hand if that is intended`,
      );
      nextEnglish[key] = entry;
    }
    continue;
  }
  // A name. Kept as it is, and checked.
  const [type, id] = key.split('.');
  if (!ENTITY_TYPES.has(type) || !UUID.test(id ?? '') || entry?.kind !== type) {
    problems.push(
      `en: "${key}" is neither a football term nor a team, competition or person by id`,
    );
  }
  if (typeof entry?.source !== 'string' || entry.source.trim() === '') {
    problems.push(`en: "${key}" has no English name`);
  }
  if (entry?.locked !== true) problems.push(`en: "${key}" is a name and must be locked`);
  nextEnglish[key] = entry;
}

if (ENTITIES !== null) {
  if (CHECK) {
    problems.push('--entities adds names; it cannot be combined with --check');
  } else {
    const rows = readJson(ENTITIES, null);
    if (!Array.isArray(rows)) {
      problems.push(`${ENTITIES} is not a JSON array of { type, id, name }`);
    } else {
      for (const row of rows) {
        const type = row?.type;
        const id = typeof row?.id === 'string' ? row.id.toLowerCase() : '';
        const name = typeof row?.name === 'string' ? row.name.trim() : '';
        if (!ENTITY_TYPES.has(type) || !UUID.test(id) || name === '') {
          problems.push(`${ENTITIES}: skipped ${JSON.stringify(row)} (needs type, id and name)`);
          continue;
        }
        nextEnglish[`${type}.${id}`] = { kind: type, source: name, locked: true };
      }
    }
  }
}

const sortedEnglish = Object.fromEntries(
  Object.entries(nextEnglish).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);

// --- Each locale ---------------------------------------------------------

const writes = [[SOURCE, sortedEnglish]];

for (const locale of locales) {
  const current = localeFiles[locale];
  const next = {};
  for (const [key, source] of Object.entries(sortedEnglish)) {
    const entry = current[key];
    const text = typeof entry?.text === 'string' ? entry.text : '';
    const status = entry?.status;
    const note = entry?.note ? { note: entry.note } : {};
    if (status !== undefined && !STATUSES.has(status)) {
      problems.push(
        `${locale}: ${key} has status "${status}", which is not one of ${[...STATUSES].join(', ')}`,
      );
    } else if (status === undefined && text !== '') {
      problems.push(
        `${locale}: ${key} carries a term but no status; a person sets "translated" or "reviewed"`,
      );
    } else if ((text === '') !== ((status ?? 'untranslated') === 'untranslated')) {
      problems.push(
        `${locale}: ${key} has status "${status}" but ${text === '' ? 'no' : 'a'} term`,
      );
    }
    next[key] = {
      source: source.source,
      locked: source.locked,
      text,
      status: status ?? 'untranslated',
      ...note,
    };
  }
  for (const key of Object.keys(current)) {
    if (!(key in sortedEnglish) && hasWords(current[key])) {
      problems.push(`${locale}: "${key}" is not in the English glossary but carries a term`);
      next[key] = current[key];
    }
  }
  writes.push([locale, next]);
}

// Nothing is written while anything is wrong: a refresh that normalised a
// file with a problem in it would hide the problem in the file.
if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`);
  process.exit(1);
}

let stale = 0;
for (const [locale, content] of writes) {
  const path = join(GLOSSARY, `${locale}.json`);
  const rendered = `${JSON.stringify(content, null, 2)}\n`;
  if (rendered === readText(path)) continue;
  stale += 1;
  if (CHECK) {
    console.error(
      `error: glossary/${locale}.json is out of step; run "pnpm --filter @fmip/web i18n:glossary"`,
    );
  } else {
    writeFileSync(path, rendered);
    process.stdout.write(`refreshed glossary/${locale}.json\n`);
  }
}
if (CHECK && stale > 0) process.exit(1);

process.stdout.write(
  CHECK
    ? `the glossary is in step (${Object.keys(sortedEnglish).length} terms, ${locales.length} locales)\n`
    : `${stale} glossary file(s) refreshed, ${writes.length - stale} already current\n`,
);
