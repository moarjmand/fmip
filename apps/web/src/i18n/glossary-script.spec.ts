import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `i18n:glossary` (T-1011, D-130), run against a scratch catalogue and
 * glossary so the committed files are never touched. What matters most is
 * what it refuses to do: it never writes a target term, never drops a term
 * that carries one, and fails a translated entry with no status.
 */
const SCRIPT = join(__dirname, '..', '..', 'scripts', 'i18n-glossary.mjs');
const TEAM = '00000000-0000-4000-8000-000000000101';

let dir: string;
let catalogues: string;
let glossary: string;

function run(...args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(
      process.execPath,
      [SCRIPT, '--catalogues', catalogues, '--glossary', glossary, ...args],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return { code: 0, out };
  } catch (error) {
    const failed = error as { status: number; stdout: string; stderr: string };
    return { code: failed.status, out: `${failed.stdout}${failed.stderr}` };
  }
}

const read = (locale: string) =>
  JSON.parse(readFileSync(join(glossary, `${locale}.json`), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >;
const write = (path: string, value: unknown) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'glossary-'));
  catalogues = join(dir, 'catalogues');
  glossary = join(dir, 'glossary');
  mkdirSync(catalogues);
  mkdirSync(glossary);
  write(join(catalogues, 'en.json'), {
    'a.one': 'A clean sheet for the goalkeeper',
    'a.two': { one: '{count} goal', other: '{count} goals' },
    'a.three': 'Home',
  });
  write(join(catalogues, 'ar.json'), {});
  write(join(catalogues, 'fr.json'), {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('i18n:glossary', () => {
  it('adds the football terms the catalogue uses, as untranslated, with an empty term', () => {
    expect(run().code).toBe(0);
    expect(Object.keys(read('en'))).toEqual(['term.clean-sheet', 'term.goal', 'term.goalkeeper']);
    for (const locale of ['ar', 'fr']) {
      for (const entry of Object.values(read(locale))) {
        expect(entry).toMatchObject({ text: '', status: 'untranslated', locked: false });
      }
    }
    expect(read('fr')['term.goal']).toMatchObject({ source: 'goal' });
    expect(run('--check').code).toBe(0);
  });

  it('adds entity names as locked terms keyed by id, never by name, and still writes no target', () => {
    run();
    const names = join(dir, 'names.json');
    write(names, [{ type: 'team', id: TEAM, name: 'Esteghlal' }]);
    expect(run('--entities', names).code).toBe(0);
    expect(read('en')[`team.${TEAM}`]).toEqual({ kind: 'team', source: 'Esteghlal', locked: true });
    expect(read('ar')[`team.${TEAM}`]).toEqual({
      source: 'Esteghlal',
      locked: true,
      text: '',
      status: 'untranslated',
    });
    // A later run without the export keeps the name: the export is additive.
    expect(run().code).toBe(0);
    expect(read('ar')[`team.${TEAM}`]).toBeDefined();
  });

  it("keeps a translator's term, status and note exactly as they left them", () => {
    run();
    const ar = read('ar');
    ar['term.goal'] = { ...ar['term.goal'], text: 'هدف', status: 'translated', note: 'n' };
    write(join(glossary, 'ar.json'), ar);
    // The English gains a locked flag a person set; the refresh carries it over.
    const en = read('en');
    en['term.goal'] = { ...en['term.goal'], locked: true };
    write(join(glossary, 'en.json'), en);
    expect(run().code).toBe(0);
    expect(read('ar')['term.goal']).toEqual({
      source: 'goal',
      locked: true,
      text: 'هدف',
      status: 'translated',
      note: 'n',
    });
  });

  it('fails a translated entry with no status, and a status the term does not support', () => {
    run();
    const ar = read('ar');
    ar['term.goal'] = { source: 'goal', locked: false, text: 'هدف' };
    ar['term.goalkeeper'] = { ...ar['term.goalkeeper'], status: 'reviewed' };
    write(join(glossary, 'ar.json'), ar);
    const result = run('--check');
    expect(result.code).toBe(1);
    expect(result.out).toContain('term.goal carries a term but no status');
    expect(result.out).toContain('term.goalkeeper has status "reviewed" but no term');
    // And a refresh does not paper over it by writing the file.
    expect(run().code).toBe(1);
    expect(read('ar')['term.goal']).not.toHaveProperty('status');
  });

  it('refuses to drop a term the catalogue stopped using while a locale carries words for it', () => {
    run();
    const fr = read('fr');
    fr['term.clean-sheet'] = {
      ...fr['term.clean-sheet'],
      text: 'blanchissage',
      status: 'translated',
    };
    write(join(glossary, 'fr.json'), fr);
    write(join(catalogues, 'en.json'), {
      'a.two': { one: '{count} goal', other: '{count} goals' },
    });
    const result = run();
    expect(result.code).toBe(1);
    expect(result.out).toContain('"term.clean-sheet" is no longer used by the catalogue');
    // A term nobody translated goes quietly.
    fr['term.clean-sheet'] = { ...fr['term.clean-sheet'], text: '', status: 'untranslated' };
    write(join(glossary, 'fr.json'), fr);
    expect(run().code).toBe(0);
    expect(Object.keys(read('en'))).toEqual(['term.goal']);
  });

  it('fails the check on a stale file', () => {
    run();
    write(join(catalogues, 'en.json'), { 'a.four': 'Offside', 'a.one': 'A clean sheet' });
    const result = run('--check');
    expect(result.code).toBe(1);
    expect(result.out).toContain('out of step');
  });
});
