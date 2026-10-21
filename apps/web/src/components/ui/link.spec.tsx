import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Link from './link';

/**
 * The internal link (T-1456): viewport prefetching off by default, a caller's
 * own choice kept, every other prop passed through. `next/link` is replaced
 * by an anchor that says what prefetch it was given, because the prefetch
 * itself happens only in a production browser.
 */
vi.mock('next/link', () => ({
  default: ({ prefetch, href, ...rest }: ComponentProps<'a'> & { prefetch?: unknown }) => (
    <a href={String(href)} data-prefetch={String(prefetch)} {...rest} />
  ),
}));

describe('Link', () => {
  it('does not prefetch unless asked', () => {
    const html = renderToStaticMarkup(<Link href="/en/scores">Scores</Link>);
    expect(html).toBe('<a href="/en/scores" data-prefetch="false">Scores</a>');
  });

  it('keeps a prefetch the caller asks for', () => {
    expect(renderToStaticMarkup(<Link href="/en" prefetch />)).toContain('data-prefetch="true"');
    expect(renderToStaticMarkup(<Link href="/en" prefetch="auto" />)).toContain(
      'data-prefetch="auto"',
    );
  });

  it('passes every other prop through', () => {
    const html = renderToStaticMarkup(
      <Link href="/fa" className="underline" data-testid="nav-home" aria-current="page">
        Home
      </Link>,
    );
    expect(html).toContain('class="underline"');
    expect(html).toContain('data-testid="nav-home"');
    expect(html).toContain('aria-current="page"');
  });
});
