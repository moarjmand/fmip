import { use } from 'react';
import { DEFAULT_LOCALE, isLocale, localeFromPathname, type Locale } from '@/i18n/locales';
import type * as Messages from '@/i18n/messages';
import type { Message, MessageKey } from '@/i18n/messages';
import { useClientMessages } from '@/components/client-messages';
import { MessageText } from '@/components/message-text';
import { Button, ButtonLink } from '@/components/ui';

/**
 * What every error page says (T-809): a page that does not exist, and a page
 * that failed to render. Shared by `app/[locale]/not-found.tsx`,
 * `app/[locale]/error.tsx` and `app/global-error.tsx`, so the three read the
 * same and each is in the reader's language -- the first two inside the
 * locale layout, which owns `<html lang dir>`; the last in a document of its
 * own that sets them itself.
 *
 * No directive here: the callers are client components (an error boundary
 * must be one) and pass the locale they read from the router.
 *
 * **Where the words come from (T-1040).** Not from the catalogues: those stay
 * on the server, or every page would ship every language. The locale layout
 * resolves `ERROR_PAGE_KEYS` for the reader's locale and provides them
 * (`ClientMessagesProvider`); `error.tsx` and `not-found.tsx` render inside
 * that layout and read them from there. `global-error.tsx` replaces the
 * layout, provider and all, so `useErrorPageMessages` loads the catalogue
 * module itself for it -- with a dynamic import, which the bundler splits into
 * a chunk that only a failed layout ever fetches.
 */

/** Every key the error pages render: what the locale layout resolves for them. */
export const ERROR_PAGE_KEYS = [
  'error.notFound.title',
  'error.notFound.body',
  'error.failed.title',
  'error.failed.body',
  'error.failed.retry',
  'error.toScores',
] as const satisfies readonly MessageKey[];

export type ErrorPageMessages = Record<(typeof ERROR_PAGE_KEYS)[number], Message>;

let catalogues: Promise<typeof Messages> | undefined;

/**
 * The error pages' words in `locale`: the layout's, when there is a layout;
 * otherwise resolved from the catalogue module, loaded on demand. Suspends
 * while that loads -- on the server it is there at once, and in the browser
 * React keeps the server's HTML until it is -- so what renders is the same
 * resolution the server makes everywhere else, never English presumed.
 */
export function useErrorPageMessages(locale: Locale): ErrorPageMessages {
  const provided = useClientMessages(ERROR_PAGE_KEYS);
  if (provided !== null) return provided;
  const { resolveMessages } = use((catalogues ??= import('@/i18n/messages')));
  return resolveMessages(locale, ERROR_PAGE_KEYS);
}

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
  messages,
  onRetry,
}: {
  locale: Locale;
  kind: ErrorPageKind;
  /** Resolved for `locale`: `useErrorPageMessages`. */
  messages: ErrorPageMessages;
  /** Only a failed page offers to try again; a missing one would stay missing. */
  onRetry?: () => void;
}) {
  const title = kind === 'not-found' ? 'error.notFound.title' : 'error.failed.title';
  const body = kind === 'not-found' ? 'error.notFound.body' : 'error.failed.body';
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8" data-testid={`error-${kind}`}>
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <MessageText message={messages[title]} />
      </h1>
      <p>
        <MessageText message={messages[body]} />
      </p>
      <p className="flex flex-wrap gap-3">
        {kind === 'failed' && onRetry !== undefined ? (
          <Button variant="primary" onClick={onRetry} data-testid="error-retry">
            <MessageText message={messages['error.failed.retry']} />
          </Button>
        ) : null}
        <ButtonLink href={`/${locale}/scores`} data-testid="error-scores">
          <MessageText message={messages['error.toScores']} />
        </ButtonLink>
      </p>
    </main>
  );
}
