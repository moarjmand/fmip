import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchLeaderboard } from '@/lib/api';
import {
  apiQuery,
  emptyBoardSentence,
  languageLabel,
  monthLabel,
  pageCount,
  pageHref,
  boardExplainer,
  ratingLabel,
  readLeaderboardQuery,
  statusLabel,
  tierLabel,
} from '@/lib/leaderboard';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';
import { Translated } from '@/components/translated';
import { MemberName } from '@/components/member-name';
import { UNFINISHED_LOCALES } from '@/i18n/locales';
import { Stamp } from '@/components/stamp';
import { attribute, interpolate, message, t } from '@/i18n/messages';
import { asLocale, plainNumber, richMessage } from '@/lib/prediction-text';

/** The languages a board can be drawn by (T-844): the ones the site is offered in. */
const BOARD_LANGUAGES: readonly string[] = ['en', ...UNFINISHED_LOCALES];

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l = asLocale(locale);
  return pageMetadata({
    locale,
    path: '/leaderboard',
    title: t(l, 'leaderboardPage.title'),
    description: t(l, 'leaderboardPage.description'),
  });
}

/**
 * The leaderboard (blueprint 9.3, T-055): members ranked by their current
 * Performance Rating behind a minimum-sample filter, so a member with one
 * lucky result never ranks above established performers. The filter's floor
 * and presets come from the API, not from this page; an unreachable API is
 * said out loud rather than shown as an empty board.
 *
 * T-641: a scope switcher (everyone, or you and your friends) and a period
 * switcher (all time, a month, a season), all plain links so they work with
 * no JavaScript. The month and season pickers list what the API says has
 * settled predictions. A friends board without a session is a sentence
 * asking the visitor to sign in, not an empty table.
 */
