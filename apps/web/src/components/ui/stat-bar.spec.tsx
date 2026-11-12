import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatBar } from './stat-bar';

/** One statistic between the two sides (the Design System's `StatBar`, T-1510). */

const bar = (home: number | null, away: number | null) =>
  renderToStaticMarkup(
    <StatBar
      label="Shots"
      home={home}
      away={away}
      homeText={home === null ? '–' : String(home)}
      awayText={away === null ? '–' : String(away)}
    />,
  );

describe('StatBar', () => {
  it('writes both figures at the ends and the name between, home first', () => {
    const html = bar(10, 4);
    expect(html).toMatch(/<span dir="ltr">10<\/span>.*Shots.*<span dir="ltr">4<\/span>/);
  });

  it('splits the bar by share: home in ink from the inline start, away in grey', () => {
    const html = bar(10, 4);
    expect(html).toMatch(/bg-fg" style="inline-size:71\.42\d*%" data-side="home"/);
    expect(html).toMatch(/bg-caption" style="inline-size:28\.57\d*%" data-side="away"/);
    expect(html.indexOf('data-side="home"')).toBeLessThan(html.indexOf('data-side="away"'));
    // Decoration: the figures say it.
    expect(html).toMatch(/<div aria-hidden="true" class="flex h-2/);
  });

  it('draws only the side that has any share at all', () => {
    expect(bar(3, 0)).not.toContain('data-side="away"');
    expect(bar(0, 3)).not.toContain('data-side="home"');
  });

  it('draws no bar when a side is missing or both are nothing, rather than an even split', () => {
    for (const html of [bar(null, 4), bar(5, null), bar(0, 0)]) {
      expect(html).not.toContain('data-side');
    }
    expect(bar(null, 4)).toContain('>–</span>');
  });

  it('never paints a club colour or a product colour, and writes no physical side', () => {
    const html = bar(10, 4);
    expect(html).not.toMatch(/bg-(model|founder|community|accent|brand)|style="[^"]*color/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|\b(?:ml|mr|pl|pr|left|right)-/i);
  });
});
