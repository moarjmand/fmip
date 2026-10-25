import { cookies } from 'next/headers';
import Link from '@/components/ui/link';
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

/** The header nav's words (`HEADER_NAV`, `MORE_NAV`), resolved here: the catalogues stay on the server. */
const NAV_LABELS: Record<string, MessageKey> = {
  matches: 'shell.nav.matches',
  predictions: 'nav.predictions',
  competitions: 'shell.nav.competitions',
  model: 'shell.nav.model',
  news: 'shell.nav.news',
  more: 'shell.nav.more',
  analysis: 'shell.nav.analysis',
  watch: 'nav.watch',
  highlights: 'nav.highlights',
};

/** The bottom tab bar's words (`tabBarLinks`). */
const TAB_LABELS: Record<string, MessageKey> = {
  matches: 'shell.tab.matches',
  predict: 'shell.tab.predict',
  leagues: 'shell.tab.leagues',
  news: 'shell.tab.news',
  you: 'shell.tab.you',
};

function resolved(lang: Locale, keys: Record<string, MessageKey>): Record<string, Message> {
  return Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, message(lang, key)]));
}

/** A line icon on the 24-unit grid, 2px stroke, in the text colour (the Design System's icons). */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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
 * The one header (D-199, Stadiomind D-263, D-267). It follows the theme, as
 * the Design System's header does: the raised surface on a phone, the page's
 * ground from 768px, where the competition pills continue it below.
 *
 * From 1280px one row: the wordmark, the nav (Matches, Predictions,
 * Competitions, The model, News, then More with the founder's analysis,
 * Watch and Highlights), then at the end the search field, the other
 * language, the theme (Auto, Day, Night) and Sign in or the member's menu.
 * From 1024px the nav takes a second row. On a phone or a tablet it is the
 * wordmark, search and the Menu (`<details>`, no script), which holds the nav,
 * the language, the theme and the account; on a phone the five main
 * sections are also in the bottom tab bar.
 *
 * One copy of every link: from 1024px `.site-menu` in globals.css makes the
 * disclosure `display: contents` (where `::details-content` can be styled),
 * so its contents are laid out in the bar itself. Search is the one control
 * drawn twice, as a link on a phone and a field in the bar, each with its own
 * test id.
 *
 * Every label goes through `Translated` or a resolved `Message` (T-151): on
 * an unfinished locale the English stands in, marked `lang="en"`.
 *
 * `banner` is drawn under the header and the competition pills (T-1433),
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
  const placeholder = message(lang, 'shell.search.placeholder');
  // The strip's "today" is the reader's: the member's zone, else the one a
  // guest chose, else the locale's default, as every page counts it (D-207).
  const timeZone = readerTimeZone(locale, me, guest);
  // A thumb-sized row in the phone's Menu.
  const item = 'flex min-h-touch items-center px-3';
  // The header's square tools: search on a phone, the Menu (D-263's 44px buttons).
  const tool =
    'flex size-touch items-center justify-center rounded-control border border-default bg-surface text-muted';

  return (
    <>
      <header className="relative border-b border-default bg-surface md:border-b-0 md:bg-canvas">
        <nav
          aria-label={primary.text}
          lang={primary.lang}
          className="page-frame flex min-h-15 items-center gap-x-2 lg:min-h-16 lg:flex-wrap lg:gap-x-4 lg:gap-y-1"
        >
          <Link
            href={href('')}
            className="me-auto flex min-h-touch items-center gap-2.5 font-latin text-fg lg:me-0"
            data-testid="nav-home"
          >
            {/* The mark in the colours of the ground it stands on (D-267):
              the header follows the theme, so both are drawn and globals.css
              shows the one the theme asks for. */}
            <BrandMark size={26} ground="day" className="brand-mark-day shrink-0" />
            <BrandMark size={26} ground="night" className="brand-mark-night shrink-0" />
            {/* The wordmark (D-262): Archivo 850 at 125% width, in capitals by
              CSS so a screen reader says the name rather than its letters. */}
            <span className="text-base leading-none font-[850] tracking-wide uppercase font-stretch-expanded lg:text-lg">
              Stadiomind
            </span>
          </Link>
          {/* On a phone and a tablet, search is in the header (D-263); from
              1024px it is the field in the bar, below. */}
          <Link
            href={href('/search')}
            aria-label={search.text}
            lang={search.lang}
            className={`${tool} lg:hidden`}
            data-testid="nav-search"
          >
            <Icon>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </Icon>
          </Link>
          <details className="site-menu" data-testid="nav-menu">
            <summary
              aria-label={menu.text}
              lang={menu.lang}
              className={`${tool} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              <Icon>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </Icon>
            </summary>
            <div className="site-menu-panel absolute inset-x-0 top-full z-30 flex max-h-[calc(100dvh-4rem)] flex-col gap-1 overflow-y-auto border-b border-default bg-surface px-4 py-3">
              {/* Below 1280px the nav does not fit beside the tools: it takes
                  the header's second row whole rather than wrapping one link
                  under the rest (T-1479), and the tools keep the first. */}
              <PrimaryNav
                locale={locale}
                labels={resolved(lang, NAV_LABELS)}
                className="flex flex-col lg:flex-row lg:items-center lg:gap-1 lg:max-xl:order-last lg:max-xl:basis-full"
              />
              {/* The Design System's search field: a plain GET form, so it
                  works before any script, landing on the search page. */}
              <form
                action={href('/search')}
                role="search"
                className="site-search hidden lg:ms-auto lg:flex lg:max-w-64 lg:grow lg:basis-40"
                data-testid="nav-search-form"
              >
                <label className="flex h-11 w-full items-center gap-2 rounded-control border border-default bg-surface px-3 text-caption focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
                  <Icon>
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-4-4" />
                  </Icon>
                  <span className="sr-only" lang={search.lang}>
                    {search.text}
                  </span>
                  <input
                    type="search"
                    name="q"
                    placeholder={placeholder.text}
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-caption"
                    data-testid="nav-search-input"
                  />
                </label>
              </form>
              {/* Nothing until a second language is finished (T-306) and not held back (T-1163). */}
              <LanguagePicker
                languages={offeredLanguages(offeredGiven(holds))}
                label={attribute(lang, 'shell.language')}
                others
              />
              {/* Auto, Day or Night, on every page (T-602, D-198, D-263). */}
              <div className="py-2 lg:py-0">
                <ThemeSwitch locale={locale} current={theme} variant="compact" />
              </div>
              {me === null ? (
                <div className="flex flex-col lg:flex-row lg:items-center lg:gap-2">
                  {/* A guest's Settings is the appearance alone: text size, contrast, motion (T-621). */}
                  {/* In the desktop bar a 44px gear, its word kept for a screen reader. */}
                  <Link
                    href={href('/settings')}
                    className={`${item} text-sm text-muted lg:size-touch lg:justify-center lg:px-0`}
                    data-testid="nav-settings-guest"
                  >
                    <span className="hidden lg:block">
                      <Icon>
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                      </Icon>
                    </span>
                    <span className="lg:sr-only">
                      <Translated locale={locale} message="nav.settings" />
                    </span>
                  </Link>
                  <Link href={href('/register')} className={`${item} lg:hidden`}>
                    <Translated locale={locale} message="shell.register" />
                  </Link>
                  {/* The one saffron button in the header (D-263: the primary action). */}
                  <Link
                    href={href('/login')}
                    className="mt-1 inline-flex h-11 items-center justify-center rounded-control bg-accent px-4 text-sm font-extrabold whitespace-nowrap text-on-accent hover:bg-accent-strong lg:mt-0"
                    data-testid="nav-sign-in"
                  >
                    <Translated locale={locale} message="nav.signIn" />
                  </Link>
                </div>
              ) : (
                <details className="account-menu relative" data-testid="account-menu">
                  <summary className="flex min-h-touch cursor-pointer list-none items-center gap-1 rounded-control px-3 text-sm font-semibold lg:border lg:border-default lg:bg-surface [&::-webkit-details-marker]:hidden">
                    @{me.username}
                    <span aria-hidden="true">▾</span>
                  </summary>
                  <div className="flex flex-col ps-3 lg:absolute lg:end-0 lg:top-full lg:z-40 lg:mt-1 lg:w-56 lg:rounded-control lg:border lg:border-default lg:bg-surface lg:px-2 lg:py-2">
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
        </nav>
        {/* A newer version of the platform rules awaits this member (T-931, D-113). */}
        {session?.rules.pending === true && <RulesPrompt locale={locale} />}
        {notice !== null && stored !== null && stored !== undefined && (
          <HeldLanguageNotice locale={locale} held={stored} value={notice} />
        )}
      </header>
      {/* The competition pills, right under the header from 768px (T-1433, D-267). */}
      <CompetitionsBar locale={locale} />
      {banner}
      {/* Today's matches, on every page; nothing at all when there are none or the API cannot say. */}
      <LiveStrip locale={locale} timeZone={timeZone} />
    </>
  );
}

/**
 * The bottom tab bar's server half (D-199, D-267): the words and whether "You" is the
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
