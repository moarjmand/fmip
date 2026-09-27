import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveScores } from '@/components/live-scores';
import { fetchIngestionHealth, fetchMe, fetchScores } from '@/lib/api';
import { feedNotice } from '@/lib/live';
import { apiQuery, dayStrip, pageHref, readScoresQuery, shiftDate } from '@/lib/scores';
import {
  filterOptions,
  filterParams,
  isFiltered,
  NO_FILTERS,
  withSelected,
  type FilterOption,
} from '@/lib/scores-filters';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/scores',
    title: 'Scores · FMIP',
    description: 'Live scores and fixtures, one day at a time in your time zone.',
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
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const q = readScoresQuery(query, me?.timezone ?? null);
  const [result, ingestion] = await Promise.all([
    fetchScores(apiQuery(q), cookie),
    fetchIngestionHealth(),
  ]);
  // A provider outage is named on the page (T-083), never hidden behind old numbers.
  const notice = feedNotice(ingestion, locale, q.timezone);
  const strip = dayStrip(q, locale);
  const linkClass = (active: boolean): string =>
    `rounded px-2 py-1 ${active ? 'bg-current/10 font-semibold' : 'underline'}`;
  const filters = q.filters ?? NO_FILTERS;
  const filtered = isFiltered(filters);
  const clearFiltersHref = pageHref(locale, q, { filters: NO_FILTERS });
  const options = result.ok ? filterOptions(result.data) : null;
  const inputClass = 'rounded border border-current/30 bg-transparent px-2 py-1';
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
          className={`${inputClass} max-w-full`}
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
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        Scores
      </h1>

      <nav aria-label="Day" className="flex flex-wrap gap-1 text-sm" data-testid="day-strip">
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

      <div className="flex flex-wrap items-end gap-2 text-sm" data-testid="date-picker">
        <Link
          href={pageHref(locale, q, { date: shiftDate(q.date, -1) })}
          className="rounded px-2 py-1 underline"
          data-testid="previous-day"
        >
          Previous day
        </Link>
        <form method="get" action={`/${locale}/scores`} className="flex items-end gap-2">
          {hidden([zoneField, ...flagFields, ...filterParams(filters)])}
          <label className="flex flex-col gap-1">
            <span>Date</span>
            <input
              type="date"
              name="date"
              required
              defaultValue={q.date}
              className={inputClass}
              data-testid="date-input"
            />
          </label>
          <button type="submit" className={`${inputClass} font-medium`}>
            Show day
          </button>
        </form>
        <Link
          href={pageHref(locale, q, { date: shiftDate(q.date, 1) })}
          className="rounded px-2 py-1 underline"
          data-testid="next-day"
        >
          Next day
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="filters">
        <Link href={pageHref(locale, q, { live: false })} className={linkClass(!q.live)}>
          All
        </Link>
        <Link href={pageHref(locale, q, { live: true })} className={linkClass(q.live)}>
          Live
        </Link>
        {me !== null && (
          <Link
            href={pageHref(locale, q, { favourites: !q.favourites })}
            className={linkClass(q.favourites)}
            aria-pressed={q.favourites}
          >
            Favourites only
          </Link>
        )}
        <span className="ms-auto opacity-70" data-testid="timezone">
          Times in {q.timezone}
          {me === null && !q.explicitTimezone ? ' (sign in for your own zone)' : ''}
        </span>
      </div>

      {options !== null &&
        (filtered ||
          options.countries.length + options.competitions.length + options.stages.length > 0) && (
          <details open={filtered} className="text-sm" data-testid="more-filters">
            <summary className="cursor-pointer font-medium">
              Country, competition and stage{filtered ? ' (filtered)' : ''}
            </summary>
            <form
              method="get"
              action={`/${locale}/scores`}
              className="mt-2 flex flex-wrap items-end gap-3"
            >
              {hidden([['date', q.date === q.today ? null : q.date], zoneField, ...flagFields])}
              {select('country', 'Country', 'All countries', options.countries, filters.country)}
              {select(
                'competition',
                'Competition',
                'All competitions',
                options.competitions,
                filters.competition,
              )}
              {select('stage', 'Stage', 'All stages', options.stages, filters.stage)}
              <button type="submit" className={`${inputClass} font-medium`}>
                Apply
              </button>
              {filtered && (
                <Link href={clearFiltersHref} className="px-2 py-1 underline">
                  Clear filters
                </Link>
              )}
            </form>
          </details>
        )}

      {!result.ok ? (
        <p role="alert" data-testid="scores-unreachable">
          {result.status === 401
            ? 'Sign in to filter by your favourites.'
            : 'The scores service is unreachable right now, so nothing can be shown for this day.'}
        </p>
      ) : (
        <>
          {notice !== null && (
            <p role="status" className="text-sm font-medium" data-testid="feed-notice">
              {notice}
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
          />
        </>
      )}
    </main>
  );
}
