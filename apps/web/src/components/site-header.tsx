import { cookies } from 'next/headers';
import Link from 'next/link';
import { cache } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { CompetitionsBar } from '@/components/competitions-bar';
import { HeldLanguageNotice } from '@/components/held-language-notice';
import { Translated } from '@/components/translated';
import { LanguagePicker } from '@/components/language-picker';
import { LiveStrip } from '@/components/live-strip';
import { RulesPrompt } from '@/components/rules-prompt';
import { BottomTabBar, PrimaryNav } from '@/components/shell-nav';
import { ThemeSwitch } from '@/components/theme-switch';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { type Message, type MessageKey, attribute, message } from '@/i18n/messages';
import { fetchSession } from '@/lib/api';
import { readGuestChoices } from '@/lib/first-run-cookie';
import { HELD_NOTICE_COOKIE, currentHolds, heldNotice, offeredGiven } from '@/lib/language-hold';
import { offeredLanguages } from '@/lib/language-picker';
import { logoutAction } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import type { ThemePreference } from '@/lib/theme';
import { readerTimeZone } from '@/lib/reader-time-zone';

/**
 * The site shell (T-1381, D-199): the header, the live strip under it and
 * the phone's bottom tab bar, the same on every page of both modes.
 *
 * Who is reading is asked once per request (`shellReader`, React's `cache`):
 * the header, the strip (for the reader's zone) and the tab bar ("Me") all
 * need it. When the API is unreachable the visitor is shown as signed out,
 * which is the honest state: nothing could be verified.
 */
const shellReader = cache(async () => {
  const session = await fetchSession(await sessionCookieHeader());
  const guest = session?.user ? null : await readGuestChoices();
  return { session, guest };
});

/** The header nav's words (`HEADER_NAV`), resolved here: the catalogues stay on the server. */
const NAV_LABELS: Record<string, MessageKey> = {
  today: 'shell.nav.today',
  scores: 'nav.scores',
  predictions: 'nav.predictions',
  analysis: 'shell.nav.analysis',
  news: 'shell.nav.news',
  watch: 'nav.watch',
};

/** The bottom tab bar's words (`tabBarLinks`). */
const TAB_LABELS: Record<string, MessageKey> = {
  today: 'shell.nav.today',
  results: 'shell.tab.results',
  predictions: 'shell.tab.predictions',
  news: 'shell.tab.news',
  me: 'shell.tab.me',
};

function resolved(lang: Locale, keys: Record<string, MessageKey>): Record<string, Message> {
  return Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, message(lang, key)]));
}

/** A line icon on the 24-unit grid, in the text colour. */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/**
 * The one header (D-198, D-199): always on paper (`data-mode="editorial"`)
 * with a double rule under it. From 768px one row: the mark and wordmark,
 * the nav (Today, Scores, Predictions, Analysis, News, Watch), then the other
 * language, search, the theme (Auto, Day, Night) and Sign in or the
 * member's menu. On a phone it is the Menu button, the mark and search; the
 * Menu (`<details>`, no script) holds the nav, the language, the theme and
 * the account, and the five main sections are in the bottom tab bar.
 *
 * One copy of every link: from 1024px `.site-menu` in globals.css makes the
 * disclosure `display: contents` (where `::details-content` can be styled),
 * so its contents are laid out in the bar itself, placed by `order`.
 *
 * Every label goes through `Translated` or a resolved `Message` (T-151): on
 * an unfinished locale the English stands in, marked `lang="en"`.
 *
 * `banner` is drawn under the header and the competitions bar (T-1433),
 * above the live strip: lite mode's indicator (T-1387), which renders
 * nothing when lite mode is off.
 */
