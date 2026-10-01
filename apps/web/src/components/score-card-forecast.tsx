import type { CardForecast } from '@/lib/score-card-products';
import { formatDate, formatNumber } from '@/i18n/format';
import { FORECAST_REASON_KEY, filled, formatPercent } from '@/lib/words';
import type { ScoresWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { LtrNumeric } from '@/components/score';

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
              version: f.version,
              time: (
                <time dateTime={f.computed_at}>
                  {formatDate(locale, f.computed_at, timeZone, {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    hourCycle: 'h23',
                  })}
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
