import Link from 'next/link';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { attribute } from '@/i18n/messages';
import { fetchMe } from '@/lib/api';
import { logoutAction } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * The one navigation bar. Reads the session server-side; when the API is
 * unreachable the visitor is shown as signed out, which is the honest state:
 * nothing could be verified.
 *
 * Every label goes through `Translated` (T-151), which is what makes this the
 * worked example of the missing-string policy: on an unfinished locale the
 * English stands in and is marked `lang="en"`, rather than being shown as
 * though somebody had translated it.
 */
export async function SiteHeader({ locale }: { locale: string }) {
  const me = await fetchMe(await sessionCookieHeader());
  const href = (path: string) => `/${locale}${path}`;
  const search = attribute(isLocale(locale) ? locale : DEFAULT_LOCALE, 'nav.search');

  return (
    <header className="border-b border-current/20">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-3xl flex-wrap items-center gap-4 px-8 py-3 text-sm"
      >
        <Link href={href('')} className="font-semibold">
          FMIP
        </Link>
        <Link href={href('/scores')} data-testid="nav-scores">
          <Translated locale={locale} message="nav.scores" />
        </Link>
        <Link href={href('/predictions')} data-testid="nav-predictions">
          <Translated locale={locale} message="nav.predictions" />
        </Link>
        <Link href={href('/leaderboard')} data-testid="nav-leaderboard">
          <Translated locale={locale} message="nav.leaderboard" />
        </Link>
        <form action={href('/search')} method="get" role="search" className="me-auto">
          <label htmlFor="header-search" className="sr-only">
            <Translated locale={locale} message="nav.searchLabel" />
          </label>
          <input
            id="header-search"
            name="q"
            type="search"
            // The one place a fallback cannot be wrapped in a marked span, so
            // the marking goes on the input itself (see `attribute`).
            placeholder={search.text}
            lang={search.lang}
            autoComplete="off"
            className="w-32 rounded border border-current/30 bg-transparent px-2 py-1 text-sm sm:w-48"
            data-testid="nav-search"
          />
        </form>

        {me === null ? (
          <>
            <Link href={href('/login')}>
              <Translated locale={locale} message="nav.signIn" />
            </Link>
            <Link href={href('/register')} className="font-medium">
              Register
            </Link>
          </>
        ) : (
          <>
            <Link href={href('/friends')} data-testid="nav-friends">
              <Translated locale={locale} message="nav.friends" />
            </Link>
            <Link href={href('/messages')} data-testid="nav-messages">
              <Translated locale={locale} message="nav.messages" />
            </Link>
            <Link href={href('/groups')} data-testid="nav-groups">
              <Translated locale={locale} message="nav.groups" />
            </Link>
            <Link href={href(`/u/${encodeURIComponent(me.username)}`)} data-testid="nav-me">
              @{me.username}
            </Link>
            <Link href={href('/settings')}>
              <Translated locale={locale} message="nav.settings" />
            </Link>
            <form action={logoutAction.bind(null, locale)}>
              <button type="submit" className="underline">
                <Translated locale={locale} message="nav.signOut" />
              </button>
            </form>
          </>
        )}
      </nav>
    </header>
  );
}
