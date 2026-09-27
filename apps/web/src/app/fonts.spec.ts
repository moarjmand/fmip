import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T-601: the site font is Vazirmatn, served from this site. No request leaves
 * it for a font -- not at build time and not in a reader's browser.
 */

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const OFF_SITE = /fonts\.googleapis|fonts\.gstatic|next\/font\/google|use\.typekit|fonts\.bunny/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('the site font', () => {
  it('is never fetched from another host: nothing in the source or the build config names one', () => {
    const scanned = [
      ...files(join(WEB, 'src')).filter(
        (path) => /\.(tsx?|css|mjs)$/.test(path) && !path.endsWith('fonts.spec.ts'),
      ),
      ...files(join(WEB, 'public')).filter((path) => /\.(js|json|svg|webmanifest)$/.test(path)),
      ...['next.config.ts', 'postcss.config.mjs', 'package.json', 'Dockerfile'].map((name) =>
        join(WEB, name),
      ),
    ];
    expect(scanned.length).toBeGreaterThan(50);
    const offenders = scanned.filter((path) => OFF_SITE.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('comes from a package whose @font-face rules point only at its own files', () => {
    const require = createRequire(join(WEB, 'package.json'));
    const css = readFileSync(require.resolve('@fontsource-variable/vazirmatn'), 'utf8');
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(([, url]) => url ?? '');
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/^\.\/files\/[\w-]+\.woff2$/);
    // Arabic and Latin, each its own subset, swapped in when it arrives.
    expect(urls.some((url) => url.includes('arabic'))).toBe(true);
    expect(urls.some((url) => url.includes('latin-wght'))).toBe(true);
    expect(css.match(/font-display:\s*swap;/g)?.length).toBe(urls.length);
  });

  it('is imported by the layout every locale renders through and named first in the stack', () => {
    const layout = readFileSync(join(WEB, 'src/app/[locale]/layout.tsx'), 'utf8');
    expect(layout).toContain("import '@fontsource-variable/vazirmatn';");
    const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8');
    expect(globals).toMatch(/--font-sans:\s*'Vazirmatn Variable',\s*system-ui/);
  });

  it('has a type scale of seven sizes and no others', () => {
    const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8');
    expect(globals).toContain('--text-*: initial;');
    const sizes = [...globals.matchAll(/--text-([a-z0-9]+):/g)].map(([, name]) => name);
    expect(sizes).toEqual(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl']);
    // A class for a size the scale dropped would silently render unstyled.
    const outside = files(join(WEB, 'src')).filter(
      (path) => path.endsWith('.tsx') && /\btext-[4-9]xl\b/.test(readFileSync(path, 'utf8')),
    );
    expect(outside).toEqual([]);
  });
});
