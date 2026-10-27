import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import type { CompetitionPage } from '@fmip/contracts';
import { EntityImage } from '@/components/entity-image';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { KIND_KEY, say, seasonHref } from '@/lib/competition';
import {
  type CompetitionTab,
  type Matchweek,
  clubCount,
  hasTable,
  seasonDigits,
  tabHref,
} from '@/lib/competition-overview';

/**
 * The competition page's header in the Stadiomind design (T-1498, D-274):
 * the logo on its own light tile, the name in the wide display cut, one line
 * of facts (country, season, clubs, the round), the season menu and the
 * follow form at the inline end, and the section tabs under it, the current
 * one underlined in saffron. On a phone it is the canvas's compact header: a
 * back link to the leagues, a smaller logo and name, and tabs that scroll
 * sideways. No club colour here (D-263: only a club's own page has one).
 */

const TAB_KEY: Record<CompetitionTab, MessageKey> = {
  overview: 'competitionPage.tab.overview',
  table: 'competitionPage.tab.table',
  matches: 'competitionPage.tab.matches',
  players: 'competitionPage.tab.players',
  model: 'competitionPage.tab.model',
  news: 'competitionPage.tab.news',
};

export function CompetitionHeader({
  page,
  locale,
  tab,
  tabs,
  minMinutes,
  matchweek,
  follow,
}: {
  page: CompetitionPage;
  locale: string;
  tab: CompetitionTab;
  tabs: CompetitionTab[];
  minMinutes: number | null;
  matchweek: Matchweek | null;
  follow: ReactNode;
}) {
  const c = page.competition;
  const name = c.localised_name ?? c.name;
  const season = seasonDigits(locale, page.season.label);
  return (
    <header className="border-b border-default bg-surface" data-testid="competition-header">
      <div className="page-frame flex flex-col gap-2 pt-2 sm:gap-5 sm:pt-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 sm:gap-x-5">
          <Link
            href={`/${locale}/competitions`}
            aria-label={say(locale, 'competitionPage.back')}
            className="-ms-3 -me-1 inline-grid size-touch shrink-0 place-items-center text-fg sm:hidden"
            data-testid="competition-back"
          >
            <Chevron to="back" />
          </Link>
          {/* The logo's own white tile is the frame (T-1609, D-280), larger from sm. */}
          <EntityImage
            media={c.logo}
            kind="logo"
            name={name}
            size={48}
            aboveFold
            className="sm:size-18 sm:rounded-tile sm:p-2"
          />
          <div className="flex min-w-0 flex-[1_1_10rem] flex-col gap-1 sm:gap-1.5">
            <h1
              className="text-xl leading-tight font-extrabold break-words font-stretch-semi-expanded sm:text-display-3"
              data-testid="title"
            >
              {name}
            </h1>
            {c.localised_name !== null && (
              <p className="text-sm text-muted" data-testid="canonical-name">
                {c.name}
              </p>
            )}
            <p className="text-sm text-muted" data-testid="season-facts">
              {facts(locale, page, season, matchweek).map((fact, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {fact}
                </span>
              ))}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-start gap-2 sm:ms-auto sm:w-auto">
            <SeasonMenu page={page} locale={locale} tab={tab} season={season} />
            {follow}
          </div>
        </div>
        <nav
          aria-label={say(locale, 'competitionPage.sections')}
          className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
          data-testid="competition-tabs"
        >
          {tabs.map((t) => {
            const current = t === tab;
            return (
              <Link
                key={t}
                href={tabHref(locale, c.id, page.season, t, t === 'players' ? minMinutes : null)}
                aria-current={current ? 'page' : undefined}
                data-testid={`competition-tab-${t}`}
                className={cx(
                  'inline-flex min-h-touch shrink-0 items-center border-b-3 px-3 text-sm whitespace-nowrap sm:px-3.5',
                  current
                    ? // The row scrolls on a phone: the browser opens it at the current tab (T-1558).
                      'border-accent font-extrabold text-fg [scroll-initial-target:nearest]'
                    : 'border-transparent font-semibold text-muted hover:text-fg',
                )}
              >
                {t === 'table' && !hasTable(page) ? (
                  say(locale, 'competitionPage.tab.knockout')
                ) : t === 'model' ? (
                  // The phone board's short "Model" (CompetitionPhone), the full name from sm up.
                  <>
                    <span className="sm:hidden">
                      {say(locale, 'competitionPage.tab.modelShort')}
                    </span>
                    <span className="hidden sm:inline">{say(locale, TAB_KEY[t])}</span>
                  </>
                ) : (
                  say(locale, TAB_KEY[t])
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

/** "England · 2026/27 · 20 clubs · Matchweek 8": only what the season holds. */
function facts(
  locale: string,
  page: CompetitionPage,
  season: string,
  matchweek: Matchweek | null,
): ReactNode[] {
  const c = page.competition;
  const kind = KIND_KEY[c.kind];
  const clubs = clubCount(page);
  return [
    c.country !== null ? c.country.name : kind === undefined ? c.kind : say(locale, kind),
    ...(c.tier !== null && c.tier > 1
      ? [say(locale, 'competitionPage.tier', { tier: formatNumber(locale, c.tier) })]
      : []),
    ...(c.gender === 'women' ? [say(locale, 'competitionPage.women')] : []),
    season,
    ...(clubs !== null
      ? [
          <Translated
            key="clubs"
            locale={locale}
            message="competitionPage.facts.clubs"
            count={clubs}
          />,
        ]
      : []),
    ...(matchweek?.state === 'next' && matchweek.label !== null ? [matchweek.label] : []),
  ];
}

/**
 * The season menu: the current season as a quiet button that opens the list
 * of seasons, each a plain link that keeps the tab -- a `details` element,
 * so it needs no script. One season is a label, not a menu.
 */
function SeasonMenu({
  page,
  locale,
  tab,
  season,
}: {
  page: CompetitionPage;
  locale: string;
  tab: CompetitionTab;
  season: string;
}) {
  const box =
    'inline-flex min-h-touch items-center gap-1.5 rounded-control border border-default px-3.5 text-sm font-bold tabular-nums';
  if (page.seasons.length < 2) {
    return (
      <span className={box} data-testid="season-label">
        {season}
      </span>
    );
  }
  return (
    <details className="relative" data-testid="seasons">
      <summary
        className={cx(
          box,
          'cursor-pointer list-none hover:border-strong [&::-webkit-details-marker]:hidden',
        )}
        aria-label={say(locale, 'competitionPage.seasonMenu', { season })}
      >
        {season}
        <Chevron to="down" />
      </summary>
      <ul className="absolute end-0 top-full z-20 mt-1 flex max-h-80 min-w-40 flex-col overflow-y-auto rounded-control border border-default bg-surface py-1">
        {page.seasons.map((s) => {
          const current = s.id === page.season.id;
          return (
            <li key={s.id}>
              <Link
                href={seasonHref(locale, page.competition.id, s, tab)}
                aria-current={current ? 'true' : undefined}
                className={cx(
                  'flex min-h-touch items-center px-3.5 text-sm tabular-nums hover:bg-surface-raised',
                  current ? 'font-extrabold text-fg' : 'text-muted',
                )}
              >
                {s.is_current
                  ? say(locale, 'competitionPage.seasonCurrent', {
                      season: seasonDigits(locale, s.label),
                    })
                  : seasonDigits(locale, s.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The canvas's two chevrons, drawn like the icon set: 24 grid, 2 stroke, round joins. */
function Chevron({ to }: { to: 'back' | 'down' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={to === 'back' ? 20 : 16}
      height={to === 'back' ? 20 : 16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Back points to the inline start: left on an English page, right on a Persian one.
      className={cx('shrink-0', to === 'back' && 'rtl:-scale-x-100')}
    >
      <path d={to === 'back' ? 'm15 18-6-6 6-6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}
