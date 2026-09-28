import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorPageBody, errorPageLocale } from './error-page';

/**
 * The error pages' shared body (T-809). The document around it carries
 * `lang` and `dir` (the locale layout, or `global-error` itself); these
 * guard the locale it is told and what it offers.
 */

describe('errorPageLocale', () => {
  it('takes the route param when it is a shipped locale', () => {
    expect(errorPageLocale('ar')).toBe('ar');
    expect(errorPageLocale('x-rtl', '/en/whatever')).toBe('x-rtl');
  });

  it('falls back to the path when the param is gone, then to the default', () => {
    expect(errorPageLocale(undefined, '/ar/match/x')).toBe('ar');
    expect(errorPageLocale(undefined, '/x-rtl')).toBe('x-rtl');
    expect(errorPageLocale('zz', '/zz/nothing')).toBe('en');
    expect(errorPageLocale(undefined, null)).toBe('en');
    expect(errorPageLocale(['en'])).toBe('en');
  });
});

describe('ErrorPageBody', () => {
  it('says a page is missing, with a way back in the same locale, and no retry', () => {
    const html = renderToStaticMarkup(<ErrorPageBody locale="en" kind="not-found" />);
    expect(html).toContain('Page not found');
    expect(html).toContain('href="/en/scores"');
    expect(html).not.toContain('error-retry');
  });

  it('offers to try again only for a failure that was handed a retry', () => {
    const html = renderToStaticMarkup(
      <ErrorPageBody locale="en" kind="failed" onRetry={() => undefined} />,
    );
    expect(html).toContain('This page could not be shown');
    expect(html).toContain('data-testid="error-retry"');
    expect(renderToStaticMarkup(<ErrorPageBody locale="en" kind="failed" />)).not.toContain(
      'error-retry',
    );
  });

  it('marks English it falls back to on an untranslated locale', () => {
    const html = renderToStaticMarkup(<ErrorPageBody locale="ar" kind="not-found" />);
    expect(html).toContain('href="/ar/scores"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('data-translation="untranslated"');
  });
});
