import { describe, expect, it } from 'vitest';
import { BRAND_COLOURS } from '@/lib/brand-colours';
import { BAND_MIN_CONTRAST, bandColours, contrast, darken, luminance } from './band-colour';

/** The club band's paint (T-1418, D-204, D-218): every text on it at 4.5:1 or more. */

const WHITE = BRAND_COLOURS['on-accent'];
const INK = BRAND_COLOURS.text;

describe('contrast', () => {
  it('matches D-204’s reference figures', () => {
    expect(contrast(WHITE, '#000000')).toBeCloseTo(21, 5);
    expect(contrast(WHITE, '#0b6b3a')).toBeCloseTo(6.61, 2);
    expect(contrast(WHITE, '#c41f17')).toBeCloseTo(5.91, 2);
    expect(contrast(INK, '#c41f17')).toBeCloseTo(3.1, 1);
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
  });

  it('darkens towards black', () => {
    expect(darken('#ffffff', 0.5)).toBe('#808080');
    expect(darken('#da291c', 1)).toBe('#000000');
    expect(darken('#da291c', 0)).toBe('#da291c');
  });
});

describe('bandColours', () => {
  it('puts white on a dark club colour and the ink on a light one, unchanged', () => {
    expect(bandColours('#c41f17')).toEqual({ fill: '#c41f17', text: WHITE });
    expect(bandColours('#ffffff')).toEqual({ fill: '#ffffff', text: INK });
    expect(bandColours('#ffe600')).toEqual({ fill: '#ffe600', text: INK });
  });

  it('darkens a colour neither text reaches until white does', () => {
    // A mid orange: white about 3:1, the ink about 5.9:1 -- the ink is enough.
    const orange = bandColours('#e87d1e');
    expect(orange?.fill).toBe('#e87d1e');
    expect(orange?.text).toBe(INK);
    // A mid green neither text reaches: darkened in steps, white on it.
    expect(Math.max(contrast('#3a8a55', WHITE), contrast('#3a8a55', INK))).toBeLessThan(4.5);
    const green = bandColours('#3a8a55');
    expect(green?.text).toBe(WHITE);
    expect(green?.fill).not.toBe('#3a8a55');
    expect(contrast(green!.fill, WHITE)).toBeGreaterThanOrEqual(BAND_MIN_CONTRAST);
  });

  it('reaches 4.5:1 for every colour on a grid of the cube', () => {
    const steps = ['00', '33', '66', '99', 'cc', 'ff', '7f', 'b3'];
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const paint = bandColours(`#${r}${g}${b}`);
          expect(paint).not.toBeNull();
          expect(contrast(paint!.fill, paint!.text)).toBeGreaterThanOrEqual(BAND_MIN_CONTRAST);
        }
      }
    }
  });

  it('refuses anything that is not #rrggbb in lower case', () => {
    for (const bad of ['', 'red', '#fff', '#DA291C', 'da291c', '#da291cff']) {
      expect(bandColours(bad)).toBeNull();
    }
  });
});
