import type { ReactNode } from 'react';
import { formatNumber } from '@/i18n/format';
import type { CardForecast } from '@/lib/score-card-products';
import { ForecastReceipt, ForecastStrip, type ForecastBarWords } from '@/components/forecast-bar';
import { MessageText } from '@/components/message-text';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { cx } from '@/components/ui/cx';
import Link from '@/components/ui/link';

/**
 * One match in a list (the Design System's `MatchRow`, T-1508, D-263): the
 * status column, both teams stacked with home first, and at the end the
 * score -- or, before kick-off, the model's three percentages over a thin
 * bar, with the model's receipt on a line of its own under the row
 * (blueprint 6.2). A scheduled match with no forecast says "No forecast" in
 * a coverage badge, never an empty bar (rule 3); one whose forecast could
 * not be loaded says that instead.
 *
 * At full time the winner is bold and the loser muted; a draw keeps both in
 * ink. A live score is in the live saffron. The whole row is one link to the
 * match centre, at least 52px tall. The words (status, day, note) are the
 * caller's, already in the reader's language, and every figure is formatted
 * for the locale; the grid follows the reading direction, so on `/fa` the
 * status is on the right and the score on the left. Server-component safe.
 */

export type MatchRowStatus = 'scheduled' | 'live' | 'ft' | 'off';

export interface MatchRowSide {
  name: string;
  /** The goals, when the match has a score; null shows none rather than a 0. */
  score: number | null;
  /**
   * The crest as an element (`EntityImage`); `null` when the feed has none,
   * which draws an empty circle; left out where the list carries no crests.
   */
  crest?: ReactNode;
}

export function MatchRow({
  href,
  status,
  when,
  sub,
  home,
  away,
  model,
  locale,
  timeZone,
  zone,
  testId = 'match-row',
}: {
  href: string;
  /** `off`: postponed, suspended, cancelled, abandoned -- said in the warning colour. */
  status: MatchRowStatus;
  /** The status column's first line: the minute, "FT", the kick-off time, "Postponed". */
  when: ReactNode;
  /** Its small second line: "Live", the day, a note ("Pens"). */
  sub?: ReactNode;
  home: MatchRowSide;
  away: MatchRowSide;
  /**
   * The model's pre-kick-off forecast and the bar's words, shown while the
   * match is scheduled. Left out where the list does not carry the model: the
   * end column then stays empty rather than claiming there is no forecast.
   */
  model?: { forecast: CardForecast; words: ForecastBarWords };
  locale: string;
  timeZone: string;
  /** The page's zone in words, said after the receipt's time. */
  zone?: string;
  testId?: string;
}) {
  const winner =
    status === 'ft' && home.score !== null && away.score !== null && home.score !== away.score
      ? home.score > away.score
        ? 'home'
        : 'away'
      : null;
  const team = (side: 'home' | 'away', { name, crest }: MatchRowSide) => (
    <span
      className={cx(
        'flex min-w-0 items-center gap-2 text-[0.9375rem] leading-tight font-semibold font-stretch-semi-condensed',
        winner === side && 'font-bold',
        winner !== null && winner !== side && 'font-medium text-muted',
      )}
      data-side={side}
    >
      {crest === null ? (
        <span
          aria-hidden="true"
          className="size-4.5 shrink-0 rounded-full border border-default"
          data-crest="missing"
        />
      ) : (
        crest
      )}
      <bdi className="min-w-0 truncate">{name}</bdi>
    </span>
  );
  const scheduled = status === 'scheduled';
  const forecast = model?.forecast;
  const available = forecast?.state === 'available' ? forecast : null;
  return (
    <li className="border-b border-default bg-surface last:border-b-0" data-testid={testId}>
      <Link
        href={href}
        className="grid min-h-13 grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2 hover:bg-surface-raised"
        data-status={status}
        data-forecast={scheduled ? forecast?.state : undefined}
      >
        <span className="flex flex-col gap-0.5 text-[0.8125rem] font-bold tabular-nums">
          <span
            className={cx(
              status === 'live' && 'font-extrabold text-live',
              status === 'ft' && 'text-muted',
              status === 'off' && 'text-warning',
            )}
            data-testid="match-row-when"
          >
            {when}
          </span>
          {sub !== undefined && (
            <span className="text-[0.625rem] font-medium text-caption">{sub}</span>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-1.5">
          {team('home', home)}
          {team('away', away)}
        </span>
        {scheduled && model === undefined ? (
          <span />
        ) : scheduled && model !== undefined ? (
          available !== null ? (
            <ForecastStrip
              forecast={available}
              home={home.name}
              away={away.name}
              locale={locale}
              words={model.words}
              compact
              className="w-30"
            />
          ) : (
            <CoverageBadge
              state={forecast?.state === 'unreachable' ? 'delayed' : 'not_supplied'}
              label={
                <MessageText
                  message={
                    model.words[
                      forecast?.state === 'unreachable'
                        ? 'forecastBar.notLoaded'
                        : 'forecastBar.noForecast'
                    ]
                  }
                />
              }
            />
          )
        ) : (
          <span
            className={cx(
              'flex flex-col items-end gap-1.5 text-base leading-none font-extrabold tabular-nums font-stretch-condensed',
              status === 'live' && 'text-live',
            )}
            data-testid="match-row-score"
          >
            <span>{home.score === null ? '–' : formatNumber(locale, home.score)}</span>
            <span>{away.score === null ? '–' : formatNumber(locale, away.score)}</span>
          </span>
        )}
        {scheduled && model !== undefined && available !== null && (
          <ForecastReceipt
            forecast={available}
            locale={locale}
            timeZone={timeZone}
            zone={zone}
            words={model.words}
            className="col-span-2 col-start-2"
          />
        )}
      </Link>
    </li>
  );
}
