import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FindYourWay } from './find-your-way';
import { HowItWorks } from './how-it-works';

/** The direct children of the diagram's ordered list, by their test ids. */
function steps(html: string): string[] {
  return [...html.matchAll(/<li class="how-step[^"]*"[^>]*data-testid="([^"]+)"/g)].map(
    (match) => match[1] ?? '',
  );
}

describe('"How Stadiomind works" (T-1615, D-286)', () => {
  const en = renderToStaticMarkup(<HowItWorks locale="en" />);
  const fa = renderToStaticMarkup(<HowItWorks locale="fa" />);

  it('is an ordered list of six steps, so its words are its text equivalent', () => {
    expect(en).toContain('<ol class="how-flow"');
    expect(steps(en)).toEqual([
      'how-source',
      'how-record',
      'how-lanes',
      'how-kickoff',
      'how-settle',
      'how-outcomes',
    ]);
    expect(en).toContain('<figcaption');
    expect(en).toContain('Licensed match data');
    expect(en).toContain('Never blended into one number.');
  });

  it('puts the three products in separate lanes, and each builds its own record', () => {
    const lanes = [...en.matchAll(/class="how-lane how-tone--(\w+)/g)].map((m) => m[1]);
    const outcomes = [...en.matchAll(/class="how-outcome how-tone--(\w+)/g)].map((m) => m[1]);
    expect(lanes).toEqual(['model', 'founder', 'community']);
    expect(outcomes).toEqual(['model', 'founder', 'community']);
  });

  it('hides every wire and every gate mark from assistive technology', () => {
    const wires = [...en.matchAll(/<span ([^>]*)class="how-wire/g)].map((m) => m[1]);
    // One wire after each of the first five steps, and two per lane.
    expect(wires).toHaveLength(5 + 2 * 3);
    for (const attributes of wires) expect(attributes).toContain('aria-hidden="true"');
    const marks = [...en.matchAll(/<span ([^>]*)class="how-node/g)].map((m) => m[1]);
    expect(marks).toHaveLength(2 * 3);
    for (const attributes of marks) expect(attributes).toContain('aria-hidden="true"');
  });

  it('runs the lanes as three strands after they split, never one', () => {
    const strands = (wire: string) =>
      [...wire.matchAll(/class="how-strand how-tone--(\w+)"/g)].map((m) => m[1]);
    const nextWires = [...en.matchAll(/data-wire="next"[^]*?<\/svg>/g)].map((m) => strands(m[0]));
    expect(nextWires).toEqual([
      ['accent'],
      ['accent'],
      ['model', 'founder', 'community'],
      ['model', 'founder', 'community'],
      ['model', 'founder', 'community'],
    ]);
  });

  it('is all Persian on /fa, numbered in Persian digits', () => {
    // A key nobody translated renders marked `lang="en"` (T-151).
    expect(fa).not.toContain('lang="en"');
    expect(fa).toContain('سه پیش‌بینی، کنار هم');
    expect(fa).toContain('۰۱');
    expect(fa).toContain('۰۶');
    expect(en).toContain('>01<');
  });
});

describe('"Find your way" (T-1615, D-286)', () => {
  it('links every tile into the reader’s locale', () => {
    const fa = renderToStaticMarkup(<FindYourWay locale="fa" />);
    const hrefs = [...fa.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      '/fa/scores',
      '/fa/scores',
      '/fa/competitions',
      '/fa/news',
      '/fa/highlights',
      '/fa/watch',
      '/fa/model-accuracy',
      '/fa/scores#analysis',
      '/fa/scores?unpicked=1',
      '/fa/leaderboard',
    ]);
    expect(fa).not.toContain('lang="en"');
  });
});
