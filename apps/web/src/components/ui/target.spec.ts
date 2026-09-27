import { describe, expect, it } from 'vitest';
import { inlineTargetClasses } from './target';

describe('inlineTargetClasses', () => {
  it('gives an inline link a box of at least 24 x 24 pixels, centred on its text', () => {
    const classes = inlineTargetClasses().split(' ');
    expect(classes).toEqual(
      expect.arrayContaining(['inline-flex', 'min-h-6', 'min-w-6', 'items-center']),
    );
  });

  it("keeps the caller's own classes", () => {
    expect(inlineTargetClasses('font-medium underline')).toMatch(/ font-medium underline$/);
  });

  it('uses no physical inline-direction class, so it holds under RTL', () => {
    expect(inlineTargetClasses()).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});
