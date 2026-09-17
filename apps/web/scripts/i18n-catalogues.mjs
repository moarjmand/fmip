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
// updates every `source` to the current English, keeps `text`, `forms`,
// `status` and `note` exactly as the translator left them, and **refuses to
// drop a key that still carries words** -- a translation is removed on
// purpose, by a person, never by a script noticing the English moved. A key
// with no words that the source no longer has is dropped, because there was
// nothing to lose.
//
// A plural (T-301, D-067) is a key whose English is an object of forms keyed
// by CLDR category, with `type: "ordinal"` for "1st, 2nd". Its entry carries
// `forms` instead of `text`, and a translated entry must have **exactly** the
// categories its language has -- `Intl.PluralRules` says which -- with every
// one filled. A missing form is refused here and again in the spec, never
// filled in: a fallback there is a sentence that is wrong in a way only a
// native speaker sees.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'catalogues');
const SOURCE = 'en';
const STATUSES = new Set(['untranslated', 'translated', 'reviewed']);
const CHECK = process.argv.includes('--check');

/** `en` and the pseudo-locale format as `en-GB` (see src/i18n/format.ts); the rest are themselves. */
const intlLocale = (locale) => (locale === 'en' || locale === 'x-rtl' ? 'en-GB' : locale);

/** The categories a locale's plural (or ordinal) rules actually use. */
const categoriesOf = (locale, type) =>
  new Intl.PluralRules(intlLocale(locale), { type }).resolvedOptions().pluralCategories.sort();

const isPlural = (english) => typeof english === 'object' && english !== null;
const hasWords = (entry) =>
  (typeof entry.text === 'string' && entry.text !== '') ||
  Object.values(entry.forms ?? {}).some((form) => typeof form === 'string' && form !== '');

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
    const status = entry && STATUSES.has(entry.status) ? entry.status : 'untranslated';
    const note = entry && entry.note ? { note: entry.note } : {};

    if (isPlural(english)) {
      const forms =
        entry && typeof entry.forms === 'object' && entry.forms !== null ? entry.forms : {};
      const filled = Object.entries(forms)
        .filter(([, form]) => typeof form === 'string' && form !== '')
        .map(([category]) => category)
        .sort();
      if ((filled.length === 0) !== (status === 'untranslated')) {
        problems.push(
          `${locale}: ${key} has status "${status}" but ${filled.length === 0 ? 'no' : 'some'} forms`,
        );
      }
      if (status !== 'untranslated') {
        const needed = categoriesOf(locale, english.type === 'ordinal' ? 'ordinal' : 'cardinal');
        if (filled.join(',') !== needed.join(',')) {
          problems.push(
            `${locale}: ${key} has forms [${filled.join(', ')}] but ${locale} needs exactly [${needed.join(', ')}] -- a missing form is not filled in`,
          );
        }
      }
      next[key] = { source: english, forms, status, ...note };
      continue;
    }

    const text = entry && typeof entry.text === 'string' ? entry.text : '';
    if ((text === '') !== (status === 'untranslated')) {
      problems.push(
        `${locale}: ${key} has status "${status}" but ${text === '' ? 'no' : 'a'} text`,
      );
    }
    next[key] = { source: english, text, status, ...note };
  }

  for (const [key, entry] of Object.entries(current)) {
    if (key in source) continue;
    if (entry && hasWords(entry)) {
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
