import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-1536: a stylesheet `global-error.tsx` imports is written into every page's
 * HTML, inside the RSC payload, whether or not anything fails -- the page's
 * own stylesheet a second time (83 kB, 12 kB of the match page's gzip). So the
 * boundary imports none, and its body brings the styles when it is drawn.
 */

const APP = __dirname;
const read = (name: string) => readFileSync(join(APP, name), 'utf8');

describe('the last boundary', () => {
  it('imports no stylesheet itself', () => {
    expect(read('global-error.tsx')).not.toMatch(/^import\s+['"][^'"]+['"];/m);
  });

  it('loads its body, which brings the styles, only when it is drawn', () => {
    expect(read('global-error.tsx')).toMatch(
      /dynamic\(\(\) =>\s*import\('\.\/global-error-body'\)/,
    );
    const body = read('global-error-body.tsx');
    expect(body).toContain("import './globals.css';");
    expect(body).toContain("import '@fontsource-variable/vazirmatn';");
    expect(body).toContain("import '@fontsource-variable/archivo/wdth.css';");
  });
});
