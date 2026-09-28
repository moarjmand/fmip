import { DEFAULT_LOCALE, isLocale, localeFromPathname, type Locale } from '@/i18n/locales';
import { Translated } from '@/components/translated';
import { Button, ButtonLink } from '@/components/ui';

/**
 * What every error page says (T-809): a page that does not exist, and a page
 * that failed to render. Shared by `app/[locale]/not-found.tsx`,
 * `app/[locale]/error.tsx` and `app/global-error.tsx`, so the three read the
 * same and each is in the reader's language -- the first two inside the
 * locale layout, which owns `<html lang dir>`; the last in a document of its
 * own that sets them itself.
 *
 * No hook and no directive here: the callers are client components (an error
 * boundary must be one) and pass the locale they read from the router.
 */

export type ErrorPageKind = 'not-found' | 'failed';

/**
 * The locale an error page speaks, from the route's `locale` param or, where
 * the layout that resolved it is gone (`global-error`), from the path. An
 * unknown one is the default locale, never a guess.
 */
export function errorPageLocale(param: unknown, pathname?: string | null): Locale {
  if (typeof param === 'string' && isLocale(param)) return param;
  if (typeof pathname === 'string') return localeFromPathname(pathname) ?? DEFAULT_LOCALE;
  return DEFAULT_LOCALE;
}

export function ErrorPageBody({
  locale,
  kind,
  onRetry,
}: {
  locale: Locale;
  kind: ErrorPageKind;
  /** Only a failed page offers to try again; a missing one would stay missing. */
  onRetry?: () => void;
}) {
  const title = kind === 'not-found' ? 'error.notFound.title' : 'error.failed.title';
  const body = kind === 'not-found' ? 'error.notFound.body' : 'error.failed.body';
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8" data-testid={`error-${kind}`}>
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={locale} message={title} />
      </h1>
      <p>
        <Translated locale={locale} message={body} />
      </p>
      <p className="flex flex-wrap gap-3">
        {kind === 'failed' && onRetry !== undefined ? (
          <Button variant="primary" onClick={onRetry} data-testid="error-retry">
            <Translated locale={locale} message="error.failed.retry" />
          </Button>
        ) : null}
        <ButtonLink href={`/${locale}/scores`} data-testid="error-scores">
          <Translated locale={locale} message="error.toScores" />
        </ButtonLink>
      </p>
    </main>
  );
}
