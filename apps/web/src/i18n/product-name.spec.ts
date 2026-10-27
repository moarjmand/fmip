import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';

/**
 * The product's public name is Stadiomind (T-1503, D-262). The working name
 * FMIP stays on the repository, the packages and the internals, never on
 * what a reader sees: every catalogue (the English source each translation
 * records as well as its text), the manifest and the service worker's
 * notification. `tests/e2e/product-name.spec.ts` checks the rendered pages.
 */

const CATALOGUES = join(__dirname, 'catalogues');
const WEB = join(__dirname, '..', '..');

describe('the product name', () => {
  it('is never the working name in a catalogue', () => {
    const files = readdirSync(CATALOGUES).filter((name) => name.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const file of files) {
      const text = readFileSync(join(CATALOGUES, file), 'utf8');
      expect(text.match(/FMIP/g) ?? [], file).toEqual([]);
    }
  });

  it('is Stadiomind in the English catalogue, and in Latin letters on /fa', () => {
    const en = readFileSync(join(CATALOGUES, 'en.json'), 'utf8');
    expect(en).toContain('"What Stadiomind is"');
    const fa = JSON.parse(readFileSync(join(CATALOGUES, 'fa.json'), 'utf8')) as Record<
      string,
      { source: string; text: string }
    >;
    expect(fa['about.meta.title']?.source).toBe('What Stadiomind is');
    expect(fa['about.meta.title']?.text).toContain('Stadiomind');
  });

  it('names the installed app and its notifications', () => {
    const installed = manifest();
    expect(installed.name).toBe('Stadiomind');
    expect(installed.short_name).toBe('Stadiomind');
    const worker = readFileSync(join(WEB, 'public', 'sw.js'), 'utf8');
    expect(worker).not.toMatch(/['"`]FMIP/);
    expect(worker).toContain("title: 'Stadiomind'");
  });
});
