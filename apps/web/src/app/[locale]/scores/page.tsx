import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveScores } from '@/components/live-scores';
import {
  fetchConsensusList,
  fetchForecastSummaries,
  fetchIngestionHealth,
  fetchMe,
  fetchScores,
  fetchViewingBatch,
} from '@/lib/api';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { attribute, message, t, type MessageKey } from '@/i18n/messages';
import { feedTrouble } from '@/lib/live';
import { apiQuery, dayStrip, pageHref, readScoresQuery, shiftDate } from '@/lib/scores';
import {
  applyFilters,
  filterOptions,
  filterParams,
  isFiltered,
  NO_FILTERS,
  withSelected,
  type FilterOption,
} from '@/lib/scores-filters';
import { cardIds, loadScoreCardProducts, NO_PRODUCTS } from '@/lib/score-card-products';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { scoresWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import { Translated } from '@/components/translated';
import { Button, ButtonLink, Notice, controlClasses } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/scores',
    title: `${t(resolved, 'nav.scores')} · FMIP`,
    description: t(resolved, 'scores.metaDescription'),
  });
}

/**
 * The scores page (blueprint 4.1, T-031): one day at a time, in the viewer's
 * zone, with the yesterday / today / next-five-days strip, live and
 * favourites filters, favourites pinned, the rest grouped by competition.
 * Data comes from `GET /scores`, then stays current over the web app's own
 * SSE proxy (T-032); when the API cannot be reached the page says so instead
 * of rendering an empty list that looks like a quiet day.
 *
 * T-633: any date through a native date picker, previous / next day, and
 * country, competition and stage filters offering only what the day holds.
 * Both are plain GET forms, so they work without JavaScript and every
 * filtered view is a shareable address.
 */
