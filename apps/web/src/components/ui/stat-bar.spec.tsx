import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatBar, statLead } from './stat-bar';

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

  it('splits the bar by share from the inline start, the larger side in ink and bolder (T-1800)', () => {
    const html = bar(10, 4);
    expect(html).toContain('data-lead="home"');
    expect(html).toMatch(/bg-fg" style="inline-size:71\.42\d*%" data-side="home"/);
    expect(html).toMatch(/bg-caption" style="inline-size:28\.57\d*%" data-side="away"/);
    expect(html.indexOf('data-side="home"')).toBeLessThan(html.indexOf('data-side="away"'));
    expect(html).toMatch(/font-black text-fg"><span dir="ltr">10</);
    expect(html).toMatch(/font-semibold text-muted text-end"><span dir="ltr">4</);
    // Whichever side it is: the away side ahead takes the ink.
    const away = bar(3, 9);
    expect(away).toContain('data-lead="away"');
    expect(away).toMatch(/bg-caption" style="inline-size:25%" data-side="home"/);
    expect(away).toMatch(/bg-fg" style="inline-size:75%" data-side="away"/);
    // Decoration: the figures say it.
    expect(html).toMatch(/<div aria-hidden="true" class="flex h-1\.5/);
  });

  it('marks no side on a tie, or where more is not better (fouls, cards)', () => {
    const plain = renderToStaticMarkup(
      <StatBar label="Fouls" home={18} away={10} homeText="18" awayText="10" emphasis="none" />,
    );
    for (const html of [plain, bar(5, 5)]) {
      expect(html).toContain('data-lead="none"');
      expect(html).not.toContain('bg-fg');
      expect(html).not.toContain('font-black');
    }
    expect(statLead(18, 10, 'none')).toBeNull();
    expect(statLead(null, 3)).toBeNull();
    expect(statLead(1, 2)).toBe('away');
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
