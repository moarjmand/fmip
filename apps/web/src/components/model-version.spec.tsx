import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelVersion } from './model-version';

/**
 * A model version never reads as an e-mail address in the server's HTML
 * (T-1465), so Cloudflare's Email Obfuscation leaves it and its decoding
 * script off the page; the reader sees the same characters.
 */
// The pattern an obfuscator matches: local part, @, a dotted domain.
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

describe('ModelVersion', () => {
  it('writes the version so no address can be read in the HTML', () => {
    const html = renderToStaticMarkup(
      <span>
        <ModelVersion version="dixon-coles-elo@0.6.0" />
      </span>,
    );
    expect('dixon-coles-elo@0.6.0').toMatch(EMAIL);
    expect(html).not.toMatch(EMAIL);
    expect(html).toBe('<span>dixon-coles-elo<span>@</span>0.6.0</span>');
    expect(html.replace(/<[^>]+>/g, '')).toBe('dixon-coles-elo@0.6.0');
  });

  it('writes a version without an @ as it is', () => {
    expect(renderToStaticMarkup(<ModelVersion version="poisson-v1" />)).toBe('poisson-v1');
  });
});
