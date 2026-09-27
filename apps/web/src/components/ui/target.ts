import { cx } from './cx';

/**
 * A link that sits inside a dense line of text (a fixture line, a "where to
 * watch" line) and still meets WCAG 2.2's 24 x 24 minimum target size
 * (axe `target-size`). At `text-xs` or `text-sm` a bare inline link is 16 to
 * 20 pixels tall, so two lines of them stacked or wrapped leave targets too
 * small and too close; this makes the link's own box at least 24 pixels each
 * way, centred on its text, without changing how the line reads.
 */
const INLINE_TARGET = 'inline-flex min-h-6 min-w-6 items-center';

export function inlineTargetClasses(className?: string): string {
  return cx(INLINE_TARGET, className);
}
