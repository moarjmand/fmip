import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { Translated } from '@/components/translated';
import { LanguagePicker } from '@/components/language-picker';
import { ThemeSwitch } from '@/components/theme-switch';
import { controlClasses } from '@/components/ui';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { attribute } from '@/i18n/messages';
import { fetchMe } from '@/lib/api';
import { offeredLanguages } from '@/lib/language-picker';
import { logoutAction } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import type { ThemePreference } from '@/lib/theme';

/**
 * The one navigation bar. Reads the session server-side; when the API is
 * unreachable the visitor is shown as signed out, which is the honest state:
 * nothing could be verified.
 *
 * Every label goes through `Translated` (T-151), which is what makes this the
 * worked example of the missing-string policy: on an unfinished locale the
 * English stands in and is marked `lang="en"`, rather than being shown as
 * though somebody had translated it.
 *
 * On a phone (T-605) it is one row: the mark, a guest's way in, and a Menu
 * disclosure (`<details>`, so no script is needed) holding the links, the
 * search, the member's own pages, Settings and the theme. From `sm` up the
 * disclosure is not a disclosure at all: `.site-menu` in globals.css lays its
 * contents inline in the bar, in the order they always had. There is one copy
 * of every link, so every `data-testid` is still one element.
 */
export async function SiteHeader({ locale, theme }: { locale: string; theme: ThemePreference }) {
  const me = await fetchMe(await sessionCookieHeader());
  const href = (path: string) => `/${locale}${path}`;
  const search = attribute(isLocale(locale) ? locale : DEFAULT_LOCALE, 'nav.search');
  // A thumb-sized row in the phone menu; inline text again from `sm`.
  const item = 'flex min-h-11 items-center sm:min-h-0';

  return (
    <header className="border-b border-default">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1 text-sm sm:px-8 sm:py-3"
      >
        <Link
          href={href('')}
          className="me-auto flex min-h-11 items-center gap-2 font-semibold sm:me-0 sm:min-h-0"
        >
          <BrandMark size={20} className="shrink-0" />
          FMIP
        </Link>
        {me === null && (
          // A guest's way in stays on a phone's first row, outside the menu;
          // on a wider screen it sits after the search, where it always was.
          <>
            <Link href={href('/login')} className={`${item} sm:order-1`}>
              <Translated locale={locale} message="nav.signIn" />
            </Link>
            <Link href={href('/register')} className={`${item} font-medium sm:order-1`}>
              Register
            </Link>
          </>
        )}
        <details className="site-menu relative" data-testid="nav-menu">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded border border-strong px-3 [&::-webkit-details-marker]:hidden">
            <Translated locale={locale} message="nav.menu" />
            <span aria-hidden="true">▾</span>
          </summary>
          <div className="site-menu-panel absolute end-0 top-full z-30 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col rounded border border-default bg-canvas px-3 py-2">
            <Link href={href('/scores')} className={item} data-testid="nav-scores">
              <Translated locale={locale} message="nav.scores" />
            </Link>
            <Link href={href('/predictions')} className={item} data-testid="nav-predictions">
              <Translated locale={locale} message="nav.predictions" />
            </Link>
            <Link href={href('/leaderboard')} className={item} data-testid="nav-leaderboard">
              <Translated locale={locale} message="nav.leaderboard" />
            </Link>
            <Link href={href('/news')} className={item} data-testid="nav-news">
              <Translated locale={locale} message="nav.news" />
            </Link>
            <Link href={href('/watch')} className={item} data-testid="nav-watch">
              <Translated locale={locale} message="nav.watch" />
            </Link>
            <form
              action={href('/search')}
              method="get"
              role="search"
              className="py-1 sm:me-auto sm:py-0"
            >
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
                className={controlClasses('sm', 'min-h-11 w-full sm:min-h-0 sm:w-48')}
                data-testid="nav-search"
              />
            </form>

            {me === null ? (
              // A guest's Settings is the appearance alone: text size, contrast, motion (T-621).
              <Link
                href={href('/settings')}
                className={`${item} sm:order-2`}
                data-testid="nav-settings-guest"
              >
                <Translated locale={locale} message="nav.settings" />
              </Link>
            ) : (
              <>
                <Link href={href('/following')} className={item} data-testid="nav-following">
                  <Translated locale={locale} message="nav.following" />
                </Link>
                <Link href={href('/friends')} className={item} data-testid="nav-friends">
                  <Translated locale={locale} message="nav.friends" />
                </Link>
                <Link href={href('/messages')} className={item} data-testid="nav-messages">
                  <Translated locale={locale} message="nav.messages" />
                </Link>
                <Link href={href('/groups')} className={item} data-testid="nav-groups">
                  <Translated locale={locale} message="nav.groups" />
                </Link>
                <Link
                  href={href(`/u/${encodeURIComponent(me.username)}`)}
                  className={item}
                  data-testid="nav-me"
                >
                  @{me.username}
                </Link>
                <Link href={href('/settings')} className={item}>
                  <Translated locale={locale} message="nav.settings" />
                </Link>
                <form action={logoutAction.bind(null, locale)} className="flex">
                  <button type="submit" className={`${item} underline`}>
                    <Translated locale={locale} message="nav.signOut" />
                  </button>
                </form>
              </>
            )}
            {/* Nothing until a second language is finished (T-306); see the component. */}
            <LanguagePicker languages={offeredLanguages()} />
            {/* Light, dark or the device's own, on every page (T-602). */}
            <div className="py-2 sm:order-2 sm:py-0">
              <ThemeSwitch locale={locale} current={theme} variant="compact" />
            </div>
          </div>
        </details>
      </nav>
    </header>
  );
}
