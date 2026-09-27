import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The compare page's shape (T-631). It reads the source, the way the other
 * page guards here do: what matters is which branches exist and what each
 * renders, and that survives a change of markup.
 */

const HERE = __dirname;
const PLAYER = join(HERE, '..', 'app', '[locale]', 'player', '[id]');
const COMPARE = readFileSync(join(PLAYER, 'compare', 'page.tsx'), 'utf8');
const PLAYER_PAGE = readFileSync(join(PLAYER, 'page.tsx'), 'utf8');

describe('the way in', () => {
  it('puts a "Compare with…" search on the player page that lands on the compare page', () => {
    expect(PLAYER_PAGE).toContain('data-testid="compare-with"');
    expect(PLAYER_PAGE).toContain('Compare with…');
    expect(PLAYER_PAGE).toMatch(/action=\{`\$\{base\}\/compare`\}/);
    expect(PLAYER_PAGE).toContain('name="q"');
  });

  it('searches people only, through the existing search endpoint, and never offers the player itself', () => {
    expect(COMPARE).toContain('fetchSearch(ask)');
    expect(COMPARE).toContain('pickerQuery(term)');
    expect(COMPARE).toContain('h.id !== pageA.person.id');
    expect(COMPARE).toContain('compareHref(locale, pageA.person.id, hit.id)');
  });
});

describe('both players are real', () => {
  it('404s an id that is not a UUID, a malformed ?with= and a player the API does not know', () => {
    expect(COMPARE).toContain('if (!UUID.test(id)) notFound();');
    expect(COMPARE).toContain("if (other.state === 'malformed') notFound();");
    expect(COMPARE).toMatch(
      /a\.status === 404\) \|\| \(b !== null && !b\.ok && b\.status === 404\)\) notFound\(\)/,
    );
  });

  it('fetches both player pages in parallel', () => {
    expect(COMPARE).toMatch(/Promise\.all\(\[\s*fetchPlayer\(id, locale\),/);
  });

  it('says an unreachable API out loud instead of comparing nothing', () => {
    expect(COMPARE).toContain('data-testid="compare-unreachable"');
    expect(COMPARE).toContain('data-testid="compare-search-unreachable"');
  });

  it('is indexed only when both players exist and differ', () => {
    const metadata = /export async function generateMetadata[\s\S]*?\n}\n/.exec(COMPARE)?.[0] ?? '';
    expect(metadata).toContain('robots: { index: false, follow: false }');
    expect(metadata).toContain("other.state !== 'id'");
    expect(metadata).toContain('other.id === id.toLowerCase()');
    expect(metadata).toContain('if (!a.ok || !b.ok) return noindex;');
    // Only the one path that has both players goes through pageMetadata.
    expect(metadata.match(/pageMetadata\(/g)).toHaveLength(1);
  });
});

describe('a figure one side lacks', () => {
  it('renders every cell through cellText and marks its coverage', () => {
    expect(COMPARE).toContain('{cellText(c)}');
    expect(COMPARE).toContain('data-coverage={c.coverage}');
    expect(COMPARE).toContain('data-testid="compare-note"');
  });

  it('never prints a stand-in zero or dash for a missing value', () => {
    expect(COMPARE).not.toMatch(/\?\? 0\b/);
    expect(COMPARE).not.toMatch(/\?\? '[–-]'/);
    expect(COMPARE).not.toContain('|| 0');
  });
});

describe('RTL safety', () => {
  it('uses logical properties only', () => {
    for (const source of [COMPARE, PLAYER_PAGE]) {
      expect(source).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
      expect(source).not.toMatch(/\btext-(left|right)\b/);
      expect(source).not.toMatch(/\b(border-l|border-r)\b/);
    }
  });

  it('isolates the two names in the heading', () => {
    expect(COMPARE).toContain('<bdi>{nameA}</bdi> v <bdi>{nameB}</bdi>');
  });
});
