import type { RatingHistoryResponse } from '@fmip/contracts';
import { formatDate, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, type Direction, directionOf, isLocale, type Locale } from '@/i18n/locales';
import { type MessageKey, interpolate, message, t } from '@/i18n/messages';
import type { ApiResult } from '@/lib/api';
import {
  CHART,
  accuracyLabel,
  chartGeometry,
  chartSummary,
  dayInstant,
  ratingFigure,
} from '@/lib/rating-history';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';

/**
 * A sentence with elements in it: `{name}` placeholders in the locale's own
 * word order, each filled with a node, so a figure or a `<time>` keeps its
 * markup wherever the language puts it. English standing in for a missing
 * translation is marked as `Translated` marks it.
 */
function Sentence({
  locale,
  message: key,
  nodes,
}: {
  locale: Locale;
  message: MessageKey;
  nodes: Record<string, React.ReactNode>;
}) {
  const { text, status } = message(locale, key);
  const parts = text.split(/(\{[a-zA-Z]+\})/).map((part, index) => {
    const name = /^\{([a-zA-Z]+)\}$/.exec(part)?.[1];
    return name !== undefined && name in nodes ? <span key={index}>{nodes[name]}</span> : part;
  });
  return status === 'untranslated' ? (
    <span lang={DEFAULT_LOCALE} dir={directionOf(DEFAULT_LOCALE)} data-translation="untranslated">
      {parts}
    </span>
  ) : (
    <>{parts}</>
  );
}

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
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const day = (date: string): string =>
    formatDate(locale, dayInstant(date), 'UTC', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  if (!result.ok) {
    return (
      <Notice tone="danger" data-testid="rating-history-unreachable">
        <Translated locale={locale} message="profile.ratingHistory.unreachable" />
      </Notice>
    );
  }
  const view = result.data;
  if (view.kind === 'restricted') {
    return (
      <p className="text-sm text-muted" data-testid="rating-history-restricted">
        <Translated
          locale={locale}
          message={
            view.visibility === 'friends'
              ? 'profile.ratingHistory.restrictedFriends'
              : 'profile.ratingHistory.restrictedPrivate'
          }
        />
      </p>
    );
  }
  const history = view.history;
  if (history === null) {
    return (
      <p className="text-sm text-muted" data-testid="rating-history-none">
        <Translated locale={locale} message="profile.ratingHistory.none" />
      </p>
    );
  }

  const geometry = chartGeometry(history.points, direction);
  const summary = chartSummary(history.points, day, lang);
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
        <figcaption className="flex justify-between text-xs text-muted" aria-hidden="true">
          <span>{day(history.points[0]?.date ?? '')}</span>
          <span>
            {formatNumber(lang, 0)}–{formatNumber(lang, 100)}
          </span>
          <span>{day(history.points.at(-1)?.date ?? '')}</span>
        </figcaption>
      </figure>

      <table className="sr-only" data-testid="rating-history-table">
        <caption>
          <Translated locale={locale} message="profile.ratingHistory.caption" />
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <Translated locale={locale} message="profile.ratingHistory.date" />
            </th>
            <th scope="col">
              <Translated locale={locale} message="profile.rating.rating" />
            </th>
            <th scope="col">
              <Translated locale={locale} message="profile.ratingHistory.settledSoFar" />
            </th>
          </tr>
        </thead>
        <tbody>
          {history.points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{day(point.date)}</th>
              <td>
                {point.provisional
                  ? interpolate(t(lang, 'profile.ratingHistory.provisionalValue'), {
                      rating: ratingFigure(lang, point.rating),
                    })
                  : ratingFigure(lang, point.rating)}
              </td>
              <td>{formatNumber(lang, point.settled_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-sm" data-testid="rating-highest">
        <Sentence
          locale={lang}
          message={
            history.highest.provisional
              ? 'profile.ratingHistory.highestProvisional'
              : 'profile.ratingHistory.highest'
          }
          nodes={{
            rating: (
              <span className="font-semibold tabular-nums">
                {ratingFigure(lang, history.highest.rating)}
              </span>
            ),
            date: <time dateTime={history.highest.settled_at}>{day(history.highest.date)}</time>,
          }}
        />
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">
          <Translated locale={locale} message="profile.ratingHistory.byCompetition" />
        </h3>
        <table className="w-full text-sm" data-testid="rating-by-competition">
          <thead>
            <tr className="text-xs uppercase text-muted">
              <th scope="col" className="text-start font-normal">
                <Translated locale={locale} message="profile.ratingHistory.competition" />
              </th>
              <th scope="col" className="text-start font-normal">
                <Translated locale={locale} message="profile.ratingHistory.outcomes" />
              </th>
              <th scope="col" className="text-end font-normal">
                <Translated locale={locale} message="profile.ratingHistory.exactScores" />
              </th>
              <th scope="col" className="text-end font-normal">
                <Translated locale={locale} message="profile.rating.rating" />
              </th>
            </tr>
          </thead>
          <tbody>
            {history.by_competition.map((entry) => (
              <tr key={entry.competition.id}>
                <th scope="row" className="text-start font-normal">
                  {entry.competition.name}
                </th>
                <td>{accuracyLabel(entry, lang)}</td>
                <td className="text-end tabular-nums">{formatNumber(lang, entry.score_correct)}</td>
                <td className="text-end tabular-nums">
                  {ratingFigure(lang, entry.rating)}
                  {entry.provisional ? (
                    <span className="ms-1 text-xs text-muted">
                      <Translated locale={locale} message="profile.ratingHistory.provisional" />
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          {interpolate(t(lang, 'profile.ratingHistory.formula'), {
            version: history.formula_version,
          })}
        </p>
      </div>
    </div>
  );
}
