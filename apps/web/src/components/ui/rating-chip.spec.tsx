import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RatingChip, ratingBand } from './rating-chip';

/** A player's match rating (the Design System's `RatingChip`, T-1510): four bands, the figure always written. */

const chip = (value: number, text = value.toFixed(1)) =>
  renderToStaticMarkup(<RatingChip value={value} text={text} />);

describe('RatingChip', () => {
  it.each([
    [5.9, 'low', 'bg-rating-low text-on-rating-low'],
    [6, 'mid', 'border border-default bg-surface-raised text-fg'],
    [6.9, 'mid', 'bg-surface-raised'],
    [7, 'good', 'bg-rating-good text-on-rating-good'],
    [7.9, 'good', 'bg-rating-good'],
    [8, 'top', 'bg-brand text-on-brand'],
    [9.6, 'top', 'bg-brand'],
  ] as const)('puts %s in the %s band', (value, band, classes) => {
    expect(ratingBand(value)).toBe(band);
    const html = chip(value);
    expect(html).toContain(`data-rating-band="${band}"`);
    expect(html).toContain(classes);
    expect(html).toContain(`>${value.toFixed(1)}</span>`);
  });

  it('writes the figure as the reader reads it', () => {
    expect(chip(7.4, '۷٫۴')).toContain('>۷٫۴</span>');
  });

  it('is a small condensed chip with tabular figures, and writes no colour of its own', () => {
    const html = chip(7.4);
    expect(html).toContain('rounded-sm');
    expect(html).toContain('tabular-nums');
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|\b(?:ml|mr|pl|pr|left|right)-/i);
  });
});
