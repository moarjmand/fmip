import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buttonClasses } from '@/components/ui';
import { PickLink } from './pick-link';

/**
 * The way to a pick from a card (T-1741, D-362): an outlined link in the
 * saffron edge and ink, the `md` button's box, kept out of the client bundle.
 */
describe('the pick link', () => {
  const html = renderToStaticMarkup(
    <PickLink href="/en/match/m1#pick" testId="the-pick" className="max-sm:flex-1">
      Make your pick
    </PickLink>,
  );
  const classes = /class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];

  it('is a link to the pick card, outlined in the saffron edge and ink, never the fill', () => {
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="/en/match/m1#pick"');
    expect(html).toContain('data-testid="the-pick"');
    expect(classes).toContain('border-accent');
    expect(classes).toContain('text-accent');
    expect(classes).toContain('max-sm:flex-1');
    // One edge only: no second border colour to fight the first, and no fill.
    expect(classes.filter((c) => /^border-(?!accent$)[a-z]/.test(c))).toEqual([]);
    expect(classes.some((c) => c.startsWith('bg-'))).toBe(false);
  });

  it('keeps the md button’s box, so it presses like every other button (44px)', () => {
    // Everything of the secondary `md` button except its edge colour.
    const box = buttonClasses({ size: 'md' })
      .split(' ')
      .filter((c) => c !== 'border-strong' && !c.startsWith('disabled:'));
    for (const c of box) expect(classes).toContain(c);
    expect(classes).toContain('min-h-touch');
  });

  it('is drawn by server components only, so it adds nothing to the client bundle', () => {
    const source = readFileSync(join(__dirname, 'pick-link.tsx'), 'utf8');
    expect(source).not.toContain("'use client'");
    // The shared button module, which every page's client bundle carries, has no such variant.
    const button = readFileSync(join(__dirname, 'ui', 'button.tsx'), 'utf8');
    expect(button).not.toContain('border-accent font-bold text-accent');
  });
});
