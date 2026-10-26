import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AtApart, ModelVersion, ModelVersions } from './model-version';

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

describe('several versions, and a line that carries one (T-1580)', () => {
  // What the coordinator's check reads: a version written as one run.
  const RUN = /\S+@\d+\.\d+\.\d+/;
  const text = (html: string) => html.replace(/<[^>]+>/g, '');

  it('joins versions with commas, each with its @ set apart', () => {
    const html = renderToStaticMarkup(
      <ModelVersions versions={['dixon-coles-elo@0.6.0', 'dixon-coles@0.5.1']} />,
    );
    expect(html).not.toMatch(RUN);
    expect(text(html)).toBe('dixon-coles-elo@0.6.0, dixon-coles@0.5.1');
  });

  it('sets every @ in a line apart, and leaves a line without one as it is', () => {
    const line = 'dixon-coles-elo@0.6.0 · v3 computed 24 Oct · old@1.2.3';
    const html = renderToStaticMarkup(<AtApart text={line} />);
    expect(line).toMatch(RUN);
    expect(html).not.toMatch(RUN);
    expect(text(html)).toBe(line);
    expect(renderToStaticMarkup(<AtApart text="v3 computed" />)).toBe('v3 computed');
  });
});
