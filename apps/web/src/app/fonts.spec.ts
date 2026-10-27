import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T-601: the site's fonts are served from this site. No request leaves it for
 * a font -- not at build time and not in a reader's browser. Vazirmatn since
 * D-089; Newsreader, Geist Mono and Markazi Text since the Hybrid design
 * (T-1380, D-198) and Archivo since the Stadiomind one (T-1491, D-263), each
 * checked the same way.
 */

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const OFF_SITE = /fonts\.googleapis|fonts\.gstatic|next\/font\/google|use\.typekit|fonts\.bunny/;
const LAYOUT = readFileSync(join(WEB, 'src/app/[locale]/layout.tsx'), 'utf8');
const GLOBALS = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8');

/**
 * Each stylesheet the layout imports, and the subsets it must carry: the
 * scripts the family is used for (Latin for the English families, Arabic and
 * Latin for the two that draw Persian).
 */
const FACES: [stylesheet: string, family: string, subsets: string[]][] = [
  ['@fontsource-variable/vazirmatn', 'Vazirmatn Variable', ['arabic', 'latin-wght']],
  ['@fontsource-variable/archivo/wdth.css', 'Archivo Variable', ['latin-wdth']],
  ['@fontsource-variable/newsreader', 'Newsreader Variable', ['latin-wght-normal']],
  ['@fontsource-variable/newsreader/wght-italic.css', 'Newsreader Variable', ['latin-wght-italic']],
  ['@fontsource-variable/geist-mono', 'Geist Mono Variable', ['latin-wght']],
  ['@fontsource-variable/markazi-text', 'Markazi Text Variable', ['arabic', 'latin-wght']],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('the site fonts', () => {
  it('are never fetched from another host: nothing in the source or the build config names one', () => {
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

  it.each(FACES)(
    '%s: @font-face rules that point only at the package’s own files, and swap',
    (stylesheet, family, subsets) => {
      const require = createRequire(join(WEB, 'package.json'));
      const css = readFileSync(require.resolve(stylesheet), 'utf8');
      const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(([, url]) => url ?? '');
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(url).toMatch(/^\.\/files\/[\w-]+\.woff2$/);
      // Each script its own subset, downloaded only for a page that shows it.
      for (const subset of subsets) {
        expect(
          urls.some((url) => url.includes(`-${subset}`)),
          subset,
        ).toBe(true);
      }
      expect(css.match(/unicode-range:/g)?.length).toBe(urls.length);
      expect(css.match(/font-display:\s*swap;/g)?.length).toBe(urls.length);
      expect(css).toContain(`font-family: '${family}';`);
    },
  );

  it('are imported by the layout every locale renders through', () => {
    for (const [stylesheet] of FACES) expect(LAYOUT).toContain(`import '${stylesheet}';`);
  });

  it('are each named first in the stack of their role, their matched fallback second', () => {
    expect(GLOBALS).toMatch(
      /--font-sans:\s*'Vazirmatn Variable',\s*'Vazirmatn Fallback',\s*system-ui/,
    );
    expect(GLOBALS).toMatch(
      /--font-latin:\s*'Archivo Variable',\s*'Archivo Fallback',\s*system-ui/,
    );
    expect(GLOBALS).toMatch(/--font-serif:\s*'Newsreader Variable',\s*'Newsreader Fallback',/);
    expect(GLOBALS).toMatch(
      /--font-naskh:\s*'Markazi Text Variable',\s*'Markazi Text Fallback',\s*'Vazirmatn Variable'/,
    );
    expect(GLOBALS).toMatch(/--font-mono:\s*'Geist Mono Variable',\s*'Geist Mono Fallback',/);
  });

  it('fetch no Persian face for a Latin page: its stacks name none (T-1464)', () => {
    for (const role of ['--font-latin', '--font-serif']) {
      const stack = new RegExp(`${role}:([^;]*);`).exec(GLOBALS)?.[1] ?? '';
      expect(stack, role).toContain('Variable');
      expect(stack, role).not.toContain('Vazirmatn');
      expect(stack, role).not.toContain('Markazi');
    }
  });

  it('have their fallbacks as local faces scaled to their metrics, which download nothing (T-1463)', () => {
    for (const family of [
      'Archivo Fallback',
      'Newsreader Fallback',
      'Geist Mono Fallback',
      'Vazirmatn Fallback',
      'Markazi Text Fallback',
    ]) {
      const start = GLOBALS.indexOf(`font-family: '${family}';`);
      expect(start, family).toBeGreaterThan(0);
      const rules = GLOBALS.slice(start, GLOBALS.indexOf('}', start));
      expect(rules, family).toMatch(/src: local\('[^']+'\)(, local\('[^']+'\))*;/);
      expect(rules, family).not.toContain('url(');
      for (const descriptor of [
        'size-adjust',
        'ascent-override',
        'descent-override',
        'unicode-range',
      ]) {
        expect(rules, `${family} ${descriptor}`).toContain(`${descriptor}:`);
      }
    }
  });

  it('give Archivo a fallback for every weight and width the interface draws, Arial Bold from 550 up (T-1536)', () => {
    const faces = [
      ...GLOBALS.matchAll(/@font-face \{([^}]*font-family: 'Archivo Fallback';[^}]*)\}/g),
    ].map(([, body = '']) => {
      const range = (name: string, single: number) => {
        const value = new RegExp(`${name}: ([\\d.]+)%? ?([\\d.]+)?%?;`).exec(body);
        return value === null ? [single, single] : [Number(value[1]), Number(value[2] ?? value[1])];
      };
      const number = (name: string) => Number(new RegExp(`${name}: ([\\d.]+)%;`).exec(body)?.[1]);
      return {
        stretch: range('font-stretch', 100),
        weight: range('font-weight', 400),
        bold: body.includes("local('Arial Bold')"),
        size: number('size-adjust'),
        ascent: number('ascent-override'),
        descent: number('descent-override'),
      };
    });
    const used = [
      [75, [400, 700, 800, 900]],
      [87.5, [400, 600, 700]],
      [100, [400, 500, 600, 700, 800, 900]],
      [112.5, [700, 800]],
      [125, [850]],
    ] as const;
    for (const [stretch, weights] of used) {
      for (const weight of weights) {
        const matching = faces.filter(
          (face) =>
            face.stretch[0]! <= stretch &&
            stretch <= face.stretch[1]! &&
            face.weight[0]! <= weight &&
            weight <= face.weight[1]!,
        );
        expect(matching.length, `${stretch}% at ${weight}`).toBe(1);
        // A synthetic bold of the regular is narrower than Archivo's bold.
        expect(matching[0]!.bold, `${stretch}% at ${weight}`).toBe(weight >= 550);
      }
    }
    // Archivo's ascent and descent, whatever each face is scaled by.
    for (const face of faces) {
      expect((face.ascent * face.size) / 100).toBeCloseTo(87.8, 0);
      expect((face.descent * face.size) / 100).toBeCloseTo(21, 0);
    }
  });

  it('follow the page’s script: Archivo for a Latin page, Markazi Text for Persian display', () => {
    const latin = /:root:not\(:lang\(fa\), :lang\(ar\)\) \{([^}]*)\}/.exec(GLOBALS)?.[1] ?? '';
    expect(latin).toContain('--font-sans: var(--font-latin);');
    const arabic = /:root:is\(:lang\(fa\), :lang\(ar\)\) \{([^}]*)\}/.exec(GLOBALS)?.[1] ?? '';
    expect(arabic).toContain('--font-serif: var(--font-naskh);');
    expect(arabic).toContain('--font-article: var(--font-sans);');
  });

  it('have a scale of seven interface sizes and a named editorial and display scale, and no others', () => {
    expect(GLOBALS).toContain('--text-*: initial;');
    // The type block: the first @theme, where the sizes are declared.
    const theme = /@theme \{([\s\S]*?)\n\}/.exec(GLOBALS)?.[1] ?? '';
    const sizes = [...theme.matchAll(/--text-([a-z0-9-]+):/g)]
      .map(([, name]) => name ?? '')
      .filter((name) => !name.includes('--'));
    expect(sizes).toEqual([
      'xs',
      'sm',
      'base',
      'lg',
      'xl',
      '2xl',
      '3xl',
      // D-198: an article's body, then the display steps from 28px to 168px.
      'article',
      'display-1',
      'display-2',
      'display-3',
      'display-4',
      'display-5',
      'display-6',
      'display-7',
    ]);
    // Each step larger than the one before.
    const rem = (name: string) =>
      Number(new RegExp(`--text-${name}: ([\\d.]+)rem;`).exec(theme)?.[1] ?? NaN);
    const display = sizes.filter((name) => name.startsWith('display-')).map(rem);
    display.forEach((size, index) => {
      if (index > 0) expect(size).toBeGreaterThan(display[index - 1] ?? Infinity);
    });
    // A class for a size the scale dropped would silently render unstyled.
    const outside = files(join(WEB, 'src')).filter(
      (path) => path.endsWith('.tsx') && /\btext-[4-9]xl\b/.test(readFileSync(path, 'utf8')),
    );
    expect(outside).toEqual([]);
  });
});