export async function SiteHeader({
  locale,
  theme,
  banner,
}: {
  locale: string;
  theme: ThemePreference;
  banner?: React.ReactNode;
}) {
  const [{ session, guest }, holds, jar] = await Promise.all([
    shellReader(),
    currentHolds(),
    cookies(),
  ]);
  const me = session?.user ?? null;
  // T-1163 (D-155): a reader whose stored language is held back is told
  // once; the language they chose is kept, and the picker offers it again
  // the day it is released.
  const stored = me !== null ? me.preferred_language : guest?.language;
  const notice = heldNotice(
    stored,
    holds,
    (() => {
      const raw = jar.get(HELD_NOTICE_COOKIE)?.value;
      return raw === undefined ? undefined : decodeURIComponent(raw);
    })(),
  );
  const href = (path: string) => `/${locale}${path}`;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const primary = attribute(lang, 'shell.nav.primary');
  const menu = attribute(lang, 'nav.menu');
  // The search icon leads to the search page; its name says what it searches.
  const search = attribute(lang, 'nav.searchLabel');
  // The strip's "today" is the reader's: the member's zone, else the one a
  // guest chose, else the locale's default, as every page counts it (D-207).
  const timeZone = readerTimeZone(locale, me, guest);
  // A thumb-sized row in the phone's Menu.
  const item = 'flex min-h-touch items-center px-3';

  return (
    <>
      <header data-mode="editorial" className="relative border-b-[3px] border-double border-fg">
        <nav
          aria-label={primary.text}
          lang={primary.lang}
          className="page-frame flex min-h-15 items-center gap-x-2 lg:min-h-17 lg:flex-wrap lg:gap-x-6 lg:gap-y-1"
        >
          <details className="site-menu lg:order-last" data-testid="nav-menu">
            <summary
              aria-label={menu.text}
              lang={menu.lang}
              className="flex size-touch cursor-pointer list-none items-center justify-center rounded-control [&::-webkit-details-marker]:hidden"
            >
              <Icon>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </Icon>
            </summary>
            <div className="site-menu-panel absolute inset-x-0 top-full z-30 flex max-h-[calc(100dvh-4rem)] flex-col gap-1 overflow-y-auto border-b border-default bg-canvas px-4 py-3">
              <PrimaryNav
                locale={locale}
                labels={resolved(lang, NAV_LABELS)}
                className="flex flex-col lg:order-2 lg:min-w-0 lg:flex-1 lg:flex-row lg:flex-wrap lg:gap-0.5"
              />
              {/* Nothing until a second language is finished (T-306) and not held back (T-1163). */}
              <div className="lg:order-3">
                <LanguagePicker
                  languages={offeredLanguages(offeredGiven(holds))}
                  label={attribute(lang, 'shell.language')}
                  others
                />
              </div>
              {/* Auto, Day or Night, on every page (T-602, D-198). */}
              <div className="py-2 lg:order-5 lg:py-0">
                <ThemeSwitch locale={locale} current={theme} variant="compact" />
              </div>
              {me === null ? (
                <div className="flex flex-col lg:order-6 lg:flex-row lg:items-center lg:gap-3">
                  {/* A guest's Settings is the appearance alone: text size, contrast, motion (T-621). */}
                  <Link
                    href={href('/settings')}
                    className={`${item} text-sm text-muted lg:px-0`}
                    data-testid="nav-settings-guest"
                  >
                    <Translated locale={locale} message="nav.settings" />
                  </Link>
                  <Link href={href('/register')} className={`${item} lg:hidden`}>
                    <Translated locale={locale} message="shell.register" />
                  </Link>
                  <Link
                    href={href('/login')}
                    className="mt-1 inline-flex h-11 items-center justify-center rounded-control border border-fg px-4 text-sm font-semibold lg:mt-0"
                    data-testid="nav-sign-in"
                  >
                    <Translated locale={locale} message="nav.signIn" />
                  </Link>
                </div>
              ) : (
                <details className="account-menu relative lg:order-6" data-testid="account-menu">
                  <summary className="flex min-h-touch cursor-pointer list-none items-center gap-1 rounded-control px-3 text-sm font-semibold lg:border lg:border-fg [&::-webkit-details-marker]:hidden">
                    @{me.username}
                    <span aria-hidden="true">▾</span>
                  </summary>
                  <div className="flex flex-col ps-3 lg:absolute lg:end-0 lg:top-full lg:z-40 lg:mt-1 lg:w-56 lg:rounded-control lg:border lg:border-default lg:bg-canvas lg:px-2 lg:py-2">
                    <Link
                      href={href(`/u/${encodeURIComponent(me.username)}`)}
                      className={item}
                      data-testid="nav-me"
                    >
                      @{me.username}
                    </Link>
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
                    <Link href={href('/settings')} className={item} data-testid="nav-settings">
                      <Translated locale={locale} message="nav.settings" />
                    </Link>
                    <form action={logoutAction.bind(null, locale)} className="flex">
                      <button type="submit" className={`${item} underline`}>
                        <Translated locale={locale} message="nav.signOut" />
                      </button>
                    </form>
                  </div>
                </details>
              )}
            </div>
          </details>
          <Link
            href={href('')}
            className="mx-auto flex min-h-touch items-center gap-2.5 font-latin text-fg lg:order-1 lg:mx-0"
            data-testid="nav-home"
          >
            <BrandMark size={32} className="shrink-0" />
            <span className="text-2xl leading-none font-black tracking-wide font-stretch-condensed lg:text-3xl">
              FMIP
            </span>
          </Link>
          <Link
            href={href('/search')}
            aria-label={search.text}
            lang={search.lang}
            className="flex size-touch items-center justify-center rounded-control lg:order-4"
            data-testid="nav-search"
          >
            <Icon>
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </Icon>
          </Link>
        </nav>
        {/* A newer version of the platform rules awaits this member (T-931, D-113). */}
        {session?.rules.pending === true && <RulesPrompt locale={locale} />}
        {notice !== null && stored !== null && stored !== undefined && (
          <HeldLanguageNotice locale={locale} held={stored} value={notice} />
        )}
      </header>
      {/* The main competitions and "All competitions", right under the menu (T-1433). */}
      <CompetitionsBar locale={locale} />
      {banner}
      {/* Today's matches, on every page; nothing at all when there are none or the API cannot say. */}
      <LiveStrip locale={locale} timeZone={timeZone} />
    </>
  );
}

/**
 * The bottom tab bar's server half (D-199): the words and whether "Me" is the
 * member's settings or Sign in. Rendered at the end of the body, so it comes
 * after the page in the reading and tab order; it is fixed to the bottom on
 * a phone and not drawn from 768px.
 */
export async function SiteTabBar({ locale }: { locale: string }) {
  const { session } = await shellReader();
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <BottomTabBar
      locale={locale}
      labels={resolved(lang, TAB_LABELS)}
      signedIn={(session?.user ?? null) !== null}
      navLabel={attribute(lang, 'shell.nav.tabs')}
    />
  );
}
