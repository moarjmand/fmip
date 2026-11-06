import { formatNumber, formatVersionStamp } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import type { CardForecast } from '@/lib/score-card-products';
import { FORECAST_REASON_KEY, filled } from '@/lib/words';
import { FilledMessage } from '@/components/filled-message';
import { ForecastBar, type ForecastBarSize, type Outcome } from '@/components/forecast-bar';
import { MessageText } from '@/components/message-text';
import { ModelVersion } from '@/components/model-version';
import { Receipt } from '@/components/receipt';
import { cx } from '@/components/ui/cx';

/**
 * The model's forecast where a page holds a `CardForecast` (the Design
 * System's `ForecastBar`, T-1508, D-263; split from the bar in T-1748): the
 * one `ForecastBar` with the model's receipt under it -- **always** (blueprint
 * 6.2: the version and the time are always on screen) -- or, when there is no
 * forecast, a sentence saying which kind of none, never an empty bar (rule
 * 3): not computed yet, none before kick-off, a version with no probabilities
 * and why, or the service not answering.
 *
 * This file draws no bar of its own: the three probabilities are
 * `forecast-bar.tsx`'s, in its one language (D-368, D-369). It holds what a
 * client bundle should not carry for a list row -- the receipt, the reasons
 * and the sentences -- which is why the two are separate modules. One
 * product: it takes the model's answer and nothing else (rule 6,
 * `three-products.spec.ts`).
 *
 * The input is the scores card's `CardForecast`, which both a full forecast
 * version and a pre-kick-off summary reduce to (`cardForecast`). The words
 * are resolved on the server (`forecastBarWords`).
 */

export const FORECAST_BAR_KEYS = [
  'forecastBar.label',
  'forecastBar.computed',
  'forecastBar.version',
  'forecastBar.happened',
  'forecastBar.none',
  'forecastBar.noneBefore',
  'forecastBar.unavailable',
  'forecastBar.unreachable',
  'forecastBar.noForecast',
  'forecastBar.notLoaded',
  'forecast.draw',
  'scores.card.model.couldNotAnswer',
  ...Object.values(FORECAST_REASON_KEY),
] as const;

export type ForecastBarWords = Record<(typeof FORECAST_BAR_KEYS)[number], Message>;

type Available = Extract<CardForecast, { state: 'available' }>;

/** The model's receipt for a forecast: its model, its version, when it was computed. */
export function ForecastReceipt({
  forecast,
  locale,
  timeZone,
  zone,
  words,
  className,
}: {
  forecast: Available;
  locale: string;
  timeZone: string;
  zone?: string;
  words: ForecastBarWords;
  className?: string;
}) {
  return (
    <Receipt
      className={className}
      testId="forecast-bar-meta"
      items={[
        <span key="model" dir="ltr">
          <ModelVersion version={forecast.model_version} />
        </span>,
        <MessageText
          key="version"
          message={filled(words['forecastBar.version'], {
            version: formatNumber(locale, forecast.version),
          })}
        />,
        <FilledMessage
          key="computed"
          message={words['forecastBar.computed']}
          params={{
            time: (
              <time dateTime={forecast.computed_at}>
                {formatVersionStamp(locale, forecast.computed_at, timeZone)}
                {zone !== undefined ? ` ${zone}` : timeZone === 'UTC' ? ' UTC' : ''}
              </time>
            ),
          }}
        />,
      ]}
    />
  );
}

export function ForecastBarWithReceipt({
  forecast,
  home,
  away,
  started = false,
  outcome,
  size,
  labels,
  locale,
  timeZone,
  zone,
  words,
  className,
  testId = 'forecast-bar',
}: {
  forecast: CardForecast;
  home: string;
  away: string;
  /** The match has kicked off, so "not yet" would be the wrong sentence. */
  started?: boolean;
  /** After full time: the outcome that happened (D-369). */
  outcome?: Outcome | null;
  /** The bar's size; `card` when left out. */
  size?: ForecastBarSize;
  labels?: 'numbers' | 'named';
  locale: string;
  timeZone: string;
  /**
   * The zone in words (`zoneWords`), said after the time (T-1395): the page's
   * own zone, so the stamp reads on the same clock as the kick-off. Without
   * it only UTC is named.
   */
  zone?: string;
  words: ForecastBarWords;
  className?: string;
  testId?: string;
}) {
  if (forecast.state !== 'available') {
    const sentence: Message =
      forecast.state === 'unavailable'
        ? filled(words['forecastBar.unavailable'], {
            version: formatNumber(locale, forecast.version),
            reason:
              words[
                forecast.reason === null
                  ? 'scores.card.model.couldNotAnswer'
                  : FORECAST_REASON_KEY[forecast.reason]
              ].text,
          })
        : forecast.state === 'unreachable'
          ? words['forecastBar.unreachable']
          : words[started ? 'forecastBar.noneBefore' : 'forecastBar.none'];
    return (
      <p
        className={cx(
          'rounded-control border border-dashed border-caption px-3 py-2 text-sm text-muted',
          className,
        )}
        data-testid={testId}
        data-state={forecast.state}
      >
        <MessageText message={sentence} />
      </p>
    );
  }
  return (
    <ForecastBar
      forecast={forecast}
      home={home}
      away={away}
      size={size}
      labels={labels}
      outcome={outcome}
      locale={locale}
      words={words}
      className={className}
      testId={testId}
    >
      <ForecastReceipt
        forecast={forecast}
        locale={locale}
        timeZone={timeZone}
        zone={zone}
        words={words}
        className="mt-0.5"
      />
    </ForecastBar>
  );
}
