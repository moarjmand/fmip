import type { ReactNode } from 'react';
import type {
  HighlightCompetition,
  HighlightsResponse,
  MatchViewing,
  Territory,
  ViewingTerritory,
} from '@fmip/contracts';
import { EntityImage, drawable } from '@/components/entity-image';
import { Translated } from '@/components/translated';
import { Icon, Notice } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import Link from '@/components/ui/link';
import { TerritoryChooser } from '@/components/viewing-panel';
import { formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { say } from '@/lib/competition';
import { dayKey } from '@/lib/competition-overview';
import {
  featuredOf,
  groupByDay,
  highlightsHref,
  pageCount,
  relativeDay,
  splitFilter,
  type HighlightsQuery,
} from '@/lib/highlights';
import { zoneWords } from '@/lib/reader-time-zone';
import { HighlightPoster } from './poster';

const NONE = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;

/**
 * Highlights (T-1434, D-226; redesigned as match posters by T-1614, D-285):
 * every official highlight link we hold -- the licensed feed's verified clips
 * (D-184), link only, never played here -- newest match first.
 *
 * Which clips is the API's answer for the reader's territory, by the match
 * page's rule (`offeredIn`): the member's stored one, or the one a guest
 * picks here, which then travels with every link on the page. With none,
 * every clip is listed (T-1488, D-260), each one limited to some countries
 * saying it may not play there, and the page says how to narrow the list.
 *
 * The page: a header with the count and the competitions' logos, the
 * territory panel, the competition filter as logo chips (links, so it works
 * without script, and the address keeps the choice), then page 1's newest
 * clip as a large poster and the rest as a grid of posters by the reader's
 * day, and newer/older pages of twenty. An empty list and an unreachable API
 * each have their own sentence (rule 3).
 */
export function HighlightsView({
  locale,
  q,
  data,
  timeZone,
  signedIn,
  territories,
  now,
}: {
  locale: string;
  q: HighlightsQuery;
  /** The API's answer, or `null` when it could not be reached. */
  data: HighlightsResponse | null;
  timeZone: string;
  signedIn: boolean;
  /** The chooser's territories, for a guest; `null` for a member. */
  territories: Territory[] | null;
  /** The clock "today" and "yesterday" are read against. */
  now: Date;
}) {
  // A guest's territory travels on the links; a member's is stored.
  const carried = signedIn ? undefined : q.territory;
  const territory: ViewingTerritory = data?.territory ?? { state: 'not_chosen' };
  const territoryState: MatchViewing = {
    fixture_id: '',
    territory,
    options: NONE,
    highlights: NONE,
  };

  return (
    <main className="page-frame flex flex-col gap-6 py-8">
      <PageHeader locale={locale} data={data} />

      <section
        aria-labelledby="highlights-territory"
        className="flex flex-col gap-4 rounded-tile border border-default bg-surface p-4 md:flex-row md:items-center md:justify-between md:gap-8"
        data-testid="highlights-territory"
      >
        <div className="flex min-w-0 items-start gap-3">
          <Globe />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="highlights-territory" className="font-bold">
              <Translated locale={locale} message="highlights.territory" />
            </h2>
            {data?.offered === 'all' && (
              <p className="max-w-measure text-sm text-muted" data-testid="highlights-all">
                <Translated locale={locale} message="highlights.allListed" />
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <TerritoryChooser
            locale={locale}
            viewing={territoryState}
            signedIn={signedIn}
            href={`/${locale}/highlights`}
            territories={territories}
            hidden={q.competition === undefined ? {} : { competition: q.competition }}
          />
        </div>
      </section>

      {data === null ? (
        <Notice tone="danger" data-testid="highlights-unreachable">
          <Translated locale={locale} message="highlights.unreachable" />
        </Notice>
      ) : (
        <>
          {data.competitions.length > 0 && <Filter locale={locale} q={q} data={data} />}

          {data.items.length === 0 ? (
            <p className="text-muted" data-testid="highlights-empty">
              <Translated
                locale={locale}
                message={
                  data.total > 0
                    ? 'highlights.pastEnd'
                    : data.competition !== null
                      ? 'highlights.emptyCompetition'
                      : 'highlights.empty'
                }
              />
            </p>
          ) : (
            <Clips
              locale={locale}
              q={q}
              data={data}
              timeZone={timeZone}
              territory={carried}
              now={now}
            />
          )}

          {data.total > data.page_size && <Pages locale={locale} q={q} data={data} />}

          {data.last_updated_at !== null && (
            <p className="text-xs text-caption" data-testid="highlights-updated">
              {say(locale, 'highlights.updated', {
                time: formatDateTime(locale, data.last_updated_at, timeZone),
                zone: zoneWords(locale, timeZone),
              })}
            </p>
          )}
        </>
      )}
    </main>
  );
}

/**
 * The title, the lead, how many clips from how many competitions, and the
 * logos of the competitions with the most clips -- only those we hold a logo
 * for, as a picture of what the list covers.
 */
function PageHeader({ locale, data }: { locale: string; data: HighlightsResponse | null }) {
  const logos = (data?.competitions ?? []).filter((c) => drawable(c.logo)).slice(0, 6);
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div className="flex min-w-0 flex-col gap-2">
        <h1
          className="border-s-4 border-s-accent ps-4 text-display-1 font-extrabold font-stretch-semi-expanded sm:text-display-2"
          data-testid="title"
        >
          <Translated locale={locale} message="highlights.title" />
        </h1>
        <p className="max-w-measure text-muted">
          <Translated locale={locale} message="highlights.lead" />
        </p>
        {data !== null && data.total > 0 && (
          <p className="text-sm font-semibold" data-testid="highlights-stats">
            <Translated locale={locale} message="highlights.clipCount" count={data.total} />
            {data.competition === null && (
              <>
                <span className="text-muted"> · </span>
                <Translated
                  locale={locale}
                  message="highlights.competitionCount"
                  count={data.competitions.length}
                />
              </>
            )}
          </p>
        )}
      </div>
      {logos.length >= 3 && (
        <div
          aria-hidden="true"
          className="flex shrink-0 flex-wrap gap-2"
          data-testid="highlights-logos"
        >
          {logos.map((c) => (
            // Each logo on its own tile (D-280).
            <EntityImage key={c.id} media={c.logo} kind="logo" name={c.name} size={40} aboveFold />
          ))}
        </div>
      )}
    </header>
  );
}

/**
 * The competition filter: logo chips, all of them links, so a pick is an
 * address and works without script. On a phone the first chips scroll
 * sideways in one row; the rest, past the competitions with the most clips,
 * wait behind a disclosure that opens without script too.
 */
function Filter({
  locale,
  q,
  data,
}: {
  locale: string;
  q: HighlightsQuery;
  data: HighlightsResponse;
}) {
  const { shown, more } = splitFilter(data.competitions, data.competition);
  return (
    <nav
      aria-label={say(locale, 'highlights.filter')}
      className="flex flex-col gap-2"
      data-testid="highlights-filter"
    >
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        <li className="shrink-0">
          <Chip
            href={highlightsHref(locale, q, { competition: null })}
            on={data.competition === null}
            testId="highlights-filter-all"
          >
            <AllMark />
            <Translated locale={locale} message="highlights.allCompetitions" />
          </Chip>
        </li>
        {shown.map((c) => (
          <li key={c.id} className="shrink-0">
            <CompetitionChip locale={locale} q={q} competition={c} on={data.competition === c.id} />
          </li>
        ))}
      </ul>
      {more.length > 0 && (
        <details className="group/more" data-testid="highlights-filter-more">
          <summary className="inline-flex min-h-touch cursor-pointer list-none items-center gap-1.5 rounded-control px-1 text-sm font-semibold text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <Translated locale={locale} message="highlights.moreCompetitions" count={more.length} />
            <Chevron to="down" />
          </summary>
          <ul className="flex flex-wrap gap-2 pt-2">
            {more.map((c) => (
              <li key={c.id}>
                <CompetitionChip locale={locale} q={q} competition={c} on={false} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </nav>
  );
}

function CompetitionChip({
  locale,
  q,
  competition: c,
  on,
}: {
  locale: string;
  q: HighlightsQuery;
  competition: HighlightCompetition;
  on: boolean;
}) {
  return (
    <Chip
      href={highlightsHref(locale, q, { competition: c.id })}
      on={on}
      testId="highlights-filter-competition"
      competition={c.id}
    >
      <EntityImage media={c.logo} kind="logo" name={c.name} size={22} />
      <bdi>{c.name}</bdi>
      <span className="rounded-pill bg-surface-raised px-1.5 text-xs font-semibold text-muted tabular-nums">
        {formatNumber(locale, c.count)}
      </span>
    </Chip>
  );
}

/** A filter chip: a link with its choice in the address, the chosen one on the selected ground. */
function Chip({
  href,
  on,
  testId,
  competition,
  children,
}: {
  href: string;
  on: boolean;
  testId: string;
  competition?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={cx(
        'inline-flex min-h-touch items-center gap-2 rounded-pill ps-2.5 pe-3 text-sm whitespace-nowrap',
        on
          ? // The row scrolls on a phone: the browser opens it at the chosen chip.
            'border-2 border-accent bg-brand/14 font-extrabold [scroll-initial-target:nearest]'
          : 'border border-default bg-surface font-semibold hover:border-strong',
      )}
      data-testid={testId}
      data-competition={competition}
    >
      {children}
    </Link>
  );
}

/**
 * The clips: on the first page the newest as a large poster, then the rest as
 * a grid of posters under a heading per day in the reader's zone ("Today",
 * "Yesterday", else the date).
 */
function Clips({
  locale,
  q,
  data,
  timeZone,
  territory,
  now,
}: {
  locale: string;
  q: HighlightsQuery;
  data: HighlightsResponse;
  timeZone: string;
  territory: string | undefined;
  now: Date;
}) {
  const { featured, rest } = featuredOf(data.items, data.page);
  const today = dayKey(now.toISOString(), timeZone);
  return (
    <div className="flex flex-col gap-8" data-testid="highlights-list">
      {featured !== null && (
        <HighlightPoster
          locale={locale}
          item={featured}
          timeZone={timeZone}
          q={q}
          territory={territory}
          look="featured"
        />
      )}
      {groupByDay(rest, timeZone).map(({ day, items }) => {
        const relative = relativeDay(day, today);
        const id = `highlights-day-${day}`;
        return (
          <section
            key={day}
            aria-labelledby={id}
            className="flex flex-col gap-3"
            data-testid="highlights-day"
            data-day={day}
          >
            <h2
              id={id}
              className="flex flex-wrap items-baseline gap-x-2 border-b border-default pb-2"
            >
              {relative !== null && (
                <span className="text-lg font-extrabold">
                  <Translated
                    locale={locale}
                    message={relative === 'today' ? 'scores.today' : 'scores.yesterday'}
                  />
                </span>
              )}
              <time
                dateTime={day}
                className={relative === null ? 'text-lg font-extrabold' : 'text-sm text-muted'}
              >
                {formatDate(locale, items[0]!.fixture.kickoff_at, timeZone, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </time>
            </h2>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <li key={item.id}>
                  <HighlightPoster
                    locale={locale}
                    item={item}
                    timeZone={timeZone}
                    q={q}
                    territory={territory}
                    look="card"
                  />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/** Newer and older pages, and where this one is. */
function Pages({
  locale,
  q,
  data,
}: {
  locale: string;
  q: HighlightsQuery;
  data: HighlightsResponse;
}) {
  const pages = pageCount(data.total, data.page_size);
  const step =
    'inline-flex min-h-touch items-center gap-1.5 rounded-pill border border-default bg-surface px-4 text-sm font-semibold hover:border-strong';
  return (
    <nav
      aria-label={say(locale, 'highlights.pages')}
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
      data-testid="highlights-pages"
    >
      {data.page > 1 ? (
        <Link
          href={highlightsHref(locale, q, { page: data.page - 1 })}
          rel="prev"
          className={step}
          data-testid="highlights-newer"
        >
          <Chevron to="back" />
          <Translated locale={locale} message="highlights.newer" />
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted" data-testid="highlights-page">
        {say(locale, 'highlights.pageOf', {
          page: formatNumber(locale, data.page),
          pages: formatNumber(locale, pages),
        })}
      </span>
      {data.page < pages ? (
        <Link
          href={highlightsHref(locale, q, { page: data.page + 1 })}
          rel="next"
          className={step}
          data-testid="highlights-older"
        >
          <Translated locale={locale} message="highlights.older" />
          <Icon name="forward" size={14} />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** The territory panel's mark: a globe, in the accent. Decorative. */
function Globe() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="mt-0.5 size-8 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}

/** "All competitions": four tiles, the filter's every-competition mark. Decorative. */
function AllMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className="size-[22px] shrink-0 fill-muted"
    >
      <rect x="1" y="1" width="6" height="6" rx="1.5" />
      <rect x="9" y="1" width="6" height="6" rx="1.5" />
      <rect x="1" y="9" width="6" height="6" rx="1.5" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" />
    </svg>
  );
}

/**
 * A chevron: down for the disclosure (turned when it is open), back for the
 * newer page, pointing to the inline start -- left on an English page, right
 * on a Persian one. Decorative.
 */
function Chevron({ to }: { to: 'down' | 'back' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx(
        'size-4 shrink-0',
        to === 'down'
          ? 'motion-safe:transition-transform group-open/more:rotate-180'
          : 'rtl:-scale-x-100',
      )}
    >
      <path d={to === 'down' ? 'm4 6 4 4 4-4' : 'm10 4-4 4 4 4'} />
    </svg>
  );
}
