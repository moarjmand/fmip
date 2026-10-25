import type { CoverageState } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoverageBadge } from './coverage-badge';

/**
 * The coverage badge (rule 3; the Design System's `CoverageBadge`, T-1493):
 * every state said in a word and a glyph of its own, never by hue alone.
 */

const STATES: CoverageState[] = ['available', 'limited', 'not_supplied', 'delayed'];
const badge = (state: CoverageState, label: string = state) =>
  renderToStaticMarkup(<CoverageBadge state={state} label={label} />);

describe('CoverageBadge', () => {
  it('names its state for the page and for specs', () => {
    for (const state of STATES) expect(badge(state)).toContain(`data-coverage-badge="${state}"`);
  });

  it('gives each of the four states its own glyph, and the words the caller gave', () => {
    const glyphs = STATES.map((state) => {
      const html = badge(state);
      expect(html).toContain(`data-icon="${state}"`);
      // The glyph inside the ring is what tells them apart.
      return html.slice(html.indexOf('<circle'), html.indexOf('</svg>'));
    });
    expect(new Set(glyphs).size).toBe(4);
    expect(badge('limited', 'partial data')).toContain('>partial data</span>');
  });

  it('is one quiet colour for all four: the state rests on the glyph and the word', () => {
    for (const state of STATES) {
      const html = badge(state);
      expect(html).toContain('text-muted');
      expect(html).not.toMatch(/text-(?:warning|success|danger|model)/);
    }
  });

  it('draws delayed, the one still expected, on a dashed edge', () => {
    expect(badge('delayed')).toContain('border-dashed border-caption');
    for (const state of STATES.filter((s) => s !== 'delayed')) {
      expect(badge(state)).toContain('border-default');
      expect(badge(state)).not.toContain('border-dashed');
    }
  });

  it('is a pill whose glyph is hidden from screen readers, so the word is what is read', () => {
    const html = badge('not_supplied', 'not supplied');
    expect(html).toContain('rounded-pill');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('first-letter:uppercase');
  });

  it('keeps a fallback English word in its own order inside a right-to-left line', () => {
    expect(badge('limited')).toMatch(/^<span dir="auto"/);
  });

  it('writes no colour of its own and no physical side', () => {
    const html = STATES.map((state) => badge(state)).join('');
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|\b(?:ml|mr|pl|pr|left|right)-/i);
  });
});
