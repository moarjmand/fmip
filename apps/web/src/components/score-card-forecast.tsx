import type { CardForecast } from '@/lib/score-card-products';
import { formatDate } from '@/i18n/format';
import { LtrNumeric } from '@/components/score';

/**
 * The statistical model's line on a scores card (T-940, D-114). Only the
 * model: this component takes a `CardForecast` and nothing else, so it cannot
 * be handed the community's totals (rule 6, `three-products.spec.ts`).
 *
 * The version shown is the latest computed before kick-off, and the line says
 * which version and when. Anything short of three percentages is a sentence
 * saying why, never an empty bar (rule 3).
 */
export function CardForecastSummary({
  forecast,
  home,
  away,
  started,
  locale,
  timeZone,
}: {
  forecast: CardForecast | undefined;
  home: string;
  away: string;
  /** The match has kicked off, so "not yet" would be the wrong sentence. */
  started: boolean;
  locale: string;
  timeZone: string;
}) {
  const f = forecast ?? { state: 'not_loaded' as const };
  return (
    <p className="flex flex-wrap gap-x-2" data-testid="card-forecast" data-state={f.state}>
      <span className="font-medium">Model forecast:</span>
      {f.state === 'available' ? (
        <>
          <span>
            <bdi>{home}</bdi> <LtrNumeric>{`${f.home.toFixed(1)}%`}</LtrNumeric>
          </span>
          <span>
            Draw <LtrNumeric>{`${f.draw.toFixed(1)}%`}</LtrNumeric>
          </span>
          <span>
            <bdi>{away}</bdi> <LtrNumeric>{`${f.away.toFixed(1)}%`}</LtrNumeric>
          </span>
          <span className="text-muted">
            the statistical model, version {f.version}, computed{' '}
            <time dateTime={f.computed_at}>
              {formatDate(locale, f.computed_at, timeZone, {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
              })}
            </time>
            , before kick-off
          </span>
        </>
      ) : f.state === 'unavailable' ? (
        <span className="text-muted">
          no probabilities in version {f.version}. {f.reason}
        </span>
      ) : f.state === 'none' ? (
        <span className="text-muted">
          {started
            ? 'the model had no forecast for this match before kick-off.'
            : 'the model has not forecast this match yet.'}
        </span>
      ) : f.state === 'unreachable' ? (
        <span className="text-muted">
          could not be loaded for this page. The match centre has it.
        </span>
      ) : (
        <span className="text-muted">not loaded for this list. The match centre has it.</span>
      )}
    </p>
  );
}
