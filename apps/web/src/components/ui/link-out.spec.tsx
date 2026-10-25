import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinkOut } from './link-out';

/** A link off the site (T-1388): it always names who hosts the destination. */

describe('LinkOut', () => {
  it('always names who hosts the destination, with the external-link mark', () => {
    const inline = renderToStaticMarkup(<LinkOut href="https://example.org/tv3" host="IRIB TV3" />);
    expect(inline).toContain('href="https://example.org/tv3"');
    expect(inline).toContain('rel="noopener noreferrer"');
    expect(inline).toContain('<bdi>IRIB TV3</bdi>');
    expect(inline).toContain('data-icon="external"');
    const button = renderToStaticMarkup(
      <LinkOut href="https://example.org/clip" host="the publisher" look="button" icon="play">
        Official highlights
      </LinkOut>,
    );
    expect(button).toContain('Official highlights (<bdi>the publisher</bdi>)');
    expect(button).toContain('min-h-touch');
  });
});
