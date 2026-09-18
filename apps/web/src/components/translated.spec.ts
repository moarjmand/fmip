import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Translated } from './translated';

// Rendered without JSX so the test needs no transform the app does not use.
function markup(props: Parameters<typeof Translated>[0]): string {
  return renderToStaticMarkup(createElement(Translated, props));
}

describe('Translated', () => {
  it('renders the source language as bare text', () => {
    expect(markup({ locale: 'en', message: 'nav.scores' })).toBe('Scores');
  });

  it('renders a translation as bare text, with no marking to inspect', () => {
    // The one string Arabic has: its own name (messages.spec.ts).
    const html = markup({ locale: 'ar', message: 'language.name.ar' });
    expect(html).toBe('العربية');
  });

  it('marks an untranslated fallback with the source language, its direction and a data attribute', () => {
    // On a right-to-left page the English must be isolated, or the bidi
    // algorithm hands its edge punctuation to the Arabic paragraph around it
    // and "Sign in?" renders as "?Sign in". `dir` is what isolates it.
    const html = markup({ locale: 'ar', message: 'nav.scores' });
    expect(html).toBe('<span lang="en" dir="ltr" data-translation="untranslated">Scores</span>');
  });

  it('marks an untranslated plural the same way as a sentence', () => {
    const html = markup({ locale: 'ar', message: 'friends.mutualCount', count: 3 });
    expect(html).toContain('<span lang="en" dir="ltr" data-translation="untranslated">');
    expect(html).toContain('3');
  });

  it('keeps the className on both paths', () => {
    expect(markup({ locale: 'ar', message: 'nav.scores', className: 'muted' })).toContain(
      'class="muted"',
    );
    expect(markup({ locale: 'ar', message: 'language.name.ar', className: 'muted' })).toBe(
      '<span class="muted">العربية</span>',
    );
  });
});
