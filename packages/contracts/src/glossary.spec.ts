import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GLOSSARY_KINDS,
  GLOSSARY_STATUSES,
  type Glossary,
  type GlossarySourceEntry,
} from './glossary';

/**
 * The committed glossary files (T-1011, D-130), read the way the API reads
 * them. `i18n:glossary --check` in CI is the full check against the
 * catalogue; this is the shape every consumer relies on.
 */
const DIR = join(__dirname, '..', 'glossary');
const read = <T>(name: string): T => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as T;
const english = read<Record<string, GlossarySourceEntry>>('en.json');
const locales = readdirSync(DIR)
  .filter((name) => name.endsWith('.json') && name !== 'en.json')
  .map((name) => name.slice(0, -'.json'.length));

describe('the glossary files', () => {
  it('has the seven non-English locales and some terms', () => {
    expect(locales.sort()).toEqual(['ar', 'de', 'es', 'fa', 'fr', 'it', 'pt', 'tr']);
    expect(Object.keys(english).length).toBeGreaterThan(0);
  });

  it('keys every English term by a slug or an id, never by a name (rule 1)', () => {
    for (const [key, entry] of Object.entries(english)) {
      expect(GLOSSARY_KINDS).toContain(entry.kind);
      if (entry.kind === 'term') {
        expect(key).toMatch(/^term\.[a-z0-9-]+$/);
      } else {
        expect(key).toMatch(new RegExp(`^${entry.kind}[.][0-9a-f-]{36}$`));
        expect(entry.locked, `${key} is a name`).toBe(true);
      }
    }
  });

  it.each(locales)('%s carries every English term, and a term only with a status', (locale) => {
    const glossary = read<Glossary>(`${locale}.json`);
    expect(Object.keys(glossary)).toEqual(Object.keys(english));
    for (const [key, entry] of Object.entries(glossary)) {
      expect(entry.source).toBe(english[key]!.source);
      expect(entry.locked).toBe(english[key]!.locked);
      expect(GLOSSARY_STATUSES).toContain(entry.status);
      expect(entry.text === '', `${locale} ${key}`).toBe(entry.status === 'untranslated');
    }
  });
});
