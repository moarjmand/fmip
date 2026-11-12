import type { CardForecast } from '@/lib/score-card-products';
import { formatNumber, formatVersionStamp } from '@/i18n/format';
import { FORECAST_REASON_KEY, filled, formatPercent } from '@/lib/words';
import type { ScoresWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import { ForecastBar, type Outcome } from '@/components/forecast-bar';
import { MessageText } from '@/components/message-text';
import { LtrNumeric } from '@/components/score';
import { CoverageBadge } from '@/components/ui/coverage-badge';

/**
 * The statistical model's line on a scores card (T-940, D-114). Only the
 * model: this component takes a `CardForecast` and nothing else, so it cannot
 * be handed the community's totals (rule 6, `three-products.spec.ts`). Its
 * label, `scores.card.model.label`, names whose line it is ("Model forecast:"),
 * and the available line says it is the statistical model's.
 *
 * The version shown is the latest computed before kick-off, and the line says
 * which version and when. Anything short of three percentages is a sentence
 * saying why, never an empty bar (rule 3). The words are the reader's
 * (T-1303), resolved on the server and handed down.
 */
export function CardForecastSummary({
  forecast,
  home,
  away,
  started,
  locale,
  timeZone,
  words,
}: {
  forecast: CardForecast | undefined;
  home: string;
  away: string;
  /** The match has kicked off, so "not yet" would be the wrong sentence. */
  started: boolean;
  locale: string;
  timeZone: string;
  words: ScoresWords;
}) {
  const f = forecast ?? { state: 'not_loaded' as const };
  const m = words.m;
  const pct = (value: number) => <LtrNumeric>{formatPercent(locale, value)}</LtrNumeric>;
  return (
    <p className="flex flex-wrap gap-x-2" data-testid="card-forecast" data-state={f.state}>
      <MessageText message={m['scores.card.model.label']} className="font-medium" />
      {f.state === 'available' ? (
        <>
          <span>
            <bdi>{home}</bdi> {pct(f.home)}
          </span>
          <span>
            <MessageText message={m['scores.card.draw']} /> {pct(f.draw)}
          </span>
          <span>
            <bdi>{away}</bdi> {pct(f.away)}
          </span>
          <FilledMessage
            className="text-muted"
            message={m['scores.card.model.version']}
            params={{
              version: formatNumber(locale, f.version),
              time: (
                <time dateTime={f.computed_at}>
                  {formatVersionStamp(locale, f.computed_at, timeZone)}
                </time>
              ),
            }}
          />
        </>
      ) : f.state === 'unavailable' ? (
        <MessageText
          className="text-muted"
          message={filled(m['scores.card.model.noProbabilities'], {
            version: formatNumber(locale, f.version),
            reason:
              m[
                f.reason === null
                  ? 'scores.card.model.couldNotAnswer'
                  : FORECAST_REASON_KEY[f.reason]
              ].text,
          })}
        />
      ) : f.state === 'none' ? (
        <MessageText
          className="text-muted"
          message={m[started ? 'scores.card.model.noneBefore' : 'scores.card.model.notYet']}
        />
      ) : f.state === 'unreachable' ? (
        <MessageText className="text-muted" message={m['scores.card.lineUnreachable']} />
      ) : (
        <MessageText className="text-muted" message={m['scores.card.lineNotLoaded']} />
      )}
    </p>
  );
}

/**
 * The model's cell on a match row (T-1496; T-1748, D-368): the one
 * `ForecastBar` at `row` size -- an 8px bar in the model's three steps and
 * the three whole percentages, each over its own segment, home, draw, away
 * (rule 6: the model's and nothing else's). After full time the outcome that
 * happened is outlined and ticked (T-1749, D-369). The version and the
 * computation time are the preview's (`CardForecastSummary`), one press
 * away. No forecast is the "Not supplied" badge, never an empty bar (rule 3);
 * a batch that did not answer says it was not loaded. The three whole numbers
 * total 100, as blueprint 6.2 asks of every rounding (T-1545).
 */
export function RowForecast({
  forecast,
  home,
  away,
  outcome = null,
  locale,
  words,
  className = '',
}: {
  forecast: CardForecast | undefined;
  home: string;
  away: string;
  /** What happened in the ninety minutes, once the match is over (`ninetyOutcome` in `forecast-bar.tsx`). */
  outcome?: Outcome | null;
  locale: string;
  words: ScoresWords;
  /** Where the row places the cell (under the teams on a phone, T-1545). */
  className?: string;
}) {
  const f = forecast ?? { state: 'not_loaded' as const };
  const m = words.m;
  if (f.state === 'none' || f.state === 'unavailable') {
    // On every row without a forecast (D-374 D6), drawn quietly: the words and
    // the glyph, no pill, at the cell's end (T-1780, D-386, board P6-6 B).
    return (
      <span
        className={`min-w-0 text-end ${className}`}
        data-testid="row-forecast"
        data-state={f.state}
      >
        <CoverageBadge
          plain
          state="not_supplied"
          label={<MessageText message={m['status.coverage.notSupplied']} />}
        />
      </span>
    );
  }
  if (f.state !== 'available') {
    return (
      <span
        className={`min-w-0 text-xs text-muted ${className}`}
        data-testid="row-forecast"
        data-state={f.state}
      >
        <MessageText message={m['scores.row.modelNotLoaded']} />
      </span>
    );
  }
  return (
    <div className={`min-w-0 ${className}`} data-testid="row-forecast" data-state="available">
      <ForecastBar
        forecast={f}
        size="row"
        home={home}
        away={away}
        outcome={outcome}
        locale={locale}
        words={{
          'forecastBar.label': m['forecastBar.label'],
          'forecastBar.happened': m['forecastBar.happened'],
          'forecast.draw': m['scores.card.draw'],
        }}
        testId="row-bar"
      />
    </div>
  );
}
