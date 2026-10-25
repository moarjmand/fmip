import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveBadge } from './live-badge';

/** The live badge (the Design System's `LiveBadge`, T-1493): a match in play, with its minute. */

describe('LiveBadge', () => {
  it('is a saffron pill with the minute in saffron as text', () => {
    const html = renderToStaticMarkup(<LiveBadge>67′</LiveBadge>);
    expect(html).toContain('data-live-badge=""');
    expect(html).toContain('rounded-pill bg-brand/14');
    expect(html).toContain('text-live');
    expect(html).toContain('tabular-nums');
    expect(html).toMatch(/>67′<\/span>$/);
  });

  it('says "Live" when the status does not already say it, and not otherwise', () => {
    expect(renderToStaticMarkup(<LiveBadge label="Live">67′</LiveBadge>)).toContain(
      '<span>Live · </span>67′',
    );
    expect(renderToStaticMarkup(<LiveBadge>Live</LiveBadge>)).not.toContain(' · ');
  });

  it('has a dot that pulses only where motion is welcome, hidden from screen readers', () => {
    const html = renderToStaticMarkup(<LiveBadge>12′</LiveBadge>);
    // `.live-dot` animates only under prefers-reduced-motion: no-preference
    // and without the member's own reduce (globals.css).
    expect(html).toMatch(/<span aria-hidden="true" class="live-dot [^"]*bg-brand"><\/span>/);
  });

  it('meets the badge height and writes no colour of its own and no physical side', () => {
    const html = renderToStaticMarkup(<LiveBadge label="زنده">۶۷′</LiveBadge>);
    expect(html).toContain('min-h-7.5');
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|\b(?:ml|mr|pl|pr|left|right)-/i);
  });
});