export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const l = asLocale(locale);
  const q = readLeaderboardQuery(query);
  const cookie = await sessionCookieHeader();
  const result = await fetchLeaderboard(apiQuery(q), cookie);
  const linkClass = (active: boolean): string =>
    `rounded px-2 py-1 ${active ? 'bg-surface-raised font-semibold' : 'underline'}`;

  const scopes = [
    { scope: 'everyone', label: 'leaderboardPage.everyone' },
    { scope: 'friends', label: 'leaderboardPage.friends' },
  ] as const;
  const periods = [
    { period: 'all', label: 'leaderboardPage.allTime' },
    { period: 'month', label: 'leaderboardPage.byMonth' },
    { period: 'season', label: 'leaderboardPage.bySeason' },
  ] as const;
  const boardNav = attribute(l, 'leaderboardPage.board');
  const pagesNav = attribute(l, 'leaderboardPage.pages');

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={l} message="nav.leaderboard" />
      </h1>

      <nav aria-label={boardNav.text} lang={boardNav.lang} className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2" data-testid="scope-switcher">
          <span className="text-muted">
            <Translated locale={l} message="leaderboardPage.who" />
          </span>
          {scopes.map(({ scope, label }) => (
            <Link
              key={scope}
              href={pageHref(locale, q, { scope, page: 1 })}
              aria-current={q.scope === scope ? 'true' : undefined}
              className={linkClass(q.scope === scope)}
            >
              <Translated locale={l} message={label} />
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="period-switcher">
          <span className="text-muted">
            <Translated locale={l} message="leaderboardPage.when" />
          </span>
          {periods.map(({ period, label }) => (
            <Link
              key={period}
              href={pageHref(locale, q, { period, month: null, season: null, page: 1 })}
              aria-current={q.period === period ? 'true' : undefined}
              className={linkClass(q.period === period)}
            >
              <Translated locale={l} message={label} />
            </Link>
          ))}
        </div>
      </nav>

      {!result.ok ? (
        result.status === 401 && q.scope === 'friends' ? (
          <p data-testid="leaderboard-sign-in">
            {richMessage(message(l, 'leaderboardPage.friendsSignIn'), {
              signIn: (
                <Link href={`/${locale}/login`} className="underline">
                  <Translated locale={l} message="predictions.section.signIn" />
                </Link>
              ),
            })}
          </p>
        ) : result.status === 400 ? (
          <Notice tone="warning" data-testid="leaderboard-invalid">
            {richMessage(message(l, 'leaderboardPage.invalid'), {
              link: (
                <Link
                  href={pageHref(locale, q, {
                    min: null,
                    page: 1,
                    period: 'all',
                    month: null,
                    season: null,
                    competition: null,
                    language: null,
                  })}
                  className="underline"
                >
                  <Translated locale={l} message="leaderboardPage.defaultBoard" />
                </Link>
              ),
            })}
          </Notice>
        ) : (
          <Notice tone="danger" data-testid="leaderboard-unreachable">
            <Translated locale={l} message="leaderboardPage.unreachable" />
          </Notice>
        )
      ) : (
        <>
          {result.data.period.kind === 'month' && (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="month-picker">
              <span className="text-muted">
                <Translated locale={l} message="leaderboardPage.month" />
              </span>
              {pickerChoices(result.data.available_periods.months, result.data.period.month).map(
                (month) => (
                  <Link
                    key={month}
                    href={pageHref(locale, q, { month, page: 1 })}
                    aria-current={
                      result.data.period.kind === 'month' && result.data.period.month === month
                        ? 'true'
                        : undefined
                    }
                    className={linkClass(
                      result.data.period.kind === 'month' && result.data.period.month === month,
                    )}
                  >
                    {monthLabel(month, locale)}
                  </Link>
                ),
              )}
            </div>
          )}
          {result.data.period.kind === 'season' && result.data.period.label !== null && (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="season-picker">
              <span className="text-muted">
                <Translated locale={l} message="leaderboardPage.season" />
              </span>
              {pickerChoices(result.data.available_periods.seasons, result.data.period.label).map(
                (season) => (
                  <Link
                    key={season}
                    href={pageHref(locale, q, { season, page: 1 })}
                    aria-current={
                      result.data.period.kind === 'season' && result.data.period.label === season
                        ? 'true'
                        : undefined
                    }
                    className={linkClass(
                      result.data.period.kind === 'season' && result.data.period.label === season,
                    )}
                  >
                    {season}
                  </Link>
                ),
              )}
            </div>
          )}

          {(result.data.available_competitions.length > 0 || result.data.competition !== null) && (
            <div
              className="flex flex-wrap items-center gap-2 text-sm"
              data-testid="competition-picker"
            >
              <span className="text-muted">
                <Translated locale={locale} message="leaderboard.competition.label" />
              </span>
              <Link
                href={pageHref(locale, q, { competition: null, page: 1 })}
                aria-current={result.data.competition === null ? 'true' : undefined}
                className={linkClass(result.data.competition === null)}
              >
                <Translated locale={locale} message="leaderboard.competition.all" />
              </Link>
              {competitionChoices(result.data.available_competitions, result.data.competition).map(
                (competition) => (
                  <Link
                    key={competition.id}
                    href={pageHref(locale, q, { competition: competition.id, page: 1 })}
                    aria-current={
                      result.data.competition?.id === competition.id ? 'true' : undefined
                    }
                    className={linkClass(result.data.competition?.id === competition.id)}
                  >
                    {competition.name}
                  </Link>
                ),
              )}
            </div>
          )}

          <div className="flex flex-col gap-1 text-sm" data-testid="language-picker">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">
                <Translated locale={locale} message="leaderboard.language.label" />
              </span>
              <Link
                href={pageHref(locale, q, { language: null, page: 1 })}
                aria-current={result.data.language === null ? 'true' : undefined}
                className={linkClass(result.data.language === null)}
              >
                <Translated locale={locale} message="leaderboard.language.all" />
              </Link>
              {BOARD_LANGUAGES.map((language) => (
                <Link
                  key={language}
                  href={pageHref(locale, q, { language, page: 1 })}
                  aria-current={result.data.language === language ? 'true' : undefined}
                  className={linkClass(result.data.language === language)}
                >
                  {languageLabel(language, locale)}
                </Link>
              ))}
            </div>
            {result.data.language !== null && (
              <p className="text-muted" data-testid="language-note">
                <Translated locale={locale} message="leaderboard.language.note" />
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="min-sample">
            <span className="text-muted">
              <Translated locale={l} message="leaderboardPage.minSample" />
            </span>
            {result.data.presets.map((preset) => (
              <Link
                key={preset}
                href={pageHref(locale, q, {
                  min: preset === result.data.floor ? null : preset,
                  page: 1,
                })}
                aria-current={preset === result.data.min_settled ? 'true' : undefined}
                className={linkClass(preset === result.data.min_settled)}
              >
                {plainNumber(l, preset)}
              </Link>
            ))}
            {!result.data.presets.includes(result.data.min_settled) && (
              <span className={linkClass(true)} aria-current="true">
                {plainNumber(l, result.data.min_settled)}
              </span>
            )}
          </div>

          <p className="text-sm text-muted" data-testid="board-explainer">
            {boardExplainer(result.data, locale)}
          </p>

          {result.data.entries.length === 0 ? (
            <p data-testid="leaderboard-empty">
              {emptyBoardSentence(
                result.data.scope,
                result.data.period,
                result.data.min_settled,
                q.page > 1 && result.data.total > 0,
                locale,
                result.data.competition?.name ?? null,
                result.data.language,
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="leaderboard">
                <thead>
                  <tr className="border-b border-default text-start">
                    <th scope="col" className="py-2 pe-3 text-start">
                      #
                    </th>
                    <th scope="col" className="py-2 pe-3 text-start">
                      <Translated locale={l} message="leaderboardPage.column.member" />
                    </th>
                    <th scope="col" className="py-2 pe-3 text-end">
                      <Translated locale={l} message="leaderboardPage.column.rating" />
                    </th>
                    <th scope="col" className="py-2 pe-3 text-start">
                      <Translated locale={l} message="leaderboardPage.column.tier" />
                    </th>
                    <th scope="col" className="py-2 pe-3 text-end">
                      <Translated locale={l} message="leaderboardPage.column.settled" />
                    </th>
                    <th scope="col" className="py-2 text-start">
                      <Translated locale={l} message="leaderboardPage.column.status" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.entries.map((entry) => (
                    <tr key={entry.username} className="border-b border-default">
                      <td className="py-2 pe-3 tabular-nums">{plainNumber(l, entry.rank)}</td>
                      <td className="py-2 pe-3">
                        <MemberName locale={locale} member={entry} link className="underline" />
                      </td>
                      <td className="py-2 pe-3 text-end tabular-nums" data-testid="rating">
                        {ratingLabel(entry, l)}
                      </td>
                      <td className="py-2 pe-3">{tierLabel(entry.tier, l)}</td>
                      <td className="py-2 pe-3 text-end tabular-nums">
                        {plainNumber(l, entry.settled_count)}
                      </td>
                      <td className="py-2">{statusLabel(entry, l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <nav
            aria-label={pagesNav.text}
            lang={pagesNav.lang}
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            {q.page > 1 && (
              <Link href={pageHref(locale, q, { page: q.page - 1 })} className="underline">
                <Translated locale={l} message="leaderboardPage.previous" />
              </Link>
            )}
            <span className="text-muted">
              <Translated
                locale={l}
                message="leaderboardPage.pageOf"
                count={result.data.total}
                params={{
                  page: plainNumber(l, q.page),
                  pages: plainNumber(l, pageCount(result.data.total)),
                }}
              />
            </span>
            {q.page < pageCount(result.data.total) && (
              <Link href={pageHref(locale, q, { page: q.page + 1 })} className="underline">
                <Translated locale={l} message="leaderboardPage.next" />
              </Link>
            )}
          </nav>

          <p className="text-xs text-muted">
            {richMessage(
              {
                ...message(l, 'leaderboardPage.footer'),
                text: interpolate(t(l, 'leaderboardPage.footer'), {
                  formula: result.data.entries[0]?.formula_version ?? 'performance-rating',
                  rules: result.data.rules_version,
                }),
              },
              { time: <Stamp iso={result.data.generated_at} locale={locale} /> },
            )}
          </p>
        </>
      )}
    </main>
  );
}

/**
 * The competition picker's choices (T-843): those with settled predictions,
 * plus the one being shown if it has none yet.
 */
function competitionChoices(
  available: { id: string; name: string }[],
  selected: { id: string; name: string } | null,
): { id: string; name: string }[] {
  return selected === null || available.some((c) => c.id === selected.id)
    ? available
    : [selected, ...available];
}

/** The picker's choices: what has settled predictions, plus the one being shown if it has none. */
function pickerChoices(available: string[], selected: string): string[] {
  return available.includes(selected) ? available : [selected, ...available];
}
