// The translator's catalogue (T-302, D-066): one JSON file per locale that a
// fluent speaker edits directly, and this script, which keeps those files in
// step with the English source without ever touching a translation.
//
//   node scripts/i18n-catalogues.mjs          # refresh every locale file
//   node scripts/i18n-catalogues.mjs --check  # exit 1 if any file is stale
//
// `src/i18n/catalogues/en.json` is the source of truth: every key the product
// shows, in English. Each other locale's file carries every one of those keys
// with the English beside it, so the translator sees what they are
// translating without opening any code:
//
//   "nav.scores": { "source": "Scores", "text": "Resultados", "status": "translated" }
//
// `status` is one of `untranslated` (text is empty, the page shows English and
// says so), `translated` (a fluent speaker wrote it) or `reviewed` (a second
// fluent speaker approved it -- blueprint 13.2). Nothing here ever fills in a
// text: producing a language by machine and shipping it as the product's
// language would be inventing content.
//
// What refreshing does: adds a key the source gained (as `untranslated`),
// updates every `source` to the current English, keeps `text`, `status` and
// `note` exactly as the translator left them, and **refuses to drop a key that
// still carries text** -- a translation is removed on purpose, by a person,
// never by a script noticing the English moved. A key with no text that the
// source no longer has is dropped, because there was nothing to lose.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'catalogues');
const SOURCE = 'en';
const STATUSES = new Set(['untranslated', 'translated', 'reviewed']);
const CHECK = process.argv.includes('--check');

/** Read a catalogue file, or an empty catalogue if it is not there yet. */
function read(locale) {
  try {
    return JSON.parse(readFileSync(join(DIR, `${locale}.json`), 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

/** The English source, and the locales that have a file beside it. */
const source = read(SOURCE);
const locales = readdirSync(DIR)
  .filter((name) => name.endsWith('.json') && name !== `${SOURCE}.json`)
  .map((name) => name.slice(0, -'.json'.length))
  .sort();

let stale = 0;
const problems = [];

for (const locale of locales) {
  const current = read(locale);
  const next = {};

  for (const [key, english] of Object.entries(source)) {
    const entry = current[key];
    if (entry === undefined) {
      next[key] = { source: english, text: '', status: 'untranslated' };
      continue;
    }
    const status = STATUSES.has(entry.status) ? entry.status : 'untranslated';
    const text = typeof entry.text === 'string' ? entry.text : '';
    if ((text === '') !== (status === 'untranslated')) {
      problems.push(
        `${locale}: ${key} has status "${status}" but ${text === '' ? 'no' : 'a'} text`,
      );
    }
    next[key] = { source: english, text, status, ...(entry.note ? { note: entry.note } : {}) };
  }

  for (const [key, entry] of Object.entries(current)) {
    if (key in source) continue;
    if (entry && typeof entry.text === 'string' && entry.text !== '') {
      problems.push(
        `${locale}: "${key}" is no longer in the English source but still carries a translation; remove it by hand if that is intended`,
      );
      next[key] = entry;
    }
  }

  const rendered = `${JSON.stringify(next, null, 2)}\n`;
  const existing = (() => {
    try {
      return readFileSync(join(DIR, `${locale}.json`), 'utf8');
    } catch {
      return '';
    }
  })();

  if (rendered !== existing) {
    stale += 1;
    if (CHECK) {
      problems.push(
        `${locale}.json is out of step with en.json; run "pnpm --filter @fmip/web i18n:catalogues"`,
      );
    } else {
      writeFileSync(join(DIR, `${locale}.json`), rendered);
      process.stdout.write(`refreshed ${locale}.json
`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`);
  process.exit(1);
}

process.stdout.write(
  `${
    CHECK
      ? `every catalogue is in step with en.json (${locales.length} locales)`
      : `${stale} file(s) refreshed, ${locales.length - stale} already current`
  }
`,
);
