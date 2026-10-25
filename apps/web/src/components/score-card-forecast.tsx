import type { CardForecast } from '@/lib/score-card-products';
import { formatNumber, formatVersionStamp } from '@/i18n/format';
import { FORECAST_REASON_KEY, filled, formatPercent } from '@/lib/words';
import type { ScoresWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
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

/** The model's three steps of its one colour, home strongest, as the bar draws them. */
const STEPS = { home: 'bg-model', draw: 'bg-model/55', away: 'bg-model/25' } as const;

/**
 * The model's cell on a match row (T-1496, the Design System's compact
 * `ForecastBar`): a thin bar and the three percentages under it, home, draw,
 * away, in the model's colour and nothing else's (rule 6). The version and
 * the computation time are the preview's (`CardForecastSummary`), one press
 * away. No forecast is the "Not supplied" badge, never an empty bar (rule 3);
 * a batch that did not answer says it was not loaded.
 */
export function RowForecast({
  forecast,
  home,
  away,
  locale,
  words,
}: {
  forecast: CardForecast | undefined;
  home: string;
  away: string;
  locale: string;
  words: ScoresWords;
}) {
  const f = forecast ?? { state: 'not_loaded' as const };
  const m = words.m;
  if (f.state === 'none' || f.state === 'unavailable') {
    return (
      <span className="min-w-0" data-testid="row-forecast" data-state={f.state}>
        <CoverageBadge
          state="not_supplied"
          label={<MessageText message={m['status.coverage.notSupplied']} />}
        />
      </span>
    );
  }
  if (f.state !== 'available') {
    return (
      <span className="min-w-0 text-xs text-muted" data-testid="row-forecast" data-state={f.state}>
        <MessageText message={m['scores.row.modelNotLoaded']} />
      </span>
    );
  }
  const outcomes = [
    { key: 'home', value: f.home },
    { key: 'draw', value: f.draw },
    { key: 'away', value: f.away },
  ] as const;
  const label = filled(m['forecastBar.label'], {
    home,
    homePct: formatPercent(locale, f.home),
    drawPct: formatPercent(locale, f.draw),
    away,
    awayPct: formatPercent(locale, f.away),
  });
  return (
    <span className="flex min-w-0 flex-col gap-1" data-testid="row-forecast" data-state="available">
      <span
        role="img"
        aria-label={label.text}
        lang={label.status === 'untranslated' ? 'en' : undefined}
        className="flex h-1.5 gap-px overflow-hidden rounded-full sm:h-2 sm:gap-0.5"
      >
        {outcomes.map(({ key, value }) => (
          <span
            key={key}
            data-outcome={key}
            className={STEPS[key]}
            // The share is the probability itself; a floor keeps 2% a sliver, not a gap.
            style={{ flexGrow: Math.max(value, 1.5), flexBasis: 0 }}
          />
        ))}
      </span>
      <span
        aria-hidden="true"
        className="flex justify-between font-mono text-xs text-model tabular-nums [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
      >
        {outcomes.map(({ key, value }) => (
          <span key={key}>{formatNumber(locale, Math.round(value))}</span>
        ))}
      </span>
    </span>
  );
}
