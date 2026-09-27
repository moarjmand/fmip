import type { RatingHistoryResponse } from '@fmip/contracts';
import { formatDate } from '@/i18n/format';
import type { Direction } from '@/i18n/locales';
import type { ApiResult } from '@/lib/api';
import {
  CHART,
  accuracyLabel,
  chartGeometry,
  chartSummary,
  dayInstant,
} from '@/lib/rating-history';

/**
 * A member's rating over time, by competition, and their highest (blueprint
 * 9.3, T-640). Every number is the API's, recomputed from stored settlements;
 * this component draws and labels, and computes nothing a rating depends on.
 *
 * The chart is inline SVG with no library. It is `role="img"` with a sentence
 * for a label, and the same points are in a table for a screen reader, so the
 * picture is never the only place a number lives.
 */
export function RatingHistorySection({
  locale,
  direction,
  result,
}: {
  locale: string;
  direction: Direction;
  result: ApiResult<RatingHistoryResponse>;
}) {
  const day = (date: string): string =>
    formatDate(locale, dayInstant(date), 'UTC', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  if (!result.ok) {
    return (
      <p role="alert" className="text-sm" data-testid="rating-history-unreachable">
        The rating history cannot be shown right now.
      </p>
    );
  }
  const view = result.data;
  if (view.kind === 'restricted') {
    return (
      <p className="text-sm opacity-70" data-testid="rating-history-restricted">
        {view.visibility === 'friends'
          ? 'The rating history is visible to friends only.'
          : 'The rating history is private.'}
      </p>
    );
  }
  const history = view.history;
  if (history === null) {
    return (
      <p className="text-sm opacity-70" data-testid="rating-history-none">
        Nothing has settled yet, so there is no rating to follow over time.
      </p>
    );
  }

  const geometry = chartGeometry(history.points, direction);
  const summary = chartSummary(history.points, day);
  const lastPoint = geometry.points.at(-1);

  return (
    <div className="flex flex-col gap-4" data-testid="rating-history">
      <figure className="flex flex-col gap-1">
        <svg
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          className="h-auto w-full"
          role="img"
          aria-label={summary}
          data-testid="rating-history-chart"
        >
          {geometry.guides.map((guide) => (
            <line
              key={guide.rating}
              x1={0}
              x2={CHART.width}
              y1={guide.y}
              y2={guide.y}
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeDasharray={guide.rating === 50 ? '4 4' : undefined}
            />
          ))}
          {geometry.path !== '' && (
            <path
              d={geometry.path}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {lastPoint !== undefined && (
            <circle cx={lastPoint.x} cy={lastPoint.y} r={4} fill="currentColor" />
          )}
        </svg>
        <figcaption className="flex justify-between text-xs opacity-60" aria-hidden="true">
          <span>{day(history.points[0]?.date ?? '')}</span>
          <span>0–100</span>
          <span>{day(history.points.at(-1)?.date ?? '')}</span>
        </figcaption>
      </figure>

      <table className="sr-only" data-testid="rating-history-table">
        <caption>Rating at the end of each day with a settled prediction</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Rating</th>
            <th scope="col">Settled so far</th>
          </tr>
        </thead>
        <tbody>
          {history.points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{day(point.date)}</th>
              <td>
                {point.rating.toFixed(1)}
                {point.provisional ? ' (provisional)' : ''}
              </td>
              <td>{point.settled_total}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-sm" data-testid="rating-highest">
        Highest:{' '}
        <span className="font-semibold tabular-nums">{history.highest.rating.toFixed(1)}</span>, on{' '}
        <time dateTime={history.highest.settled_at}>{day(history.highest.date)}</time>
        {history.highest.provisional ? ' (while still provisional)' : ''}.
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">By competition</h3>
        <table className="w-full text-sm" data-testid="rating-by-competition">
          <thead>
            <tr className="text-xs uppercase opacity-60">
              <th scope="col" className="text-start font-normal">
                Competition
              </th>
              <th scope="col" className="text-start font-normal">
                Outcomes
              </th>
              <th scope="col" className="text-end font-normal">
                Exact scores
              </th>
              <th scope="col" className="text-end font-normal">
                Rating
              </th>
            </tr>
          </thead>
          <tbody>
            {history.by_competition.map((entry) => (
              <tr key={entry.competition.id}>
                <th scope="row" className="text-start font-normal">
                  {entry.competition.name}
                </th>
                <td>{accuracyLabel(entry)}</td>
                <td className="text-end tabular-nums">{entry.score_correct}</td>
                <td className="text-end tabular-nums">
                  {entry.rating.toFixed(1)}
                  {entry.provisional ? (
                    <span className="ms-1 text-xs opacity-60">provisional</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs opacity-60">
          Each competition is rated on its own predictions under {history.formula_version}.
        </p>
      </div>
    </div>
  );
}