export default async function ScoresPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const say = (key: MessageKey): string => t(resolved, key);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const q = readScoresQuery(query, me?.timezone ?? null);
  const [result, ingestion] = await Promise.all([
    fetchScores(apiQuery(q), cookie),
    fetchIngestionHealth(),
  ]);
  const filters = q.filters ?? NO_FILTERS;
  // T-940 (D-114): the model's, the community's and the viewing line for every
  // card shown, one request per product per 50 matches, in parallel -- never a
  // request per card. A guest has no stored territory, so viewing is not asked.
  const products = result.ok
    ? await loadScoreCardProducts(
        cardIds(applyFilters(result.data, filters)),
        {
          forecasts: fetchForecastSummaries,
          consensus: fetchConsensusList,
          viewing: me === null ? null : (ids) => fetchViewingBatch(ids, undefined, cookie),
        },
        locale,
      )
    : NO_PRODUCTS;
  // A provider outage is named on the page (T-083), never hidden behind old numbers.
  const trouble = feedTrouble(ingestion, locale, q.timezone);
  const strip = dayStrip(q, locale, {
    yesterday: say('scores.yesterday'),
    today: say('scores.today'),
    tomorrow: say('scores.tomorrow'),
  });
  const dayNav = attribute(resolved, 'scores.dayNav');
  // Every control is a thumb's target, 44px or more (T-605).
  const linkClass = (active: boolean): string =>
    `inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded px-3 ${
      active ? 'bg-surface-raised font-semibold' : 'underline'
    }`;
  // The day steps, each a thumb-sized button.
  const stepClass = 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1';
  const filtered = isFiltered(filters);
  const clearFiltersHref = pageHref(locale, q, { filters: NO_FILTERS });
  const options = result.ok ? filterOptions(result.data) : null;
  const inputClass = controlClasses('sm');
  // What a form must carry besides its own fields, so submitting it keeps the view.
  const hidden = (fields: [string, string | null | false][]) =>
    fields.map(([name, value]) =>
      value === null || value === false ? null : (
        <input key={name} type="hidden" name={name} value={value} />
      ),
    );
  const zoneField: [string, string | null] = ['tz', q.explicitTimezone ? q.timezone : null];
  const flagFields: [string, string | false][] = [
    ['live', q.live && '1'],
    ['favourites', q.favourites && '1'],
  ];
  const select = (
    name: string,
    label: string,
    all: string,
    list: FilterOption[],
    selected: string | null,
  ) =>
    list.length === 0 && selected === null ? null : (
      <label className="flex min-w-0 flex-col gap-1">
        <span>{label}</span>
        <select
          name={name}
          defaultValue={selected ?? ''}
          className={`${inputClass} min-h-11 max-w-full`}
          data-testid={`filter-${name}`}
        >
          <option value="">{all}</option>
          {withSelected(list, selected).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4 sm:gap-6 sm:p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={locale} message="nav.scores" />
      </h1>

      {/* One row that scrolls inside itself on a phone, never the page (T-605). */}
      <nav
        aria-label={dayNav.text}
        lang={dayNav.lang}
        className="-mx-4 flex gap-1 overflow-x-auto px-4 text-sm sm:mx-0 sm:flex-wrap sm:px-0"
        data-testid="day-strip"
      >
        {strip.map((day) => (
          <Link
            key={day.date}
            href={pageHref(locale, q, { date: day.date })}
            aria-current={day.isSelected ? 'date' : undefined}
            className={linkClass(day.isSelected)}
          >
            {day.label}
          </Link>
        ))}
      </nav>

      {/* The day first, then the steps: on a phone the date and its button take
          one row and the two steps the next, so neither is squeezed (T-605). */}
      <div className="flex flex-wrap items-end gap-2 text-sm" data-testid="date-picker">
        <form
          method="get"
          action={`/${locale}/scores`}
          className="flex min-w-0 basis-full items-end gap-2 sm:basis-auto"
        >
          {hidden([zoneField, ...flagFields, ...filterParams(filters)])}
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span>
              <Translated locale={locale} message="scores.date" />
            </span>
            <input
              type="date"
              name="date"
              required
              defaultValue={q.date}
              className={`${inputClass} min-h-11 w-full min-w-0`}
              data-testid="date-input"
            />
          </label>
          <Button type="submit" className="min-h-11 shrink-0 font-medium">
            <Translated locale={locale} message="scores.showDay" />
          </Button>
        </form>
        {/* The arrows are bidi-mirrored characters, so they point the right way in RTL. */}
        <ButtonLink
          href={pageHref(locale, q, { date: shiftDate(q.date, -1) })}
          className={stepClass}
          data-testid="previous-day"
        >
          <span aria-hidden="true">‹</span>
          <span>
            <Translated locale={locale} message="scores.previousDay" />
          </span>
        </ButtonLink>
        <ButtonLink
          href={pageHref(locale, q, { date: shiftDate(q.date, 1) })}
          className={stepClass}
          data-testid="next-day"
        >
          <span>
            <Translated locale={locale} message="scores.nextDay" />
          </span>
          <span aria-hidden="true">›</span>
        </ButtonLink>
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-0 text-sm" data-testid="filters">
        <Link href={pageHref(locale, q, { live: false })} className={linkClass(!q.live)}>
          <Translated locale={locale} message="scores.filter.all" />
        </Link>
        <Link href={pageHref(locale, q, { live: true })} className={linkClass(q.live)}>
          <Translated locale={locale} message="scores.filter.live" />
        </Link>
        {me !== null && (
          <Link
            href={pageHref(locale, q, { favourites: !q.favourites })}
            className={linkClass(q.favourites)}
            aria-pressed={q.favourites}
          >
            <Translated locale={locale} message="scores.filter.favourites" />
          </Link>
        )}
        <span className="w-full text-xs text-muted sm:ms-auto sm:w-auto" data-testid="timezone">
          <FilledMessage
            message={message(
              resolved,
              me === null && !q.explicitTimezone ? 'scores.timesInGuest' : 'scores.timesIn',
            )}
            params={{ zone: q.timezone }}
          />
        </span>
      </div>

      {options !== null &&
        (filtered ||
          options.countries.length + options.competitions.length + options.stages.length > 0) && (
          <details open={filtered} className="text-sm" data-testid="more-filters">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium">
              <Translated
                locale={locale}
                message={filtered ? 'scores.filter.moreActive' : 'scores.filter.more'}
              />
            </summary>
            <form
              method="get"
              action={`/${locale}/scores`}
              className="mt-2 flex flex-wrap items-end gap-3"
            >
              {hidden([['date', q.date === q.today ? null : q.date], zoneField, ...flagFields])}
              {select(
                'country',
                say('scores.filter.country'),
                say('scores.filter.allCountries'),
                options.countries,
                filters.country,
              )}
              {select(
                'competition',
                say('scores.filter.competition'),
                say('scores.filter.allCompetitions'),
                options.competitions,
                filters.competition,
              )}
              {select(
                'stage',
                say('scores.filter.stage'),
                say('scores.filter.allStages'),
                options.stages,
                filters.stage,
              )}
              <Button type="submit" className="min-h-11 font-medium">
                <Translated locale={locale} message="scores.filter.apply" />
              </Button>
              {filtered && (
                <Link
                  href={clearFiltersHref}
                  className="inline-flex min-h-11 items-center px-2 underline"
                >
                  <Translated locale={locale} message="scores.filter.clear" />
                </Link>
              )}
            </form>
          </details>
        )}

      {!result.ok ? (
        <Notice tone="danger" data-testid="scores-unreachable">
          <Translated
            locale={locale}
            message={result.status === 401 ? 'scores.signInFavourites' : 'scores.unreachable'}
          />
        </Notice>
      ) : (
        <>
          {trouble !== null && (
            <p role="status" className="text-sm font-medium" data-testid="feed-notice">
              <FilledMessage
                message={message(
                  resolved,
                  trouble.kind === 'failure' ? 'scores.feed.failure' : 'scores.feed.partial',
                )}
                params={{ time: trouble.at }}
              />
            </p>
          )}
          {/* The snapshot renders now; the client keeps it current over SSE (T-032). */}
          <LiveScores
            initial={result.data}
            streamQuery={apiQuery(q)}
            timeZone={q.timezone}
            locale={locale}
            filters={filters}
            clearFiltersHref={clearFiltersHref}
            products={products}
            words={scoresWords(locale)}
          />
        </>
      )}
    </main>
  );
}
